#![allow(unused_imports)] // Temp allow while debugging
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;
use tauri::{command, AppHandle, Manager, State};
use uuid::Uuid;
// Removed: use crate::AudioRecordingState; // Defined in main.rs
use crate::SharedRecordingState;
use crate::transcription::{self, TranscriptionState};
use cpal::SupportedStreamConfig;
use std::fs::File;
use std::io::BufWriter;
use scopeguard::defer; // Keep scopeguard

// Import clipboard and paste functions (adjust path if necessary)
use crate::{write_to_clipboard_internal, paste_text_to_cursor};

#[command]
pub async fn start_backend_recording(
    app_handle: AppHandle,
    recording_state: State<'_, SharedRecordingState>,
) -> Result<(), String> {
    println!("[RUST AUDIO] start_backend_recording command received");

    let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state: {}", e))?;

    if state_guard.is_actively_recording {
        println!("[RUST AUDIO WARN] Already recording");
        return Err("Already recording".to_string());
    }

    // --- Setup IDs and Paths ---
    let unique_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir();
    let temp_wav_path = temp_dir.join(format!("fethr_rec_{}.wav", unique_id));
    println!("[RUST AUDIO] Recording path: {}", temp_wav_path.display());

    // --- Setup Channel for Stop Signal ---
    let (tx_stop, rx_stop): (mpsc::Sender<()>, mpsc::Receiver<()>) = mpsc::channel();

    // --- Get CPAL Device ---
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| "No input device available".to_string())?;
    println!("[RUST AUDIO DEBUG] Default input device: {:?}", device.name().unwrap_or_else(|_| "Unnamed".to_string()));

    // --- Find Best Supported Config (cpal 0.14.2 logic - Robust) ---
    println!("[RUST AUDIO DEBUG] Finding best supported input config...");

    let preferred_format_order = [cpal::SampleFormat::I16, cpal::SampleFormat::F32];
    let mut best_config: Option<cpal::SupportedStreamConfig> = None;

    'format_loop: for &format in preferred_format_order.iter() {
        println!("[RUST AUDIO DEBUG] Checking for format: {:?}", format);
        if let Ok(mut configs_iter) = device.supported_input_configs() {
             if let Some(range) = configs_iter.find(|range| range.sample_format() == format && range.channels() == 1) {
                println!("[RUST AUDIO DEBUG]   -> Found Mono {:?} range.", format);
                let desired_rate = if range.min_sample_rate().0 <= 48000 && range.max_sample_rate().0 >= 48000 { cpal::SampleRate(48000) }
                                   else if range.min_sample_rate().0 <= 16000 && range.max_sample_rate().0 >= 16000 { cpal::SampleRate(16000) }
                                   else { range.max_sample_rate() };
                println!("[RUST AUDIO DEBUG]   -> Selecting rate: {}", desired_rate.0);
                best_config = Some(range.with_sample_rate(desired_rate));
                break 'format_loop;
             }
        }
        if best_config.is_none() {
             println!("[RUST AUDIO DEBUG] No Mono {:?} found, checking any channel count...", format);
             if let Ok(mut configs_iter) = device.supported_input_configs() {
                 if let Some(range) = configs_iter.find(|range| range.sample_format() == format) {
                     println!("[RUST AUDIO DEBUG]   -> Found {:?} range ({} channels). Selecting max rate: {}", format, range.channels(), range.max_sample_rate().0);
                     best_config = Some(range.with_max_sample_rate());
                     break 'format_loop;
                 }
             }
        }
         println!("[RUST AUDIO DEBUG] No {:?} configs found.", format);
    }

    let supported_config = best_config.ok_or_else(|| "No supported I16 or F32 input config found".to_string())?;
    // --- End Config Finding Logic ---

    let actual_sample_rate = supported_config.sample_rate().0;
    let stream_config: cpal::StreamConfig = supported_config.config();
    let actual_format = supported_config.sample_format();

    println!("[RUST AUDIO] Selected config: Rate: {}, Channels: {}, Format: {:?}", actual_sample_rate, stream_config.channels, actual_format);

    // --- Configure WAV Writer ---
    let spec = hound::WavSpec { channels: 1, sample_rate: actual_sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let writer = hound::WavWriter::create(&temp_wav_path, spec).map_err(|e| format!("Failed to create WavWriter: {}", e))?;
    let writer_mutex = Arc::new(Mutex::new(writer));

    // --- Clone Arcs for Thread ---
    let writer_clone = writer_mutex.clone();
    let app_handle_for_error_cb = app_handle.clone();
    let app_handle_for_build_err = app_handle.clone();
    let app_handle_for_play_err = app_handle.clone();

    // --- Spawn Recording Thread ---
    let recording_handle = thread::spawn(move || {
        println!("[RUST THREAD] Recording thread started.");

        let error_callback = move |err| {
            eprintln!("[RUST THREAD CB] CPAL stream error: {}", err);
            let _ = app_handle_for_error_cb.emit_all("recording_error", format!("CPAL Stream Error: {}", err));
        };

        println!("[RUST THREAD DEBUG] Building stream for format: {:?}", actual_format);
        let stream_result = match actual_format { // Changed variable name
            cpal::SampleFormat::I16 => {
                let data_callback = move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let n_samples = data.len();
                    if n_samples > 0 {
                        println!("[RUST THREAD CB - I16] Received {} samples.", n_samples);
                    }
                    if let Ok(mut writer_guard) = writer_clone.lock() {
                        let mut written_count = 0;
                        for &sample_i16 in data.iter() {
                            if writer_guard.write_sample(sample_i16).is_ok() {
                                written_count += 1;
                            } else {
                                eprintln!("[RUST THREAD CB - I16] Error writing sample - stopping write for this chunk.");
                                break;
                            }
                        }
                        if n_samples > 0 && written_count < n_samples {
                            eprintln!("[RUST THREAD CB - I16] Wrote {} out of {} samples in this chunk.", written_count, n_samples);
                        } // Optional: else { println!("[RUST THREAD CB - I16] Wrote all {} samples.", written_count); }
                    } else {
                        eprintln!("[RUST THREAD CB - I16] Failed to lock writer guard.");
                    }
                };
                device.build_input_stream::<i16, _, _>(&stream_config, data_callback, error_callback)
            }
            cpal::SampleFormat::F32 => {
                let data_callback = move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let n_samples = data.len();
                    if n_samples > 0 {
                         println!("[RUST THREAD CB - F32] Received {} samples.", n_samples);
                    }
                    if let Ok(mut writer_guard) = writer_clone.lock() {
                        let mut written_count = 0;
                        for &sample_f32 in data.iter() {
                            let clamped_f32 = sample_f32.max(-1.0).min(1.0);
                            let sample_i16 = (clamped_f32 * std::i16::MAX as f32) as i16;
                            if writer_guard.write_sample(sample_i16).is_ok() {
                                 written_count += 1;
                            } else {
                                eprintln!("[RUST THREAD CB - F32] Error writing sample - stopping write for this chunk.");
                                break; // Stop processing this chunk on error
                            }
                        }
                         if n_samples > 0 && written_count < n_samples {
                             eprintln!("[RUST THREAD CB - F32] Wrote {} out of {} samples in this chunk.", written_count, n_samples);
                         } // Optional: else { println!("[RUST THREAD CB - F32] Wrote all {} samples.", written_count); }
                    } else {
                        eprintln!("[RUST THREAD CB - F32] Failed to lock writer guard.");
                    }
                };
                device.build_input_stream::<f32, _, _>(&stream_config, data_callback, error_callback)
            }
            other_format => {
                eprintln!("[RUST THREAD] Unsupported sample format selected: {:?}", other_format);
                 Err(cpal::BuildStreamError::StreamConfigNotSupported)
            }
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                let err_msg = format!("Failed to build input stream for format {:?}: {}", actual_format, e);
                eprintln!("[RUST THREAD] {}", err_msg);
                let _ = app_handle_for_build_err.emit_all("recording_error", err_msg.clone());
                return; // Exit thread
            }
        };
        println!("[RUST THREAD DEBUG] Input stream built successfully.");

        if let Err(e) = stream.play() {
             eprintln!("[RUST THREAD] Failed to play stream: {}. Emitting error.", e);
             let _ = app_handle_for_play_err.emit_all("recording_error", format!("Stream play failed: {}", e));
             return;
        }
        println!("[RUST THREAD] Stream playing.");

        println!("[RUST THREAD] Waiting for stop signal...");
        let _ = rx_stop.recv();
        println!("[RUST THREAD] Stop signal received.");

        println!("[RUST THREAD] Recording thread finished.");
    });

    // --- Update Tauri State ---
    state_guard.stop_signal_sender = Some(tx_stop);
    state_guard.temp_wav_path = Some(temp_wav_path.clone());
    state_guard.recording_thread_handle = Some(recording_handle);
    state_guard.writer = Some(writer_mutex.clone());
    state_guard.is_actively_recording = true;
    // No need to drop state_guard manually, it drops at end of scope

    println!("[RUST AUDIO] Backend recording started successfully.");
    let _ = app_handle.emit_all("recording_status_changed", "started");
    Ok(())
}


#[command]
pub async fn stop_backend_recording(
    app_handle: AppHandle,
    recording_state: State<'_, SharedRecordingState>,
    transcription_state: State<'_, TranscriptionState>,
    auto_paste: bool,
) -> Result<String, String> {
    println!("[RUST AUDIO STOP] Received stop command. AutoPaste: {}", auto_paste);

    // Use a block to limit the scope of the mutex guard
    let final_path_string = {
        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for stopping: {}", e))?;

        if !state_guard.is_actively_recording {
            println!("[RUST AUDIO STOP] Not actively recording, ignoring stop command.");
            return Err("Not currently recording".to_string());
        }

        // Signal the recording thread to stop
        if let Some(sender) = state_guard.stop_signal_sender.take() {
            println!("[RUST AUDIO STOP] Sending stop signal to recording thread...");
            let _ = sender.send(()); // Ignore potential send error if receiver dropped
        } else {
            println!("[RUST AUDIO WARNING] Stop signal sender was missing, but proceeding.");
        }

        // Wait for the recording thread to finish
        if let Some(handle) = state_guard.recording_thread_handle.take() {
            println!("[RUST AUDIO STOP] Waiting for recording thread to join...");
            if let Err(e) = handle.join() {
                println!("[RUST AUDIO WARNING] Recording thread panicked: {:?}. Attempting finalize anyway.", e);
            } else {
                println!("[RUST AUDIO STOP] Recording thread joined successfully.");
            }
        } else {
             println!("[RUST AUDIO WARNING] Recording thread handle missing, proceeding.");
        }

        // Finalize the WAV writer
        if let Some(writer_arc) = state_guard.writer.take() {
            println!("[RUST AUDIO STOP] Attempting to lock and finalize WAV writer...");
            match Arc::try_unwrap(writer_arc) {
                Ok(mutex) => match mutex.into_inner() {
                    Ok(writer) => {
                         // --- ADD LOGGING --- 
                         println!("[RUST AUDIO STOP] Writer state before finalize: Duration={}ms, Len={}",
                                  writer.duration(), writer.len());
                         // --- END LOGGING --- 
                        if let Err(e) = writer.finalize() {
                             println!("[RUST AUDIO WARNING] Failed to finalize WAV writer: {}. File might be corrupt.", e);
                        } else {
                             println!("[RUST AUDIO STOP] WAV writer finalized successfully.");
                        }
                    },
                    Err(poison_err) => println!("[RUST AUDIO WARNING] WAV writer mutex was poisoned: {}", poison_err),
                },
                Err(_) => println!("[RUST AUDIO WARNING] Failed to unwrap Arc for WAV writer."),
            }
        } else {
             println!("[RUST AUDIO WARNING] Writer missing from state during stop.");
        }

        // Get the path EVEN IF there were errors above, transcription might still work
        let final_path = state_guard.temp_wav_path.take()
            .ok_or("Temporary WAV path missing in state (Major Error!)".to_string())?; // This IS a fatal error
        let path_str = final_path.to_string_lossy().into_owned();
        println!("[RUST AUDIO STOP] Recording stopped. Final WAV path: {}", path_str);

        path_str // Return just the path string
    }; // state_guard lock is released here

    // --- Ensure state is reset even if transcription/paste panics ---
    // The defer block runs *after* the normal return or panic
    defer! {
        match recording_state.lock() {
            Ok(mut state_guard) => {
                // Check again *inside* the guard, as it might have been reset by another thread/call
                if state_guard.is_actively_recording {
                   state_guard.is_actively_recording = false;
                   println!("[RUST AUDIO SCOPEGUARD] FINAL state reset: is_actively_recording set to false.");
                } else {
                    println!("[RUST AUDIO SCOPEGUARD] State was already false when guard ran, no reset needed.");
                }
            }
            Err(e) => {
                 println!("[RUST AUDIO SCOPEGUARD CRITICAL ERROR] Failed to lock state for FINAL reset: {}. State might be inconsistent.", e);
            }
        }
    }

    // --- Start Transcription --- 
    // Now that the audio file is ready and the lock is released, call transcription
    println!("[RUST AUDIO] Invoking transcription for: {}", final_path_string);
    let transcription_result = transcription::transcribe_audio_file(
        app_handle.clone(), // Clone AppHandle
        transcription_state, // Pass the state
        final_path_string, // Pass the path
        auto_paste // <<< ADD auto_paste ARGUMENT BACK
    ).await;


    println!("[RUST AUDIO] Transcription call completed. Result: {:?}", transcription_result);

    // --- Handle Copy/Paste based on transcription_result --- 
    let final_result = match transcription_result {
        Ok(text) => {
            println!("[RUST AUDIO] Transcription successful. Proceeding with Copy/Paste...");
            println!("[RUST AUDIO] Attempting to copy to clipboard...");
            match write_to_clipboard_internal(text.clone()).await { // Clone text for copy
                Ok(_) => {
                    println!("[RUST AUDIO] Copied to clipboard successfully.");
                    if auto_paste { // Use the auto_paste flag passed to stop_backend_recording
                        println!("[RUST AUDIO] Auto-paste enabled, attempting paste...");
                         // NOTE: paste_text_to_cursor takes String, text is already String
                        match paste_text_to_cursor(text.clone()).await { // Clone text again for paste
                            Ok(_) => println!("[RUST AUDIO] Paste command executed OK."),
                            // Log paste error but don't return Err for transcription result itself
                            Err(e) => println!("[RUST AUDIO WARNING] Paste command failed: {}", e),
                        }
                    } else {
                         println!("[RUST AUDIO] Auto-paste disabled.");
                    }
                }
                Err(e) => {
                    println!("[RUST AUDIO WARNING] Failed to copy to clipboard: {}. Skipping paste.", e);
                    // Don't paste if copy failed
                }
            }
            Ok(text) // Return the original transcription text on success
        }
        Err(e) => {
             println!("[RUST AUDIO] Transcription failed: {}", e);
             Err(e) // Propagate the transcription error
        }
    };
    // --- End Copy/Paste Logic ---


    let _ = app_handle.emit_all("recording_status_changed", "stopped");

    // Return the final result (Ok(text) or Err(transcription_error))
    // The scopeguard (defer!) runs *after* this return statement completes successfully
    // or immediately if a panic occurs before this point.
    final_result 
} // defer! block runs automatically after this point on successful return or panic