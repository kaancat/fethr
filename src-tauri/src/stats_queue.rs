#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedStatsUpdate {
    pub user_id: String,
    pub word_count: i64,
    pub duration_seconds: i32,
    pub session_id: String,
    pub timestamp: DateTime<Utc>,
    pub retry_count: u32,
}

lazy_static::lazy_static! {
    static ref STATS_QUEUE: Mutex<VecDeque<QueuedStatsUpdate>> = Mutex::new(VecDeque::new());
}

const MAX_QUEUE_SIZE: usize = 100;
const MAX_RETRY_COUNT: u32 = 3;

/// Add a failed stats update to the retry queue
pub fn enqueue_stats_update(
    user_id: String,
    word_count: i64,
    duration_seconds: i32,
    session_id: String,
) -> Result<(), String> {
    let mut queue = STATS_QUEUE.lock().map_err(|e| format!("Failed to lock queue: {}", e))?;
    
    // Check queue size
    if queue.len() >= MAX_QUEUE_SIZE {
        // Remove oldest entries
        while queue.len() >= MAX_QUEUE_SIZE {
            queue.pop_front();
        }
        log::warn!("[StatsQueue] Queue full, removed oldest entries");
    }
    
    let update = QueuedStatsUpdate {
        user_id,
        word_count,
        duration_seconds,
        session_id,
        timestamp: Utc::now(),
        retry_count: 0,
    };
    
    queue.push_back(update);
    log::info!("[StatsQueue] Enqueued stats update for retry. Queue size: {}", queue.len());
    
    Ok(())
}

/// Get the next update to retry
pub fn dequeue_stats_update() -> Option<QueuedStatsUpdate> {
    let mut queue = STATS_QUEUE.lock().ok()?;
    queue.pop_front()
}

/// Re-enqueue an update that failed (with incremented retry count)
pub fn requeue_failed_update(mut update: QueuedStatsUpdate) -> Result<(), String> {
    update.retry_count += 1;
    
    if update.retry_count > MAX_RETRY_COUNT {
        log::warn!("[StatsQueue] Update for user {} exceeded max retries, discarding", update.user_id);
        return Ok(());
    }
    
    let mut queue = STATS_QUEUE.lock().map_err(|e| format!("Failed to lock queue: {}", e))?;
    queue.push_back(update);
    
    Ok(())
}

/// Get the current queue size
pub fn get_queue_size() -> usize {
    STATS_QUEUE.lock().map(|q| q.len()).unwrap_or(0)
}

/// Process all queued updates with the given auth credentials
pub async fn process_queued_updates(access_token: &str) -> Result<usize, String> {
    let mut processed = 0;
    let mut failures = Vec::new();
    
    // Process up to 10 items to avoid blocking too long
    for _ in 0..10 {
        let update = match dequeue_stats_update() {
            Some(u) => u,
            None => break,
        };
        
        // Check if update is too old (> 24 hours)
        let age = Utc::now() - update.timestamp;
        if age.num_hours() > 24 {
            log::info!("[StatsQueue] Discarding update older than 24 hours");
            continue;
        }
        
        // Try to sync the update
        match crate::user_statistics::sync_transcription_to_supabase(
            update.word_count,
            &update.user_id,
            access_token,
            Some(update.duration_seconds),
            Some(update.session_id.clone()),
            None // TODO: Store timezone with queued updates
        ).await {
            Ok(_) => {
                processed += 1;
                log::info!("[StatsQueue] Successfully processed queued update for user {}", update.user_id);
            }
            Err(e) => {
                log::error!("[StatsQueue] Failed to process queued update: {}", e);
                failures.push(update);
            }
        }
        
        // Small delay between requests
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    
    // Re-queue failed updates
    for update in failures {
        let _ = requeue_failed_update(update);
    }
    
    if processed > 0 {
        log::info!("[StatsQueue] Processed {} queued updates. Remaining: {}", processed, get_queue_size());
    }
    
    Ok(processed)
}

/// Clear all queued updates (e.g., on logout)
pub fn clear_queue() {
    if let Ok(mut queue) = STATS_QUEUE.lock() {
        let size = queue.len();
        queue.clear();
        if size > 0 {
            log::info!("[StatsQueue] Cleared {} queued updates", size);
        }
    }
}