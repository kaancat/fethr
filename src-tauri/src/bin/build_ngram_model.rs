use std::path::Path;
use fethr::ngram_builder::{NgramModelBuilder, create_training_corpus};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Building n-gram model for smart formatting...");
    
    // Create builder for trigrams (3-grams)
    let mut builder = NgramModelBuilder::new(3);
    
    // Process training data
    let training_file = Path::new("training_data/transcription_corpus.txt");
    
    if !training_file.exists() {
        eprintln!("Training file not found at {:?}", training_file);
        eprintln!("Please ensure training_data/transcription_corpus.txt exists");
        return Ok(());
    }
    
    println!("Processing training data from {:?}", training_file);
    builder.process_training_file(training_file)?;
    
    // Get statistics
    let stats = builder.get_stats();
    println!("\nModel Statistics:");
    println!("  Total n-grams: {}", stats.total_ngrams);
    println!("  Total count: {}", stats.total_count);
    println!("  Boundary n-grams: {}", stats.boundary_ngrams);
    println!("  Estimated size: {} KB", stats.model_size_estimate / 1024);
    
    // Create output directory if it doesn't exist
    std::fs::create_dir_all("resources")?;
    
    // Build and save the model
    let output_path = Path::new("resources/ngram_model.bin");
    println!("\nBuilding compressed model...");
    builder.build_and_save(output_path)?;
    
    // Check final file size
    let metadata = std::fs::metadata(output_path)?;
    println!("\nModel saved to {:?}", output_path);
    println!("Final size: {} KB", metadata.len() / 1024);
    
    println!("\nDone! The model is ready to be used by the smart formatter.");
    
    Ok(())
}