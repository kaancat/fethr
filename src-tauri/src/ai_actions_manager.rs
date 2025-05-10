use reqwest;
use serde::Serialize;
use tauri::AppHandle;
use log; // Assuming the log crate is a dependency and configured

// Assuming custom_prompts.rs exists at crate::custom_prompts
use crate::custom_prompts; 
// Assuming get_default_prompt_for_action is in main.rs and accessible via crate::
// This might need to be pub in main.rs or moved.
// For now, let's assume a placeholder path or that it's made public from main.
// use crate::main::get_default_prompt_for_action; 

const CUSTOM_PROMPT_MAX_CHARS: usize = 500;

#[tauri::command]
pub fn perform_ai_action(
    app_handle: tauri::AppHandle,
    action: String,
    text: String,
    user_api_key: Option<String>,
    direct_prompt: Option<String>
) -> Result<String, String> {
    log::info!(
        "[AI Action] Called. Action: '{}', Text length: {}, Has BYOK: {}, Has direct_prompt: {}",
        action,
        text.len(),
        user_api_key.is_some(),
        direct_prompt.is_some()
    );

    if direct_prompt.is_some() && direct_prompt.as_ref().map_or(false, |dp| !dp.trim().is_empty()) && text.trim().is_empty() {
        log::warn!("[AI Action] Direct prompt received, but the transcription text to apply it to is empty.");
        return Err("Cannot apply a custom prompt: The transcription text is empty.".to_string());
    }

    let final_prompt: String;

    if let Some(dp_text_untrimmed) = direct_prompt.filter(|s| !s.trim().is_empty()) {
        let dp_text = dp_text_untrimmed.trim();

        if dp_text.chars().count() > CUSTOM_PROMPT_MAX_CHARS {
            log::warn!(
                "[AI Action] Direct prompt exceeds maximum length of {} characters. Length: {}",
                CUSTOM_PROMPT_MAX_CHARS,
                dp_text.chars().count()
            );
            return Err(format!(
                "Custom prompt is too long. Maximum allowed length is {} characters.",
                CUSTOM_PROMPT_MAX_CHARS
            ));
        }

        log::info!("[AI Action] Using direct_prompt (length {}): {:.100}...", dp_text.chars().count(), dp_text);
        if dp_text.contains("${text}") {
            let user_prompt_with_text = dp_text.replace("${text}", &text);
            final_prompt = format!(
                "Please process the following text according to the user's detailed instruction. Ensure your entire response consists ONLY of the processed text, without any additional conversational filler, introductions, or explanations, unless explicitly part of the transformed text.\n\nUser's Instruction with Embedded Text:\n{}",
                user_prompt_with_text
            );
            log::info!("[AI Action] Direct prompt contained ${{text}}. Framed and text injected.");
        } else {
            final_prompt = format!(
                "Please apply the following user instruction to the provided text. Ensure your entire response consists ONLY of the processed text, without any additional conversational filler, introductions, or explanations, unless explicitly part of the transformed text.\n\nUser's Instruction:\n{}\n\nOriginal Text:\n{}",
                dp_text, 
                text
            );
            log::info!("[AI Action] Direct prompt did NOT contain ${{text}}. Framed prompt constructed.");
        }
    } else {
        log::info!("[AI Action] No direct_prompt. Looking up template for action: '{}'", action);
        
        let prompt_template = match crate::custom_prompts::get_custom_prompt(app_handle.clone(), action.clone()) {
            Ok(Some(custom_template)) => {
                log::info!("[AI Action] Using custom prompt template for action '{}'", action);
                custom_template
            }
            Ok(None) => {
                log::info!("[AI Action] No custom prompt template for action '{}'. Using default.", action);
                // Assuming get_default_prompt_for_action is accessible from crate root or main module
                match crate::get_default_prompt_for_action(action.clone()) { 
                    Ok(default_template) => default_template,
                    Err(e) => {
                        let err_msg = format!("Failed to get default prompt template for action '{}': {}", action, e);
                        log::error!("[AI Action] {}", err_msg);
                        return Err(err_msg);
                    }
                }
            }
            Err(e) => {
                let err_msg = format!("Error fetching custom prompt template for action '{}': {}. Falling back to default.", action, e);
                log::error!("[AI Action] {}", err_msg);
                match crate::get_default_prompt_for_action(action.clone()) { // Fallback
                    Ok(default_template) => default_template,
                    Err(e_default) => {
                        let err_msg_default = format!("Failed to get ANY prompt template for action '{}': {}", action, e_default);
                        log::error!("[AI Action] {}", err_msg_default);
                        return Err(err_msg_default);
                    }
                }
            }
        };
        final_prompt = prompt_template.replace("${text}", &text);
        log::info!("[AI Action] Using template-based prompt for action '{}'.", action);
    }

    log::debug!("[AI Action] Final assembled prompt (first 200 chars): {:.200}", final_prompt.chars().take(200).collect::<String>());
    if user_api_key.is_some() && user_api_key.as_ref().map_or(false, |k| !k.trim().is_empty()) {
        log::info!("[AI Action] Using user-provided API key for this request.");
    } else {
        log::info!("[AI Action] No user-provided API key; proxy will use fallback app key.");
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| {
            log::error!("[AI Action] Failed to build HTTP client: {}", e);
            format!("Failed to build HTTP client: {}", e)
        })?;

    #[derive(serde::Serialize)]
    struct VercelProxyPayloadInternal<'a> {
        prompt: &'a str,
        #[serde(skip_serializing_if = "Option::is_none", rename = "apiKey")]
        api_key: Option<&'a str>,
    }

    #[derive(serde::Deserialize, Debug)]
    struct AiActionResponseInternal {
        result: Option<String>,
        error: Option<String>,
    }
    
    const VERCEL_PROXY_URL_LOCAL: &str = "https://fethr-ai-proxy.vercel.app/api/ai-proxy";

    let request_payload = VercelProxyPayloadInternal {
        prompt: &final_prompt,
        api_key: user_api_key.as_ref().map(|s| s.as_str()).filter(|s| !s.trim().is_empty()),
    };

    match client.post(VERCEL_PROXY_URL_LOCAL) 
        .json(&request_payload)
        .send()
    {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                match response.json::<AiActionResponseInternal>() { 
                    Ok(ai_response) => {
                        if let Some(result_text) = ai_response.result {
                            log::info!("[AI Action] Successfully received AI response (length {}).", result_text.len());
                            Ok(result_text)
                        } else if let Some(err_msg) = ai_response.error {
                            log::error!("[AI Action] AI service returned an error: {}", err_msg);
                            Err(format!("AI service error: {}", err_msg))
                        } else {
                            log::error!("[AI Action] Invalid response structure from AI service (no result or error).");
                            Err("Invalid response structure from AI service.".to_string())
                        }
                    }
                    Err(e) => {
                        log::error!("[AI Action] Failed to parse AI service response: {}", e);
                        Err(format!("Failed to parse AI service response: {}", e))
                    }
                }
            } else {
                let error_text = response.text().unwrap_or_else(|_| "Could not read error body from AI service.".to_string());
                log::error!("[AI Action] AI service request failed. Status: {}. Body: {}", status, error_text);
                Err(format!("AI service request failed with status {}: {}", status, error_text))
            }
        }
        Err(e) => {
            log::error!("[AI Action] Network error calling AI service: {}", e);
            Err(format!("Network error calling AI service: {}", e))
        }
    }
}

// Placeholder for get_default_prompt_for_action if it needs to be defined here or for testing.
// This function is assumed to be available from `crate::` (e.g. `main.rs`)
// If it's not, this would be the place to define a local version or ensure it's correctly imported.
// For now, we are relying on `crate::get_default_prompt_for_action`.

/* Example of how it might be defined if moved/local:
fn get_default_prompt_for_action(action: String) -> Result<String, String> {
    // ... implementation ...
    Ok(format!("Default prompt for {}: ${{text}}", action))
}
*/ 