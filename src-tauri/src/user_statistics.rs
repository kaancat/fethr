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
) -> Result<(), String> {
    log::info!("[UserStatistics] sync_transcription_to_supabase called for user {} with {} words", user_id, word_count);
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
        "p_word_count": word_count
    });
    
    log::info!("[UserStatistics] Calling increment_transcription_stats RPC with payload: {:?}", payload);
    
    let response = client
        .post(format!("{}/rest/v1/rpc/increment_transcription_stats", supabase_url))
        .header("apikey", &supabase_anon_key)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to send stats request: {}", e))?;
    
    let status = response.status();
    log::info!("[UserStatistics] increment_transcription_stats response status: {}", status);
    
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("[UserStatistics] RPC failed with error: {}", error_text);
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
    let client = reqwest::Client::new();
    
    // Get Supabase configuration from global settings
    let (supabase_url, supabase_anon_key) = {
        let settings_guard = crate::config::SETTINGS.lock().map_err(|e| format!("Failed to lock settings: {}", e))?;
        (
            settings_guard.supabase_url.clone(),
            settings_guard.supabase_anon_key.clone()
        )
    };
    
    // Get or create current week stats
    let stats_response = client
        .post(format!("{}/rest/v1/rpc/get_or_create_user_stats", supabase_url))
        .header("apikey", &supabase_anon_key)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .json(&json!({
            "p_user_id": user_id
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to get stats: {}", e))?;
    
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
    let dictionary_size = match crate::dictionary_manager::get_dictionary(app_handle) {
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