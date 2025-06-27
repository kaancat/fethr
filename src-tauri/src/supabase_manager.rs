use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json; // Added for RPC payload
// use log::{info, error, debug, warn}; // Replaced with println!

// This is the struct that will be returned by the Tauri command
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserSubscriptionDetails {
    pub user_id: String,
    pub _email: Option<String>, // Prefixed unused field
    pub _stripe_customer_id: Option<String>, // Prefixed unused field
    pub active_tier: String,
    pub subscription_id: Option<String>,
    pub subscription_status: Option<String>,
    pub current_period_end: Option<String>, // Consider parsing to DateTime<Utc> if needed in Rust
    pub word_usage_this_period: i32,
    pub word_limit_this_period: i32,
}

// For parsing basic profile info from `profiles` table
#[derive(Deserialize, Debug, Clone)]
struct ProfileBaseData {
    // id: String, // Not strictly needed if we already have user_id
    _email: Option<String>, // Prefixed unused field
    _stripe_customer_id: Option<String>, // Prefixed unused field
}

// For parsing metadata from the `prices` table
#[derive(Deserialize, Debug, Clone)]
struct PriceMetadata {
    _word_limit: Option<i32>, // Prefixed unused field
    _tier_name: Option<String>, // Prefixed unused field
    // description: Option<String>, // Example, if you store it
}

// For parsing the nested structure from PostgREST resource embedding
#[derive(Deserialize, Debug, Clone)]
struct PriceEmbed {
    // id: Option<String>,
    // product_id: Option<String>,
    _metadata: Option<PriceMetadata>, // Prefixed unused field
    // Removed products field (and ProductEmbed) as they are not used in current logic
}

#[derive(Deserialize, Debug, Clone)]
struct SubscriptionLimits {
    word_usage_this_period: i32,
    word_limit_this_period: i32,
    subscription_status: String, 
}

#[derive(Deserialize, Debug, Clone)]
struct SubscriptionWithJoins {
    // Fields directly from 'subscriptions' table
    // id: String, // Subscription's own UUID primary key
    // user_id: String,
    // price_id: String,
    _status: String, // Prefixed unused field
    _stripe_subscription_id: String, // Prefixed unused field
    _current_period_end: String, // Prefixed unused field. TIMESTAMPTZ comes as ISO 8601 string
    _word_usage_this_period: i32, // Prefixed unused field
    // word_limit_this_period: i32, // This is now derived from price metadata

    // Embedded data from JOINs specified in `select`
    _prices: Option<PriceEmbed>, // Prefixed unused field
}

/* // Commented out unused function
pub async fn fetch_user_subscription_details_from_supabase(
    user_id: &str,
    access_token: &str,
) -> Result<UserSubscriptionDetails, String> {
    println!("[RUST DEBUG SupabaseManager] Fetching subscription details for user_id: {}", user_id);

    if SUPABASE_URL_PLACEHOLDER == "YOUR_SUPABASE_URL" || SUPABASE_ANON_KEY_PLACEHOLDER == "YOUR_SUPABASE_ANON_KEY" {
        let err_msg = "[SupabaseManager] Supabase URL or Anon Key is not configured. Please replace placeholders.";
        println!("[RUST DEBUG SupabaseManager ERROR] {}",err_msg); 
        return Err(err_msg.to_string());
    }

    let http_client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert("apikey", HeaderValue::from_str(SUPABASE_ANON_KEY_PLACEHOLDER).unwrap()); 
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", access_token)).unwrap());
    headers.insert("Accept", HeaderValue::from_static("application/json"));

    // 1. Fetch basic profile data
    let profile_url = format!(
        "{}/rest/v1/profiles?id=eq.{}&select=email,stripe_customer_id", 
        SUPABASE_URL_PLACEHOLDER, 
        user_id
    );
    
    println!("[RUST DEBUG SupabaseManager] Fetching profile from: {}", profile_url);
    let profile_res = http_client.get(&profile_url).headers(headers.clone()).send().await;
    let (profile_email, profile_stripe_customer_id) = match profile_res {
        Ok(res) => {
            if res.status().is_success() {
                let body = res.text().await.map_err(|e| format!("Error reading profile body: {}", e))?;
                println!("[RUST DEBUG SupabaseManager] Profile raw response: {}", body);
                let profiles_vec: Vec<ProfileBaseData> = serde_json::from_str(&body)
                    .map_err(|e| format!("Parse profile data failed: {}. Resp: {}", e, body))?;
                profiles_vec.first().map_or((None, None), |p| (p._email.clone(), p._stripe_customer_id.clone()))
            } else {
                let status = res.status();
                let err_text = res.text().await.unwrap_or_default();
                println!("[RUST DEBUG SupabaseManager WARN] Non-success fetching profile (Status: {}): {}. User might be new or RLS issue.", status, err_text);
                (None, None) 
            }
        },
        Err(e) => {
            println!("[RUST DEBUG SupabaseManager WARN] Network error fetching profile: {}. Proceeding without profile-specific data.", e);
            (None, None)
        }
    };
    
    // 2. Fetch active/trialing subscription
    let subscriptions_url = format!(
        "{}/rest/v1/subscriptions?user_id=eq.{}&status=in.(active,trialing)&select=status,stripe_subscription_id,current_period_end,word_usage_this_period,prices(metadata)&order=current_period_end.desc&limit=1", 
        SUPABASE_URL_PLACEHOLDER,  
        user_id                    
    );

    println!("[RUST DEBUG SupabaseManager] Fetching active subscriptions from: {}", subscriptions_url);
    let subs_res = http_client.get(&subscriptions_url).headers(headers.clone()).send().await
        .map_err(|e| format!("Network error fetching subscriptions: {}", e))?;

    if !subs_res.status().is_success() {
        let status = subs_res.status();
        let err_text = subs_res.text().await.unwrap_or_default();
        println!("[RUST DEBUG SupabaseManager ERROR] Error fetching subscriptions (Status: {}): {}", status, err_text);
        return Ok(UserSubscriptionDetails {
            user_id: user_id.to_string(), _email: profile_email, _stripe_customer_id: profile_stripe_customer_id,
            active_tier: "Free".to_string(), // Use string literal directly
            subscription_id: None, subscription_status: None, current_period_end: None,
            word_usage_this_period: 0, 
            word_limit_this_period: 1500, // Use i32 literal directly
        });
    }

    let subs_body = subs_res.text().await.map_err(|e| format!("Error reading subscriptions body: {}", e))?;
    println!("[RUST DEBUG SupabaseManager] Subscriptions raw response: {}", subs_body);
    let active_subscriptions: Vec<SubscriptionWithJoins> = serde_json::from_str(&subs_body)
        .map_err(|e| format!("Parse subscriptions data failed: {}. Resp: {}", e, subs_body))?;

    if let Some(active_sub) = active_subscriptions.first().cloned() { 
        let mut tier_name = "Pro".to_string(); // Use string literal directly
        let mut word_limit = 1500 * 1000; // Use i32 literal directly

        if let Some(price_data) = active_sub._prices { 
            if let Some(meta) = price_data._metadata { 
                tier_name = meta._tier_name.unwrap_or(tier_name);
                word_limit = meta._word_limit.unwrap_or(word_limit);
            }
        }
        
        println!("[RUST DEBUG SupabaseManager] Active subscription found. Tier: '{}', Limit: {}, Usage: {}", tier_name, word_limit, active_sub._word_usage_this_period);
        Ok(UserSubscriptionDetails {
            user_id: user_id.to_string(), _email: profile_email, _stripe_customer_id: profile_stripe_customer_id,
            active_tier: tier_name,
            subscription_id: Some(active_sub._stripe_subscription_id),
            subscription_status: Some(active_sub._status),
            current_period_end: Some(active_sub._current_period_end),
            word_usage_this_period: active_sub._word_usage_this_period,
            word_limit_this_period: word_limit,
        })
    } else {
        println!("[RUST DEBUG SupabaseManager] No active/trialing subscription found. Defaulting to free tier.");
        Ok(UserSubscriptionDetails {
            user_id: user_id.to_string(), _email: profile_email, _stripe_customer_id: profile_stripe_customer_id,
            active_tier: "Free".to_string(), // Use string literal directly
            subscription_id: None, subscription_status: None, current_period_end: None,
            word_usage_this_period: 0, 
            word_limit_this_period: 1500, // Use i32 literal directly
        })
    }
}
*/

/* // Commented out unused function
#[tauri::command]
pub async fn get_user_subscription_details(
    user_id: String,
    access_token: String,
) -> Result<UserSubscriptionDetails, String> {
    // log::info!("[SupabaseManager CMD] get_user_subscription_details called for user_id: {}", user_id);
    println!("[RUST DEBUG SupabaseManager CMD] get_user_subscription_details called for user_id: {}", user_id);
    if user_id.trim().is_empty() || access_token.trim().is_empty() {
        let err_msg = "[SupabaseManager CMD] ERROR: User ID or Access Token is empty.";
        // error!("{}",err_msg); 
        println!("[RUST DEBUG SupabaseManager CMD ERROR] {}",err_msg); 
        return Err(err_msg.to_string());
    }
    // fetch_user_subscription_details_from_supabase(&user_id, &access_token).await // Also commented out the call
    Err("Functionality temporarily disabled".to_string()) // Placeholder error
}
*/

// New public async function containing the core RPC logic
pub async fn execute_increment_word_usage_rpc(
    user_id: String,
    access_token: String,
    words_transcribed: i32,
) -> Result<(), String> {
    println!("[RUST DEBUG SupabaseManager RPC] execute_increment_word_usage_rpc called for user_id: {}, words: {}", user_id, words_transcribed);

    if user_id.trim().is_empty() || access_token.trim().is_empty() {
        let err_msg = "[SupabaseManager RPC] ERROR: User ID or Access Token is empty for usage update.";
        println!("[RUST DEBUG SupabaseManager RPC ERROR] {}", err_msg);
        return Err(err_msg.to_string());
    }

    if words_transcribed <= 0 {
        println!("[RUST DEBUG SupabaseManager RPC] No words transcribed ({}), skipping usage update.", words_transcribed);
        return Ok(());
    }

    // Get Supabase configuration from global settings - use block scope to ensure guard is dropped
    let (current_supabase_url, current_supabase_anon_key) = {
        let settings_guard = crate::config::SETTINGS.lock().map_err(|e| format!("Failed to lock settings: {}", e))?;
        (
            settings_guard.supabase_url.clone(),
            settings_guard.supabase_anon_key.clone()
        )
        // settings_guard is automatically dropped here when it goes out of scope
    };

    let http_client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert("apikey", HeaderValue::from_str(&current_supabase_anon_key).map_err(|e| format!("Invalid anon key: {}",e))?);
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| format!("Invalid access token: {}",e))?);
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    // 1. Call get_user_subscription_limits
    println!("[RUST DEBUG SupabaseManager RPC] Attempting to fetch subscription limits for user_id: {}", user_id);
    let limits_rpc_url = format!(
        "{}/rest/v1/rpc/get_user_subscription_limits",
        current_supabase_url
    );
    let limits_payload = json!({ "p_user_id": user_id });

    let limits_response_result = http_client
        .post(&limits_rpc_url)
        .headers(headers.clone()) 
        .json(&limits_payload)
        .send()
        .await;

    match limits_response_result {
        Ok(limits_response) => { 
            if limits_response.status().is_success() {
                let limits_body = limits_response.text().await.map_err(|e| format!("Error reading limits response body: {}", e))?;
                println!("[RUST DEBUG SupabaseManager RPC] get_user_subscription_limits raw response: {}", limits_body);
                
                let limits_vec: Vec<SubscriptionLimits> = serde_json::from_str(&limits_body)
                    .map_err(|e| format!("Parse SubscriptionLimits failed: {}. Resp: {}", e, limits_body))?;

                if let Some(limits_data) = limits_vec.first() {
                    if limits_data.subscription_status == "active" || limits_data.subscription_status == "trialing" {
                        println!("[RUST DEBUG SupabaseManager RPC] Fetched limits: Usage: {}, Limit: {}, Status: {}",
                            limits_data.word_usage_this_period, limits_data.word_limit_this_period, limits_data.subscription_status);

                        let current_usage = limits_data.word_usage_this_period;
                        let actual_limit = limits_data.word_limit_this_period;

                        if actual_limit < 999_999_999 { // Check for "unlimited" marker
                            if (current_usage + words_transcribed) > actual_limit {
                                let error_message = format!(
                                    "Word limit exceeded. Usage: {}, Adding: {}, Limit: {}. Please upgrade your plan.",
                                    current_usage, words_transcribed, actual_limit
                                );
                                println!("[RUST DEBUG SupabaseManager RPC ERROR] {}", error_message);
                                return Err(error_message);
                            } else {
                                println!("[RUST DEBUG SupabaseManager RPC] Word limit check passed.");
                            }
                        } else {
                            println!("[RUST DEBUG SupabaseManager RPC] Tier has unlimited usage (limit: {}).", actual_limit);
                        }
                    } else { // Status is not 'active' or 'trialing'
                        let error_message = format!("Subscription status is '{}'. An active subscription is required.", limits_data.subscription_status);
                        println!("[RUST DEBUG SupabaseManager RPC ERROR] {}", error_message);
                        return Err(error_message);
                    }
                } else { // No limits_data in the vec (RPC returned empty array `[]` for the user_id)
                    let error_message = "No active subscription found. An active subscription is required to use this feature.".to_string();
                    println!("[RUST DEBUG SupabaseManager RPC ERROR] {}", error_message);
                    return Err(error_message);
                }
            } else { // HTTP status from get_user_subscription_limits was not success
                let status = limits_response.status();
                let error_text = limits_response.text().await.unwrap_or_else(|_| "Could not read error body from get_user_subscription_limits".to_string());
                let error_message = format!(
                    "Failed to fetch subscription limits. Status: {}. Detail: {}",
                    status, error_text
                );
                println!("[RUST DEBUG SupabaseManager RPC ERROR] {}", error_message);
                return Err(error_message);
            }
        }
        Err(e) => { // Network error during the HTTP request for limits
            let error_message = format!("Network error fetching subscription limits: {}", e);
            println!("[RUST DEBUG SupabaseManager RPC ERROR] {}", error_message);
            return Err(error_message);
        }
    }

    // If all checks passed, proceed to call increment_word_usage RPC.
    println!("[RUST DEBUG SupabaseManager RPC] Proceeding to call increment_word_usage RPC.");
    let increment_rpc_url = format!(
        "{}/rest/v1/rpc/increment_word_usage",
        current_supabase_url
    );
    let increment_payload = json!({
        "p_user_id": user_id,          
        "p_words_increment": words_transcribed
    });

    println!("[RUST DEBUG SupabaseManager RPC] Calling RPC 'increment_word_usage' at URL: {} with payload: {}", increment_rpc_url, increment_payload.to_string());

    let increment_response = http_client
        .post(&increment_rpc_url)
        .headers(headers) // Headers were already set up and cloned for the first call, reuse original here.
        .json(&increment_payload) 
        .send()
        .await
        .map_err(|e| {
            println!("[RUST DEBUG SupabaseManager RPC ERROR] Network error calling RPC 'increment_word_usage': {:?}", e);
            format!("Network error calling RPC increment_word_usage: {}", e)
        })?;

    if increment_response.status().is_success() {
        println!("[RUST DEBUG SupabaseManager RPC] RPC 'increment_word_usage' called successfully. Status: {}", increment_response.status());
        Ok(())
    } else {
        let status = increment_response.status();
        let error_text = increment_response.text().await.unwrap_or_else(|_| "Could not read error body from RPC call".to_string());
        println!(
            "[RUST DEBUG SupabaseManager RPC ERROR] Error calling RPC 'increment_word_usage'. Status: {}. Body: {}",
            status, error_text
        );
        Err(format!("Supabase RPC 'increment_word_usage' error ({}): {}", status, error_text))
    }
}

// Remove the unused Tauri command wrapper for update_word_usage
/*
#[tauri::command]
pub async fn update_word_usage(
    user_id: String,
    access_token: String,
    words_transcribed: i32,
) -> Result<(), String> {
    println!("[RUST DEBUG SupabaseManager CMD] update_word_usage called for user_id: {}, words: {}", user_id, words_transcribed);
    execute_increment_word_usage_rpc(user_id, access_token, words_transcribed).await
}
*/ 