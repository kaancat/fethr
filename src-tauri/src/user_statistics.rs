use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Serialize, Deserialize)]
pub struct UserStatistics {
    pub total_words_transcribed: i64,
    pub total_transcriptions: i64,
    pub total_minutes_saved: f64,
    pub weekly_words_transcribed: i64,
    pub weekly_transcriptions: i64,
    pub daily_streak: i32,
    pub longest_streak: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_words: i64,
    pub total_transcriptions: i64,
    pub daily_streak: i32,
    pub today_words: i64,
    pub average_words_per_session: i64,
    pub dictionary_size: i64,
    pub most_active_hour: Option<i32>,
    pub recent_transcriptions: Vec<serde_json::Value>,
}

/// Sync transcription to Supabase statistics
pub async fn sync_transcription_to_supabase(
    word_count: i64,
    user_id: &str,
    access_token: &str,
    duration_seconds: Option<i32>,
    session_id: Option<String>,
) -> Result<(), String> {
    // Input validation
    if word_count <= 0 {
        log::warn!("[UserStatistics] Invalid word count: {}. Skipping stats update.", word_count);
        return Ok(()); // Don't fail the transcription for invalid stats
    }
    
    // Validate UUID format for user_id
    if uuid::Uuid::parse_str(user_id).is_err() {
        log::error!("[UserStatistics] Invalid user_id format: {}. Skipping stats update.", user_id);
        return Ok(()); // Don't fail the transcription for invalid user_id
    }
    
    // Validate session_id if provided
    if let Some(ref sid) = session_id {
        if uuid::Uuid::parse_str(sid).is_err() {
            log::error!("[UserStatistics] Invalid session_id format: {}. Skipping stats update.", sid);
            return Ok(()); // Don't fail the transcription for invalid session_id
        }
    }
    
    // Validate duration is not negative
    if let Some(duration) = duration_seconds {
        if duration < 0 {
            log::warn!("[UserStatistics] Negative duration: {}. Using 0 instead.", duration);
        }
    }
    
    log::info!("[UserStatistics] sync_transcription_to_supabase called for user {} with {} words, duration: {:?}s, session: {:?}", user_id, word_count, duration_seconds, session_id);
    
    // Validate inputs
    if user_id.trim().is_empty() || access_token.trim().is_empty() {
        return Err("User ID or access token is empty".to_string());
    }
    
    // Validate word count
    if word_count < 0 {
        log::warn!("[UserStatistics] Invalid negative word count: {}, treating as 0", word_count);
        return Ok(()); // Don't fail, just skip
    }
    
    if word_count > 50000 {
        log::warn!("[UserStatistics] Suspiciously high word count: {}, capping at 50000", word_count);
    }
    
    // Validate duration
    let safe_duration = duration_seconds.unwrap_or(0).max(0).min(7200); // Cap at 2 hours
    let client = reqwest::Client::new();
    
    // Get Supabase configuration from global settings
    let (supabase_url, supabase_anon_key) = {
        let settings_guard = crate::config::SETTINGS.lock().map_err(|e| format!("Failed to lock settings: {}", e))?;
        (
            settings_guard.supabase_url.clone(),
            settings_guard.supabase_anon_key.clone()
        )
    };
    
    // Call the increment_transcription_stats function via RPC
    let payload = json!({
        "p_user_id": user_id,
        "p_word_count": word_count.min(50000), // Cap at reasonable max
        "p_duration_seconds": safe_duration,
        "p_session_id": session_id.map(|s| s.chars().take(100).collect::<String>()) // Limit session ID length
    });
    
    log::info!("[UserStatistics] Calling increment_transcription_stats RPC with payload: {:?}", payload);
    
    // Add timeout to prevent hanging
    let response = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client
            .post(format!("{}/rest/v1/rpc/increment_transcription_stats", supabase_url))
            .header("apikey", &supabase_anon_key)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
    ).await {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => {
            log::error!("[UserStatistics] Failed to send stats request: {}", e);
            return Err(format!("Failed to send stats request: {}", e));
        }
        Err(_) => {
            log::error!("[UserStatistics] Stats request timed out after 10s");
            return Err("Stats request timed out".to_string());
        }
    };
    
    let status = response.status();
    log::info!("[UserStatistics] increment_transcription_stats response status: {}", status);
    
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("[UserStatistics] RPC failed with error: {}", error_text);
        
        // Check for specific error types
        if status.as_u16() == 401 {
            // Clear auth cache to trigger refresh on next attempt
            crate::auth_manager::clear_session_cache();
            return Err("Authentication failed - token may be expired".to_string());
        } else if status.as_u16() == 429 {
            return Err("Rate limit exceeded - please try again later".to_string());
        } else if status.is_server_error() {
            return Err("Server error - stats will be retried later".to_string());
        }
        
        return Err(format!("Failed to sync stats: {}", error_text));
    }
    
    log::info!("[UserStatistics] Successfully synced transcription stats to Supabase");
    Ok(())
}

/// Get user statistics from Supabase
#[tauri::command]
pub async fn get_user_statistics(
    app_handle: tauri::AppHandle,
    user_id: String,
    access_token: String,
) -> Result<DashboardStats, String> {
    // Input validation
    if user_id.trim().is_empty() {
        log::error!("[UserStatistics] get_user_statistics called with empty user_id");
        return Err("User ID is required".to_string());
    }
    
    if access_token.trim().is_empty() {
        log::error!("[UserStatistics] get_user_statistics called with empty access_token");
        return Err("Authentication required".to_string());
    }
    
    // Validate user_id is a valid UUID
    if uuid::Uuid::parse_str(&user_id).is_err() {
        log::error!("[UserStatistics] Invalid user_id format: {}. Not a valid UUID.", user_id);
        return Err("Invalid user ID format".to_string());
    }
    
    let client = reqwest::Client::new();
    
    // Get Supabase configuration from global settings
    let (supabase_url, supabase_anon_key) = {
        let settings_guard = crate::config::SETTINGS.lock().map_err(|e| format!("Failed to lock settings: {}", e))?;
        (
            settings_guard.supabase_url.clone(),
            settings_guard.supabase_anon_key.clone()
        )
    };
    
    // Get or create current week stats with timeout
    let stats_response = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client
            .post(format!("{}/rest/v1/rpc/get_or_create_user_stats", supabase_url))
            .header("apikey", &supabase_anon_key)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&json!({
                "p_user_id": user_id
            }))
            .send()
    ).await {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => {
            log::error!("[UserStatistics] Failed to get stats: {}", e);
            return Err(format!("Failed to get stats: {}", e));
        }
        Err(_) => {
            log::error!("[UserStatistics] Stats request timed out after 10s");
            return Err("Stats request timed out".to_string());
        }
    };
    
    if !stats_response.status().is_success() {
        let error_text = stats_response.text().await.unwrap_or_default();
        return Err(format!("Failed to get stats: {}", error_text));
    }
    
    let stats: UserStatistics = stats_response.json().await
        .map_err(|e| format!("Failed to parse stats: {}", e))?;
    
    // Get recent transcriptions from local history using the command
    let recent_transcriptions = match crate::transcription::get_history(app_handle.clone()).await {
        Ok(history) => history.into_iter()
            .take(5)
            .map(|entry| json!({
                "timestamp": entry.timestamp,
                "text": entry.text
            }))
            .collect(),
        Err(_) => Vec::new(),
    };
    
    // Get dictionary size using the public command
    let dictionary_size = match crate::dictionary_manager::get_dictionary(app_handle.clone()) {
        Ok(dict) => dict.len() as i64,
        Err(_) => 0,
    };
    
    // Calculate average words per session
    let average_words_per_session = if stats.total_transcriptions > 0 {
        stats.total_words_transcribed / stats.total_transcriptions
    } else {
        0
    };
    
    // Calculate today's words and most active hour from history
    let (today_words, most_active_hour) = match crate::transcription::get_history(app_handle.clone()).await {
        Ok(history) => {
            use chrono::{Utc, Timelike};
            
            let now = Utc::now();
            let today_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
            let mut hour_counts = vec![0; 24];
            let mut today_word_count = 0;
            
            for entry in &history {
                // timestamp is already DateTime<Utc>
                let timestamp = entry.timestamp;
                
                // Count words
                let word_count = entry.text.split_whitespace().count() as i64;
                
                // Today's words
                if timestamp >= today_start {
                    today_word_count += word_count;
                }
                
                // Hour distribution
                hour_counts[timestamp.hour() as usize] += 1;
            }
            
            // Find most active hour
            let most_active = hour_counts
                .iter()
                .enumerate()
                .max_by_key(|(_, count)| *count)
                .filter(|(_, count)| **count > 0)
                .map(|(hour, _)| hour as i32);
            
            (today_word_count, most_active)
        },
        Err(_) => (0, None),
    };
    
    Ok(DashboardStats {
        total_words: stats.total_words_transcribed,
        total_transcriptions: stats.total_transcriptions,
        daily_streak: stats.daily_streak,
        today_words,
        average_words_per_session,
        dictionary_size,
        most_active_hour,
        recent_transcriptions,
    })
}