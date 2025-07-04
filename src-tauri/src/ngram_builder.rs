use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use tongrams::EliasFanoTrieCountLm;
use tempfile;

/// Special tokens for boundary detection
const PARAGRAPH_BOUNDARY: &str = "<P>";
const SENTENCE_BOUNDARY: &str = "<S>";
const START_TOKEN: &str = "<START>";
const END_TOKEN: &str = "<END>";

/// Builder for creating n-gram language models from training data
pub struct NgramModelBuilder {
    ngram_counts: HashMap<String, usize>,
    n: usize, // n-gram size (e.g., 3 for trigrams)
}

impl NgramModelBuilder {
    /// Create a new n-gram model builder
    pub fn new(n: usize) -> Self {
        Self {
            ngram_counts: HashMap::new(),
            n,
        }
    }

    /// Process a training file with annotated paragraph boundaries
    pub fn process_training_file(&mut self, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        
        let mut current_paragraph = Vec::new();
        
        for line in reader.lines() {
            let line = line?;
            let line = line.trim();
            
            if line.is_empty() {
                // Empty line indicates paragraph boundary
                if !current_paragraph.is_empty() {
                    self.process_paragraph(&current_paragraph);
                    current_paragraph.clear();
                }
            } else {
                current_paragraph.push(line.to_string());
            }
        }
        
        // Process last paragraph
        if !current_paragraph.is_empty() {
            self.process_paragraph(&current_paragraph);
        }
        
        Ok(())
    }

    /// Process a paragraph and extract n-grams around boundaries
    fn process_paragraph(&mut self, sentences: &[String]) {
        for (i, sentence) in sentences.iter().enumerate() {
            let tokens = self.tokenize_sentence(sentence);
            
            // Add sentence boundary n-grams
            if i > 0 {
                self.add_boundary_ngrams(&sentences[i-1], sentence, SENTENCE_BOUNDARY);
            }
            
            // Add within-sentence n-grams
            self.add_sentence_ngrams(&tokens);
        }
        
        // Add paragraph boundary n-grams if there's a next paragraph
        // This is handled by the caller when processing multiple paragraphs
    }

    /// Tokenize a sentence into character-level tokens
    fn tokenize_sentence(&self, sentence: &str) -> Vec<String> {
        // Character-level tokenization with special handling for punctuation
        let mut tokens = Vec::new();
        tokens.push(START_TOKEN.to_string());
        
        for ch in sentence.chars() {
            if ch.is_whitespace() {
                tokens.push(" ".to_string());
            } else {
                tokens.push(ch.to_string());
            }
        }
        
        tokens.push(END_TOKEN.to_string());
        tokens
    }

    /// Add n-grams around a boundary between two sentences
    fn add_boundary_ngrams(&mut self, before: &str, after: &str, boundary_type: &str) {
        let before_tokens = self.tokenize_sentence(before);
        let after_tokens = self.tokenize_sentence(after);
        
        // Get last few tokens of 'before' and first few tokens of 'after'
        let context_size = self.n - 1;
        
        let before_end: Vec<String> = before_tokens.iter()
            .rev()
            .take(context_size)
            .rev()
            .cloned()
            .collect();
            
        let after_start: Vec<String> = after_tokens.iter()
            .take(context_size)
            .cloned()
            .collect();
        
        // Create n-grams that span the boundary
        let mut boundary_context = before_end;
        boundary_context.push(boundary_type.to_string());
        boundary_context.extend(after_start);
        
        // Extract all n-grams from this boundary context
        for i in 0..=boundary_context.len().saturating_sub(self.n) {
            let ngram = boundary_context[i..i+self.n].join("");
            *self.ngram_counts.entry(ngram).or_insert(0) += 1;
        }
    }

    /// Add n-grams from within a sentence
    fn add_sentence_ngrams(&mut self, tokens: &[String]) {
        for i in 0..=tokens.len().saturating_sub(self.n) {
            let ngram = tokens[i..i+self.n].join("");
            *self.ngram_counts.entry(ngram).or_insert(0) += 1;
        }
    }

    /// Build the final n-gram model and save it
    pub fn build_and_save(&self, output_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        // First, save n-grams to temporary files in tongrams format
        let temp_dir = tempfile::tempdir()?;
        let ngram_file = temp_dir.path().join(format!("{}-grams.txt", self.n));
        
        // Write n-grams in tongrams format (ngram\tcount)
        let mut file = File::create(&ngram_file)?;
        let mut ngrams: Vec<_> = self.ngram_counts.iter().collect();
        ngrams.sort_by_key(|(ngram, _)| ngram.to_string());
        
        for (ngram, count) in ngrams {
            writeln!(file, "{}\t{}", ngram, count)?;
        }
        
        // Build the EliasFanoTrieCountLm from the file
        let filenames = vec![ngram_file.to_str().unwrap().to_string()];
        let lm = EliasFanoTrieCountLm::from_files(&filenames)?;
        
        // Serialize the model to the output path
        lm.serialize_into(output_path)?;
        
        Ok(())
    }

    /// Get statistics about the collected n-grams
    pub fn get_stats(&self) -> NgramStats {
        let total_ngrams = self.ngram_counts.len();
        let total_count: usize = self.ngram_counts.values().sum();
        let boundary_ngrams = self.ngram_counts.iter()
            .filter(|(ngram, _)| ngram.contains(PARAGRAPH_BOUNDARY) || ngram.contains(SENTENCE_BOUNDARY))
            .count();
        
        NgramStats {
            total_ngrams,
            total_count,
            boundary_ngrams,
            model_size_estimate: total_ngrams * 8, // Rough estimate in bytes
        }
    }
}

/// Statistics about the n-gram model
#[derive(Debug)]
pub struct NgramStats {
    pub total_ngrams: usize,
    pub total_count: usize,
    pub boundary_ngrams: usize,
    pub model_size_estimate: usize,
}

/// Utility function to create a training corpus from existing transcriptions
pub fn create_training_corpus(
    input_files: &[&Path],
    output_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut output = File::create(output_path)?;
    
    for input_path in input_files {
        let content = fs::read_to_string(input_path)?;
        
        // Simple heuristic: split on double newlines or long pauses
        let paragraphs = content.split("\n\n")
            .filter(|p| !p.trim().is_empty())
            .collect::<Vec<_>>();
        
        for paragraph in paragraphs {
            // Split into sentences (simple heuristic)
            let sentences = paragraph.split(". ")
                .filter(|s| !s.trim().is_empty())
                .collect::<Vec<_>>();
            
            for sentence in sentences {
                writeln!(output, "{}", sentence.trim())?;
            }
            writeln!(output)?; // Empty line for paragraph boundary
        }
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ngram_builder_basic() {
        let mut builder = NgramModelBuilder::new(3);
        
        // Process some simple sentences
        builder.process_paragraph(&[
            "Hello world.".to_string(),
            "How are you?".to_string(),
        ]);
        
        // Check that we have some n-grams
        assert!(builder.ngram_counts.len() > 0);
        
        // Check that we have boundary n-grams
        let stats = builder.get_stats();
        assert!(stats.boundary_ngrams > 0);
    }

    #[test]
    fn test_tokenization() {
        let builder = NgramModelBuilder::new(3);
        let tokens = builder.tokenize_sentence("Hi!");
        
        assert_eq!(tokens[0], START_TOKEN);
        assert_eq!(tokens[1], "H");
        assert_eq!(tokens[2], "i");
        assert_eq!(tokens[3], "!");
        assert_eq!(tokens[4], END_TOKEN);
    }

    #[test]
    fn test_build_and_save() -> Result<(), Box<dyn std::error::Error>> {
        let mut builder = NgramModelBuilder::new(3);
        
        // Add some test data
        builder.process_paragraph(&[
            "First sentence.".to_string(),
            "Second sentence.".to_string(),
        ]);
        
        // Save to temporary file
        let temp_dir = tempdir()?;
        let model_path = temp_dir.path().join("test_model.bin");
        
        builder.build_and_save(&model_path)?;
        
        // Verify file was created
        assert!(model_path.exists());
        
        Ok(())
    }
}