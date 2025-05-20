use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json; // Added for RPC payload
// use log::{info, error, debug, warn}; // Replaced with println!

// Kaan: REPLACE THESE WITH YOUR ACTUAL SUPABASE URL AND ANON KEY
const SUPABASE_URL_PLACEHOLDER: &str = "https://dttwcuqlnfpsbkketppf.supabase.co";
const SUPABASE_ANON_KEY_PLACEHOLDER: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHdjdXFsbmZwc2Jra2V0cHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2Mzk5ODAsImV4cCI6MjA2MjIxNTk4MH0.PkcvR5uSlcXIpGP5E_jADVWDG0be5pTkqsbBxON8o8g";

const DEFAULT_FREE_TIER_WORD_LIMIT: i32 = 1500;
const DEFAULT_FREE_TIER_NAME: &str = "Free";
const DEFAULT_PRO_TIER_NAME: &str = "Pro"; // Fallback if not in price metadata

// This is the struct that will be returned by the Tauri command
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserSubscriptionDetails {
    pub user_id: String,
    pub email: Option<String>,
    pub stripe_customer_id: Option<String>,
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
    email: Option<String>,
    stripe_customer_id: Option<String>,
}

// For parsing metadata from the `prices` table
#[derive(Deserialize, Debug, Clone)]
struct PriceMetadata {
    word_limit: Option<i32>,
    tier_name: Option<String>,
    // description: Option<String>, // Example, if you store it
}

// For parsing the nested structure from PostgREST resource embedding
#[derive(Deserialize, Debug, Clone)]
struct PriceEmbed {
    // id: Option<String>,
    // product_id: Option<String>,
    metadata: Option<PriceMetadata>, // This will be the JSONB from prices.metadata
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
    status: String, 
    stripe_subscription_id: String,
    current_period_end: String, // TIMESTAMPTZ comes as ISO 8601 string
    word_usage_this_period: i32,
    // word_limit_this_period: i32, // This is now derived from price metadata

    // Embedded data from JOINs specified in `select`
    prices: Option<PriceEmbed>, 
}

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
                profiles_vec.first().map_or((None, None), |p| (p.email.clone(), p.stripe_customer_id.clone()))
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
            user_id: user_id.to_string(), email: profile_email, stripe_customer_id: profile_stripe_customer_id,
            active_tier: DEFAULT_FREE_TIER_NAME.to_string(), subscription_id: None, subscription_status: None, current_period_end: None,
            word_usage_this_period: 0, 
            word_limit_this_period: DEFAULT_FREE_TIER_WORD_LIMIT,
        });
    }

    let subs_body = subs_res.text().await.map_err(|e| format!("Error reading subscriptions body: {}", e))?;
    println!("[RUST DEBUG SupabaseManager] Subscriptions raw response: {}", subs_body);
    let active_subscriptions: Vec<SubscriptionWithJoins> = serde_json::from_str(&subs_body)
        .map_err(|e| format!("Parse subscriptions data failed: {}. Resp: {}", e, subs_body))?;

    if let Some(active_sub) = active_subscriptions.first().cloned() { 
        let mut tier_name = DEFAULT_PRO_TIER_NAME.to_string(); 
        let mut word_limit = DEFAULT_FREE_TIER_WORD_LIMIT * 1000; 

        if let Some(price_data) = active_sub.prices { 
            if let Some(meta) = price_data.metadata { 
                tier_name = meta.tier_name.unwrap_or(tier_name);
                word_limit = meta.word_limit.unwrap_or(word_limit);
            }
        }
        
        println!("[RUST DEBUG SupabaseManager] Active subscription found. Tier: '{}', Limit: {}, Usage: {}", tier_name, word_limit, active_sub.word_usage_this_period);
        Ok(UserSubscriptionDetails {
            user_id: user_id.to_string(), email: profile_email, stripe_customer_id: profile_stripe_customer_id,
            active_tier: tier_name,
            subscription_id: Some(active_sub.stripe_subscription_id),
            subscription_status: Some(active_sub.status),
            current_period_end: Some(active_sub.current_period_end),
            word_usage_this_period: active_sub.word_usage_this_period,
            word_limit_this_period: word_limit,
        })
    } else {
        println!("[RUST DEBUG SupabaseManager] No active/trialing subscription found. Defaulting to free tier.");
        Ok(UserSubscriptionDetails {
            user_id: user_id.to_string(), email: profile_email, stripe_customer_id: profile_stripe_customer_id,
            active_tier: DEFAULT_FREE_TIER_NAME.to_string(), subscription_id: None, subscription_status: None, current_period_end: None,
            word_usage_this_period: 0, 
            word_limit_this_period: DEFAULT_FREE_TIER_WORD_LIMIT,
        })
    }
}

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
    fetch_user_subscription_details_from_supabase(&user_id, &access_token).await
}

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

    let http_client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert("apikey", HeaderValue::from_str(SUPABASE_ANON_KEY_PLACEHOLDER).map_err(|e| format!("Invalid anon key: {}",e))?);
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", access_token)).map_err(|e| format!("Invalid access token: {}",e))?);
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    // 1. Call get_user_subscription_limits
    println!("[RUST DEBUG SupabaseManager RPC] Attempting to fetch subscription limits for user_id: {}", user_id);
    let limits_rpc_url = format!(
        "{}/rest/v1/rpc/get_user_subscription_limits", 
        SUPABASE_URL_PLACEHOLDER
    );
    let limits_payload = json!({ "p_user_id": user_id });

    let limits_response = http_client
        .post(&limits_rpc_url)
        .headers(headers.clone()) // Clone headers for this request
        .json(&limits_payload)
        .send()
        .await
        .map_err(|e| {
            println!("[RUST DEBUG SupabaseManager RPC ERROR] Network error calling get_user_subscription_limits: {:?}", e);
            format!("Network error fetching subscription limits: {}", e)
        })?;

    let mut proceed_with_increment = true;

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

                // Check if the limit is a "real" limit (not our placeholder for unlimited)
                if actual_limit < 999_999_999 { // Assuming 999_999_999 is the "unlimited" marker
                    if (current_usage + words_transcribed) > actual_limit {
                        let error_message = format!(
                            "Word limit exceeded. Usage: {}, Adding: {}, Limit: {}. Please upgrade your plan.",
                            current_usage, words_transcribed, actual_limit
                        );
                        println!("[RUST DEBUG SupabaseManager RPC ERROR] {}", error_message);
                        return Err(error_message); // Return an error immediately
                    } else {
                        println!("[RUST DEBUG SupabaseManager RPC] Word limit check passed.");
                    }
                } else {
                    println!("[RUST DEBUG SupabaseManager RPC] Tier has unlimited usage (limit: {}).", actual_limit);
                }
            } else {
                println!("[RUST DEBUG SupabaseManager RPC WARN] User subscription status is '{}', not 'active' or 'trialing'. Proceeding without strict limit check, but usage will be recorded.", limits_data.subscription_status);
            }
        } else {
            println!("[RUST DEBUG SupabaseManager RPC WARN] No active/trialing subscription limits found for user. Proceeding to increment usage.");
        }
    } else {
        let status = limits_response.status();
        let error_text = limits_response.text().await.unwrap_or_else(|_| "Could not read error body from get_user_subscription_limits".to_string());
        println!(
            "[RUST DEBUG SupabaseManager RPC ERROR] Error calling get_user_subscription_limits. Status: {}. Body: {}. Proceeding with increment attempt.",
            status, error_text
        );
        // If fetching limits fails, we log a warning and proceed with the increment as per the current instruction.
        // A stricter implementation might return Err here.
    }

    // 3. If limit check passes (or was bypassed):
    println!("[RUST DEBUG SupabaseManager RPC] Proceeding to call increment_word_usage RPC.");
    let increment_rpc_url = format!(
        "{}/rest/v1/rpc/increment_word_usage", 
        SUPABASE_URL_PLACEHOLDER
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

#[tauri::command]
pub async fn update_word_usage(
    user_id: String,
    access_token: String,
    words_transcribed: i32,
) -> Result<(), String> {
    // log::info!("[SupabaseManager CMD] update_word_usage called for user_id: {}, words: {}", user_id, words_transcribed);
    // println!("[RUST DEBUG SupabaseManager CMD] update_word_usage called for user_id: {}, words: {}", user_id, words_transcribed);
    println!("[RUST DEBUG SupabaseManager CMD Wrapper] update_word_usage called for user_id: {}, words: {}", user_id, words_transcribed);
    // Call the new internal logic function
    execute_increment_word_usage_rpc(user_id, access_token, words_transcribed).await
} 