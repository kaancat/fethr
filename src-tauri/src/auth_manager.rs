use std::time::{Duration, Instant};
use std::sync::Mutex;
use reqwest::StatusCode;

// Session cache structure
#[derive(Clone, Debug)]
struct SessionCache {
    user_id: String,
    access_token: String,
    expires_at: Instant,
}

lazy_static::lazy_static! {
    static ref SESSION_CACHE: Mutex<Option<SessionCache>> = Mutex::new(None);
}

const SESSION_CACHE_DURATION: Duration = Duration::from_secs(30); // 30 seconds
const TOKEN_EXPIRY_BUFFER: Duration = Duration::from_secs(300); // 5 minutes

/// Validates an access token and checks if it needs refresh
pub async fn validate_token(access_token: &str) -> Result<bool, String> {
    if access_token.trim().is_empty() {
        return Ok(false);
    }
    
    // Check cache first
    if let Ok(cache_guard) = SESSION_CACHE.lock() {
        if let Some(cache) = cache_guard.as_ref() {
            if cache.access_token == access_token && cache.expires_at > Instant::now() {
                return Ok(true);
            }
        }
    }
    
    // For now, we'll consider non-empty tokens as valid
    // In a real implementation, you'd decode the JWT and check expiration
    Ok(true)
}

/// Wraps an async operation with auth retry logic
pub async fn with_auth_retry<F, Fut, T>(
    mut operation: F,
    max_retries: u32,
    operation_name: &str,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, reqwest::Error>>,
{
    let mut retry_count = 0;
    let mut last_error = None;
    
    while retry_count <= max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                // Check if it's an auth error
                if let Some(status) = e.status() {
                    if status == StatusCode::UNAUTHORIZED {
                        log::warn!("[Auth] Got 401 for {}, attempt {} of {}", 
                            operation_name, retry_count + 1, max_retries + 1);
                        
                        if retry_count < max_retries {
                            // Clear cache to force token refresh on frontend
                            if let Ok(mut cache_guard) = SESSION_CACHE.lock() {
                                *cache_guard = None;
                            }
                            
                            // Wait before retry
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            retry_count += 1;
                            continue;
                        }
                    }
                }
                
                last_error = Some(e);
                break;
            }
        }
    }
    
    Err(format!("Auth retry failed for {}: {}", 
        operation_name, 
        last_error.map(|e| e.to_string()).unwrap_or_else(|| "Unknown error".to_string())
    ))
}

/// Checks if an error is an authentication error
pub fn is_auth_error(status_code: StatusCode) -> bool {
    status_code == StatusCode::UNAUTHORIZED
}

/// Caches a valid session
pub fn cache_session(user_id: String, access_token: String) {
    if let Ok(mut cache_guard) = SESSION_CACHE.lock() {
        *cache_guard = Some(SessionCache {
            user_id,
            access_token,
            expires_at: Instant::now() + SESSION_CACHE_DURATION,
        });
    }
}

/// Clears the session cache
pub fn clear_session_cache() {
    if let Ok(mut cache_guard) = SESSION_CACHE.lock() {
        *cache_guard = None;
    }
}

/// Gets a user-friendly error message based on status code
pub fn get_error_message(status: StatusCode, default_message: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED => "Authentication failed - token may be expired".to_string(),
        StatusCode::TOO_MANY_REQUESTS => "Rate limit exceeded - please try again later".to_string(),
        StatusCode::INTERNAL_SERVER_ERROR | 
        StatusCode::BAD_GATEWAY | 
        StatusCode::SERVICE_UNAVAILABLE | 
        StatusCode::GATEWAY_TIMEOUT => "Server error - stats will be retried later".to_string(),
        _ => default_message.to_string(),
    }
}