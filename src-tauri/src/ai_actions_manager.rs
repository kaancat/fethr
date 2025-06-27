use serde::{Serialize, Deserialize};
use log::{info, warn, error, debug};
use reqwest;
// use tauri::AppHandle; // Kept commented as signature uses tauri::AppHandle

// Assuming custom_prompts module exists and is separate, its functions are called with full path.
// use crate::custom_prompts; 

const CUSTOM_PROMPT_MAX_CHARS_AI: usize = 500;
const VERCEL_PROXY_URL_LOCAL: &str = "https://fethr-ai-proxy.vercel.app/api/ai-proxy";

// Helper function to get default prompts (logic moved from main.rs)
fn get_default_prompt_template_for_action_logic(action_id: &str) -> Result<String, String> {
    let common_output_constraint = "\n\nIMPORTANT: Your entire response must consist ONLY of the processed text. Do not include any introductory phrases, explanations, apologies, self-references, or surrounding quotation marks unless the quotation marks were explicitly part of the original spoken content being transformed.";

    match action_id.to_lowercase().as_str() {
        "written_form" => Ok(
            format!(
                r#"Directly reformat the following verbatim spoken transcription into polished, grammatically correct written text.\nFocus ONLY on the following transformations:\n1. Correct grammar and punctuation.\n2. Remove verbal disfluencies (e.g., "um", "uh", "you know", "like", "so", "actually", "basically", "right?").\n3. Rephrase awkward, run-on, or overly conversational sentences for clarity and conciseness suitable for written text.\n4. Ensure sentence structure is complete and flows well.\nMaintain the original speaker's core meaning, intent, and tone.\nDo NOT interpret the content, add new information, summarize, or change the core message.\n{}\n\nSpoken Transcription:\n"${{text}}"\n\nRefined Written Text:"#,
                common_output_constraint
            )
        ),
        "summarize" => Ok(
            format!(
                r#"Provide a concise, neutral summary of the key information and main conclusions from the following text.\nAim for a few sentences or a short paragraph, depending on the original length.\nThe summary should be objective and easy to understand.\n{}\n\nOriginal Text:\n"${{text}}"\n\nSummary:"#,
                common_output_constraint
            )
        ),
        "email" => Ok(
            format!(
                r#"Transform the following text into a well-structured, professional email body suitable for standard business communication.\nEnsure it is polite, clear, and maintains a natural yet professional tone.\nDo not include a subject line, salutation (like "Dear..."), closing (like "Sincerely..."), or any other elements outside the main body content.\n{}\n\nOriginal Text for Email Body:\n"${{text}}"\n\nEmail Body Content:"#,
                common_output_constraint
            )
        ),
        "promptify" => Ok(
            format!(
                r#"A user has provided the following spoken idea for a prompt they intend to give to an AI.\nYour task is to meticulously refine this idea into a highly effective, clear, and concise prompt, suitable for a large language model.\nApply prompt engineering best practices:\n- Be extremely specific about the desired output format if implied by the user's idea.\n- Clearly and unambiguously define the task, question, or desired outcome.\n- Suggest a specific role or persona for the target AI only if it clearly enhances the prompt's effectiveness for the user's stated goal.\n- If the user mentions constraints, specific details, a particular style, or examples, ensure these are precisely and clearly incorporated in the refined prompt.\n- Structure the refined prompt for optimal clarity and to guide the AI effectively.\n{}\n\nUser's Spoken Idea for a Prompt:\n"${{text}}"\n\nRefined Prompt:"#,
                common_output_constraint
            )
        ),
        _ => {
            // Defaulting to a generic Written Form prompt template as a fallback
            // This matches the fallback behavior previously in main.rs' get_default_prompt_for_action
            warn!("[AI Action Default Prompts] Unknown action_id for default prompt: '{}'. Falling back to 'written_form'.", action_id);
            Ok(format!(
                r#"Directly reformat the following verbatim spoken transcription into polished, grammatically correct written text.\nFocus ONLY on the following transformations:\n1. Correct grammar and punctuation.\n2. Remove verbal disfluencies (e.g., "um", "uh", "you know", "like", "so", "actually", "basically", "right?").\n3. Rephrase awkward, run-on, or overly conversational sentences for clarity and conciseness suitable for written text.\n4. Ensure sentence structure is complete and flows well.\nMaintain the original speaker's core meaning, intent, and tone.\nDo NOT interpret the content, add new information, summarize, or change the core message.\n{}\n\nSpoken Transcription:\n"${{text}}"\n\nRefined Written Text:"#,
                common_output_constraint
            ))
        }
    }
}


#[derive(Serialize)]
struct VercelProxyPayloadInternal<'a> {
    prompt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none", rename = "apiKey")]
    api_key: Option<&'a str>,
}

#[derive(Deserialize, Debug)]
struct AiActionResponseInternal {
    result: Option<String>,
    error: Option<String>,
}


#[tauri::command]
pub fn perform_ai_action(
    app_handle: tauri::AppHandle, 
    action: String,
    text: String,
    user_api_key: Option<String>,
    direct_prompt: Option<String>
) -> Result<String, String> {
    info!(
        "[AI Action] Called. Action: '{}', Text length: {}, Has BYOK: {}, Has direct_prompt: {}",
        action,
        text.len(),
        user_api_key.is_some(),
        direct_prompt.is_some()
    );

    if direct_prompt.is_some() && direct_prompt.as_ref().map_or(false, |dp| !dp.trim().is_empty()) && text.trim().is_empty() {
        warn!("[AI Action] Direct prompt received, but the transcription text to apply it to is empty.");
        return Err("Cannot apply a custom prompt: The transcription text is empty.".to_string());
    }

    let final_prompt: String;

    if let Some(dp_text_untrimmed) = direct_prompt.filter(|s| !s.trim().is_empty()) {
        let dp_text = dp_text_untrimmed.trim();

        if dp_text.chars().count() > CUSTOM_PROMPT_MAX_CHARS_AI {
            warn!(
                "[AI Action] Direct prompt exceeds maximum length of {} characters. Length: {}",
                CUSTOM_PROMPT_MAX_CHARS_AI,
                dp_text.chars().count()
            );
            return Err(format!(
                "Custom prompt is too long. Maximum allowed length is {} characters.",
                CUSTOM_PROMPT_MAX_CHARS_AI
            ));
        }

        info!("[AI Action] Using direct_prompt (length {}): {:.100}...", dp_text.chars().count(), dp_text);
        if dp_text.contains("${text}") {
            let user_prompt_with_text = dp_text.replace("${text}", &text);
            final_prompt = format!(
                "Please process the following text according to the user's detailed instruction. Ensure your entire response consists ONLY of the processed text, without any additional conversational filler, introductions, or explanations, unless explicitly part of the transformed text.\n\nUser's Instruction with Embedded Text:\n{}",
                user_prompt_with_text
            );
            info!("[AI Action] Direct prompt contained ${{text}}. Framed and text injected.");
        } else {
            final_prompt = format!(
                "Please apply the following user instruction to the provided text. Ensure your entire response consists ONLY of the processed text, without any additional conversational filler, introductions, or explanations, unless explicitly part of the transformed text.\n\nUser's Instruction:\n{}\n\nOriginal Text:\n{}",
                dp_text, 
                text
            );
            info!("[AI Action] Direct prompt did NOT contain ${{text}}. Framed prompt constructed.");
        }
    } else {
        info!("[AI Action] No direct_prompt. Looking up template for action: '{}'", action);
        
        let prompt_template = match crate::custom_prompts::get_custom_prompt(app_handle.clone(), action.clone()) {
            Ok(Some(custom_template)) => {
                info!("[AI Action] Using custom prompt template for action '{}'", action);
                custom_template
            }
            Ok(None) => {
                info!("[AI Action] No custom prompt template for action '{}'. Using default.", action);
                match get_default_prompt_template_for_action_logic(&action) { 
                    Ok(default_template) => default_template,
                    Err(e) => {
                        let err_msg = format!("Failed to get default prompt template (via local logic) for action '{}': {}", action, e);
                        error!("[AI Action] {}", err_msg);
                        return Err(err_msg);
                    }
                }
            }
            Err(e) => {
                let err_msg = format!("Error fetching custom prompt template for action '{}': {}. Falling back to default.", action, e);
                error!("[AI Action] {}", err_msg);
                match get_default_prompt_template_for_action_logic(&action) { // Fallback
                    Ok(default_template) => default_template,
                    Err(e_default) => {
                        let err_msg_default = format!("Failed to get ANY prompt template (via local logic) for action '{}': {}", action, e_default);
                        error!("[AI Action] {}", err_msg_default);
                        return Err(err_msg_default);
                    }
                }
            }
        };
        final_prompt = prompt_template.replace("${text}", &text);
        info!("[AI Action] Using template-based prompt for action '{}'.", action);
    }

    debug!("[AI Action] Final assembled prompt (first 200 chars): {:.200}", final_prompt.chars().take(200).collect::<String>());
    if user_api_key.is_some() && user_api_key.as_ref().map_or(false, |k| !k.trim().is_empty()) {
        info!("[AI Action] Using user-provided API key for this request.");
    } else {
        info!("[AI Action] No user-provided API key; proxy will use fallback app key.");
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| {
            error!("[AI Action] Failed to build HTTP client: {}", e);
            format!("Failed to build HTTP client: {}", e)
        })?;

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
                            info!("[AI Action] Successfully received AI response (length {}).", result_text.len());
                            Ok(result_text)
                        } else if let Some(err_msg) = ai_response.error {
                            error!("[AI Action] AI service returned an error: {}", err_msg);
                            Err(format!("AI service error: {}", err_msg))
                        } else {
                            error!("[AI Action] Invalid response structure from AI service (no result or error).");
                            Err("Invalid response structure from AI service.".to_string())
                        }
                    }
                    Err(e) => {
                        error!("[AI Action] Failed to parse AI service response: {}", e);
                        Err(format!("Failed to parse AI service response: {}", e))
                    }
                }
            } else {
                let error_text = response.text().unwrap_or_else(|_| "Could not read error body from AI service.".to_string());
                error!("[AI Action] AI service request failed. Status: {}. Body: {}", status, error_text);
                Err(format!("AI service request failed with status {}: {}", status, error_text))
            }
        }
        Err(e) => {
            error!("[AI Action] Network error calling AI service: {}", e);
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