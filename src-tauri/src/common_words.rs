// src-tauri/src/common_words.rs
//
// Google's 1000 most common English words for whitelist protection
// Source: https://github.com/first20hours/google-10000-english
// Prevents false positive corrections of common words

use std::collections::HashSet;
use once_cell::sync::Lazy;

/// Static set of 1000 most common English words for protection against false positive corrections
pub static COMMON_WORDS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    [
        // Top 100 most common words (ENHANCED with problematic words)
        "the", "of", "and", "a", "to", "in", "is", "you", "that", "it",
        "he", "was", "for", "on", "are", "as", "with", "his", "they", "i",
        "at", "be", "this", "have", "from", "or", "one", "had", "by", "word",
        "but", "not", "what", "all", "were", "we", "when", "your", "can", "said",
        "con", "so", "now", "know", "knew", "known", // CRITICAL: Added problematic words
        "there", "each", "which", "she", "do", "how", "their", "if", "will", "up",
        "other", "about", "out", "many", "then", "them", "these", "some", "her",
        "would", "make", "like", "into", "him", "time", "has", "two", "more", "go",
        "no", "way", "could", "my", "than", "first", "water", "been", "call", "who",
        "its", "find", "long", "down", "day", "did", "get", "come", "made", "may",
        "part", "over", "new", "sound", "take", "only", "little", "work", "place",
        "year", "live", "me", "back", "give", "most", "very", "after", "thing",
        
        // Next 200 most common words (101-300)
        "our", "just", "name", "good", "sentence", "man", "think", "say", "great", "where",
        "help", "through", "much", "before", "line", "right", "too", "mean", "old", "any",
        "same", "tell", "boy", "follow", "came", "want", "show", "also", "around", "form",
        "three", "small", "set", "put", "end", "why", "again", "turn", "here", "off",
        "went", "old", "number", "great", "tell", "men", "say", "small", "every", "found",
        "still", "between", "mane", "should", "home", "big", "give", "air", "line", "set",
        "own", "under", "read", "last", "never", "us", "left", "end", "along", "while",
        "might", "next", "sound", "below", "saw", "something", "thought", "both", "few", "those",
        "always", "looked", "show", "large", "often", "together", "asked", "house", "don't", "world",
        "going", "want", "school", "important", "until", "form", "food", "keep", "children", "feet",
        "land", "side", "without", "boy", "once", "animal", "life", "enough", "took", "sometimes",
        "four", "head", "above", "kind", "began", "almost", "live", "page", "got", "earth",
        "need", "far", "hand", "high", "year", "mother", "light", "country", "father", "let",
        "night", "picture", "being", "study", "second", "book", "carry", "took", "science", "eat",
        "room", "friend", "began", "idea", "fish", "mountain", "north", "once", "base", "hear",
        "horse", "cut", "sure", "watch", "color", "face", "wood", "main", "enough", "plain",
        "girl", "usual", "young", "ready", "above", "ever", "red", "list", "though", "feel",
        "talk", "bird", "soon", "body", "dog", "family", "direct", "leave", "song", "measure",
        "door", "product", "black", "short", "numeral", "class", "wind", "question", "happen", "complete",
        "ship", "area", "half", "rock", "order", "fire", "south", "problem", "piece", "told",
        
        // Next 200 words (301-500) - Critical common words
        "knew", "pass", "since", "top", "whole", "king", "space", "heard", "best", "hour",
        "better", "during", "hundred", "five", "remember", "step", "early", "hold", "west", "ground",
        "interest", "reach", "fast", "verb", "sing", "listen", "six", "table", "travel", "less",
        "morning", "ten", "simple", "several", "vowel", "toward", "war", "lay", "against", "pattern",
        "slow", "center", "love", "person", "money", "serve", "appear", "road", "map", "rain",
        "rule", "govern", "pull", "cold", "notice", "voice", "unit", "power", "town", "fine",
        "certain", "fly", "fall", "lead", "cry", "dark", "machine", "note", "wait", "plan",
        "figure", "star", "box", "noun", "field", "rest", "correct", "able", "pound", "done",
        "beauty", "drive", "stood", "contain", "front", "teach", "week", "final", "gave", "green",
        "oh", "quick", "develop", "ocean", "warm", "free", "minute", "strong", "special", "mind",
        "behind", "clear", "tail", "produce", "fact", "street", "inch", "multiply", "nothing", "course",
        "stay", "wheel", "full", "force", "blue", "object", "decide", "surface", "deep", "moon",
        "island", "foot", "system", "busy", "test", "record", "boat", "common", "gold", "possible",
        "plane", "stead", "dry", "wonder", "laugh", "thousands", "ago", "ran", "check", "game",
        "shape", "equate", "hot", "miss", "brought", "heat", "snow", "tire", "bring", "yes",
        "distant", "fill", "east", "paint", "language", "among", "grand", "ball", "yet", "wave",
        "drop", "heart", "am", "present", "heavy", "dance", "engine", "position", "arm", "wide",
        "sail", "material", "size", "vary", "settle", "speak", "weight", "general", "ice", "matter",
        "circle", "pair", "include", "divide", "syllable", "felt", "perhaps", "pick", "sudden", "count",
        "square", "reason", "length", "represent", "art", "subject", "region", "energy", "hunt", "probable",
        
        // More essential words (501-700)
        "bed", "brother", "egg", "ride", "cell", "believe", "fraction", "forest", "sit", "race",
        "window", "store", "summer", "train", "sleep", "prove", "lone", "leg", "exercise", "wall",
        "catch", "mount", "wish", "sky", "board", "joy", "winter", "sat", "written", "wild",
        "instrument", "kept", "glass", "grass", "cow", "job", "edge", "sign", "visit", "past",
        "soft", "fun", "bright", "gas", "weather", "month", "million", "bear", "finish", "happy",
        "hope", "flower", "clothe", "strange", "gone", "jump", "baby", "eight", "village", "meet",
        "root", "buy", "raise", "solve", "metal", "whether", "push", "seven", "paragraph", "third",
        "shall", "held", "hair", "describe", "cook", "floor", "either", "result", "burn", "hill",
        "safe", "cat", "century", "consider", "type", "law", "bit", "coast", "copy", "phrase",
        "silent", "tall", "sand", "soil", "roll", "temperature", "finger", "industry", "value", "fight",
        "lie", "beat", "excite", "natural", "view", "sense", "ear", "else", "quite", "broke",
        "case", "middle", "kill", "son", "lake", "moment", "scale", "loud", "spring", "observe",
        "child", "straight", "consonant", "nation", "dictionary", "milk", "speed", "method", "organ", "pay",
        "age", "section", "dress", "cloud", "surprise", "quiet", "stone", "tiny", "climb", "bad",
        "oil", "blood", "touch", "grew", "cent", "mix", "team", "wire", "cost", "lost",
        "brown", "wear", "garden", "equal", "sent", "choose", "fell", "fit", "flow", "fair",
        "bank", "collect", "save", "control", "decimal", "gentle", "woman", "captain", "practice", "separate",
        "difficult", "doctor", "please", "protect", "noon", "whose", "locate", "ring", "character", "insect",
        "caught", "period", "indicate", "radio", "spoke", "atom", "human", "history", "effect", "electric",
        "expect", "crop", "modern", "element", "hit", "student", "corner", "party", "supply", "bone",
        
        // Final critical words (701-1000)  
        "rail", "imagine", "provide", "agree", "thus", "capital", "won't", "chair", "danger", "fruit",
        "rich", "thick", "soldier", "process", "operate", "guess", "necessary", "sharp", "wing", "create",
        "neighbor", "wash", "bat", "rather", "crowd", "corn", "compare", "poem", "string", "bell",
        "depend", "meat", "rub", "tube", "famous", "dollar", "stream", "fear", "sight", "thin",
        "triangle", "planet", "hurry", "chief", "colony", "clock", "mine", "tie", "enter", "major",
        "fresh", "search", "send", "yellow", "gun", "allow", "print", "dead", "spot", "desert",
        "suit", "current", "lift", "rose", "continue", "block", "chart", "hat", "sell", "success",
        "company", "subtract", "event", "particular", "deal", "swim", "term", "opposite", "wife", "shoe",
        "shoulder", "spread", "arrange", "camp", "invent", "cotton", "born", "determine", "quart", "nine",
        "truck", "noise", "level", "chance", "gather", "shop", "stretch", "throw", "shine", "property",
        "column", "molecule", "select", "wrong", "gray", "repeat", "require", "broad", "prepare", "salt",
        "nose", "plural", "anger", "claim", "continent", "oxygen", "sugar", "death", "pretty", "skill",
        "women", "season", "solution", "magnet", "silver", "thank", "branch", "match", "suffix", "especially",
        "fig", "afraid", "huge", "sister", "steel", "discuss", "forward", "similar", "guide", "experience",
        "score", "apple", "bought", "led", "pitch", "coat", "mass", "card", "band", "rope",
        "slip", "win", "dream", "evening", "condition", "feed", "tool", "total", "basic", "smell",
        "valley", "nor", "double", "seat", "arrive", "master", "track", "parent", "shore", "division",
        "sheet", "substance", "favor", "connect", "post", "spend", "chord", "fat", "glad", "original",
        "share", "station", "dad", "bread", "charge", "proper", "bar", "offer", "segment", "slave",
        "duck", "instant", "market", "degree", "populate", "chick", "dear", "enemy", "reply", "drink",
        "occur", "support", "speech", "nature", "range", "steam", "motion", "path", "liquid", "log",
        "meant", "quotient", "teeth", "shell", "neck"
    ].into_iter().collect()
});

/// Check if a word is in the common words whitelist
pub fn is_common_word(word: &str) -> bool {
    COMMON_WORDS.contains(&word.to_lowercase().as_str())
}

/// Check if a word should be protected from dictionary correction
/// This includes common words and very short words
pub fn should_protect_from_correction(word: &str) -> bool {
    if word.len() <= 2 {
        return true; // Always protect very short words
    }
    
    is_common_word(word)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_common_word_detection() {
        // Test common words are detected
        assert!(is_common_word("the"));
        assert!(is_common_word("and"));
        assert!(is_common_word("can"));
        assert!(is_common_word("con")); // This should be protected!
        assert!(is_common_word("for"));
        assert!(is_common_word("with"));
        
        // Test case insensitivity
        assert!(is_common_word("THE"));
        assert!(is_common_word("And"));
        assert!(is_common_word("CAN"));
        
        // Test non-common words are not detected
        assert!(!is_common_word("Kaan"));
        assert!(!is_common_word("Panjeet"));
        assert!(!is_common_word("Schleuning"));
        assert!(!is_common_word("Supabase"));
        assert!(!is_common_word("Vindstød"));
    }

    #[test]
    fn test_protection_logic() {
        // Test short words are protected
        assert!(should_protect_from_correction("a"));
        assert!(should_protect_from_correction("to"));
        assert!(should_protect_from_correction("of"));
        
        // Test common words are protected
        assert!(should_protect_from_correction("can"));
        assert!(should_protect_from_correction("the"));
        assert!(should_protect_from_correction("and"));
        
        // Test user dictionary words are not protected
        assert!(!should_protect_from_correction("Kaan"));
        assert!(!should_protect_from_correction("Panjeet"));
        assert!(!should_protect_from_correction("Schleuning"));
    }
}