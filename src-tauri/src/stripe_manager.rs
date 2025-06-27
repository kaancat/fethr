use serde::{Deserialize, Serialize};
use stripe::{
    CheckoutSession, CheckoutSessionMode, CreateCheckoutSession, CreateCheckoutSessionLineItems,
    CreateCheckoutSessionPaymentMethodTypes, Client,
};
use crate::config::SETTINGS;

/// Response structure for the checkout session creation
#[derive(Serialize, Deserialize, Debug)]
pub struct CheckoutSessionResponse {
    pub url: String,
    pub session_id: String,
}

/// Create a Stripe Checkout Session for subscription
/// 
/// This function creates a Stripe Checkout Session that redirects users to Stripe's hosted checkout page.
/// After successful payment, Stripe will handle the subscription creation and send webhook events
/// to update our database.
/// 
/// # Arguments
/// * `user_id` - The Supabase user ID for the user subscribing
/// * `access_token` - The user's Supabase access token (for authentication verification)
/// * `price_id` - The Stripe Price ID to subscribe to (e.g., "price_1RPhieI2AxMb20rVZU8sc5av")
/// 
/// # Returns
/// * `Ok(String)` - The Stripe Checkout Session URL to redirect the user to
/// * `Err(String)` - Error message if session creation fails
#[tauri::command]
pub async fn create_stripe_checkout_session(
    user_id: String,
    access_token: String,
    price_id: String,
) -> Result<String, String> {
    println!("[RUST STRIPE] Creating checkout session for user_id: {}, price_id: {}", user_id, price_id);

    // Validate inputs
    if user_id.trim().is_empty() {
        return Err("User ID is required".to_string());
    }
    if access_token.trim().is_empty() {
        return Err("Access token is required".to_string());
    }
    if price_id.trim().is_empty() {
        return Err("Price ID is required".to_string());
    }

    // Get Stripe configuration from settings
    let (stripe_secret_key, success_url, cancel_url) = {
        let settings_guard = SETTINGS.lock().map_err(|e| format!("Failed to lock settings: {}", e))?;
        let key = settings_guard.stripe_secret_key.clone();
        if key == "sk_test_YOUR_STRIPE_SECRET_KEY_HERE" || key.trim().is_empty() {
            return Err("Stripe secret key is not configured. Please update your config.toml file.".to_string());
        }
        (
            key,
            settings_guard.stripe_success_url.clone(),
            settings_guard.stripe_cancel_url.clone()
        )
    };

    // Enhanced logging for debugging
    println!("[RUST STRIPE] Configuration loaded:");
    println!("[RUST STRIPE] - Success URL: {}", success_url);
    println!("[RUST STRIPE] - Cancel URL: {}", cancel_url);
    println!("[RUST STRIPE] - Client reference ID: {}", user_id);

    // Initialize Stripe client
    let client = Client::new(stripe_secret_key);

    // Create checkout session parameters
    let mut create_session = CreateCheckoutSession::new();
    
    // Set the mode to subscription
    create_session.mode = Some(CheckoutSessionMode::Subscription);
    
    // Set payment method types
    create_session.payment_method_types = Some(vec![CreateCheckoutSessionPaymentMethodTypes::Card]);
    
    // Set line items with the price ID
    create_session.line_items = Some(vec![CreateCheckoutSessionLineItems {
        price: Some(price_id.clone()),
        quantity: Some(1),
        ..Default::default()
    }]);

    // Set success and cancel URLs from configuration
    create_session.success_url = Some(&success_url);
    create_session.cancel_url = Some(&cancel_url);
    
    // Set client reference ID to the user ID for webhook handling
    create_session.client_reference_id = Some(&user_id);
    
    // Add metadata for webhook processing
    create_session.metadata = Some([
        ("user_id".to_string(), user_id.clone()),
        ("price_id".to_string(), price_id.clone()),
    ].iter().cloned().collect());

    // Log session creation details
    println!("[RUST STRIPE] Session parameters:");
    println!("[RUST STRIPE] - Mode: Subscription");
    println!("[RUST STRIPE] - Payment methods: Card");
    println!("[RUST STRIPE] - Line items: 1x {}", price_id);
    println!("[RUST STRIPE] - Metadata: user_id={}, price_id={}", user_id, price_id);

    // Create the checkout session
    match CheckoutSession::create(&client, create_session).await {
        Ok(session) => {
            if let Some(url) = session.url {
                println!("[RUST STRIPE] Checkout session created successfully. Session ID: {}", session.id);
                Ok(url)
            } else {
                let error_msg = "Checkout session created but no URL returned".to_string();
                println!("[RUST STRIPE ERROR] {}", error_msg);
                Err(error_msg)
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to create Stripe checkout session: {}", e);
            println!("[RUST STRIPE ERROR] {}", error_msg);
            Err(error_msg)
        }
    }
}

/// Helper function to validate Stripe configuration
/// 
/// This function checks if the Stripe secret key is properly configured
/// and returns a user-friendly error message if not.
pub fn validate_stripe_config() -> Result<(), String> {
    let settings_guard = SETTINGS.lock().map_err(|e| format!("Failed to lock settings: {}", e))?;
    let key = &settings_guard.stripe_secret_key;
    
    if key == "sk_test_YOUR_STRIPE_SECRET_KEY_HERE" || key.trim().is_empty() {
        return Err("Stripe secret key is not configured. Please update your config.toml file with a valid Stripe secret key.".to_string());
    }
    
    if !key.starts_with("sk_test_") && !key.starts_with("sk_live_") {
        return Err("Invalid Stripe secret key format. Key should start with 'sk_test_' or 'sk_live_'.".to_string());
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_stripe_config_default() {
        // This test will fail with default config, which is expected
        let result = validate_stripe_config();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not configured"));
    }
} 