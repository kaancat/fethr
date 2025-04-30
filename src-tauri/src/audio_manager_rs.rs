#![allow(unused_imports)] // Temp allow while debugging
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;
use tauri::{command, AppHandle, Manager, State};
use uuid::Uuid;
use crate::AudioRecordingState; // Assuming AudioRecordingState is defined in main.rs or lib.rs
use crate::SharedRecordingState;
use crate::transcription::{self, TranscriptionState};
use cpal::SupportedStreamConfig;

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
    
    // Prefer I16 Mono -> F32 Mono -> Any I16 -> Any F32
    let preferred_format_order = [cpal::SampleFormat::I16, cpal::SampleFormat::F32];
    let mut best_config: Option<cpal::SupportedStreamConfig> = None;

    'format_loop: for &format in preferred_format_order.iter() {
        println!("[RUST AUDIO DEBUG] Checking for format: {:?}", format);
        if let Ok(mut configs_iter) = device.supported_input_configs() { // Re-query iterator
             // First, try to find Mono
             if let Some(range) = configs_iter.find(|range| range.sample_format() == format && range.channels() == 1) {
                println!("[RUST AUDIO DEBUG]   -> Found Mono {:?} range.", format);
                // Prefer 48kHz, then 16kHz, then max rate within this range
                let desired_rate = if range.min_sample_rate().0 <= 48000 && range.max_sample_rate().0 >= 48000 {
                    cpal::SampleRate(48000)
                } else if range.min_sample_rate().0 <= 16000 && range.max_sample_rate().0 >= 16000 {
                    cpal::SampleRate(16000)
                } else {
                    range.max_sample_rate()
                };
                println!("[RUST AUDIO DEBUG]   -> Selecting rate: {}", desired_rate.0);
                best_config = Some(range.with_sample_rate(desired_rate));
                break 'format_loop; // Found best mono option
             }
        }
        // If no mono found for this format, try any channel count
        if best_config.is_none() {
             println!("[RUST AUDIO DEBUG] No Mono {:?} found, checking any channel count...", format);
             if let Ok(mut configs_iter) = device.supported_input_configs() { // Re-query iterator
                 if let Some(range) = configs_iter.find(|range| range.sample_format() == format) {
                     println!("[RUST AUDIO DEBUG]   -> Found {:?} range ({} channels). Selecting max rate: {}", format, range.channels(), range.max_sample_rate().0);
                     best_config = Some(range.with_max_sample_rate());
                     break 'format_loop; // Found first available option for this format
                 }
             }
        }
         println!("[RUST AUDIO DEBUG] No {:?} configs found.", format);
    } // End format loop

    let supported_config = best_config
            .ok_or_else(|| "No supported I16 or F32 input config found".to_string())?;
    // --- End Config Finding Logic ---


    let actual_sample_rate = supported_config.sample_rate().0;
    let stream_config: cpal::StreamConfig = supported_config.config(); // Use .config() for cpal 0.14
    let actual_format = supported_config.sample_format(); // Store the format we actually got

    println!("[RUST AUDIO] Selected config: Rate: {}, Channels: {}, Format: {:?}",
        actual_sample_rate, stream_config.channels, actual_format); // Log selected config

    // --- Configure WAV Writer --- (Always use I16 for output WAV)
    let spec = hound::WavSpec { 
        channels: 1, // Output WAV is always mono
        sample_rate: actual_sample_rate, // Use the rate we actually capture at
        bits_per_sample: 16, 
        sample_format: hound::SampleFormat::Int 
    };
    let writer = hound::WavWriter::create(&temp_wav_path, spec)
        .map_err(|e| format!("Failed to create WavWriter: {}", e))?;
    let writer_mutex = Arc::new(Mutex::new(writer));

    // --- Clone Arcs for Thread ---
    let writer_clone = writer_mutex.clone();
    let app_handle_for_error_cb = app_handle.clone(); 
    let app_handle_for_build_err = app_handle.clone(); // Clone for build error handling
    let app_handle_for_play_err = app_handle.clone(); // Clone for play error handling

    // --- Spawn Recording Thread ---
    let recording_handle = thread::spawn(move || {
        println!("[RUST THREAD] Recording thread started.");

        // Define error callback once (captures app_handle_for_error_cb)
        let error_callback = move |err| {
            eprintln!("[RUST THREAD CB] CPAL stream error: {}", err);
            let _ = app_handle_for_error_cb.emit_all("recording_error", format!("CPAL Stream Error: {}", err)); 
        };
        
        // --- Build stream based on actual_format ---
        println!("[RUST THREAD DEBUG] Building stream for format: {:?}", actual_format);
        let stream = match actual_format {
            cpal::SampleFormat::I16 => {
                let data_callback = move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    // Direct write for I16
                    if let Ok(mut writer_guard) = writer_clone.lock() {
                        for &sample in data.iter() {
                            if writer_guard.write_sample(sample).is_err() {
                                 eprintln!("[RUST THREAD CB - I16] Error writing sample."); break;
                            }
                        }
                    } else { eprintln!("[RUST THREAD CB - I16] Failed to lock writer mutex."); }
                };
                // Build the stream for I16
                device.build_input_stream::<i16, _, _>(&stream_config, data_callback, error_callback)
            }
            cpal::SampleFormat::F32 => {
                let data_callback = move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    // Convert F32 to I16 before writing
                    if let Ok(mut writer_guard) = writer_clone.lock() {
                        for &sample_f32 in data.iter() {
                            // Clamp to prevent overflow/wrap-around on conversion
                            let clamped_f32 = sample_f32.max(-1.0).min(1.0);
                            let sample_i16 = (clamped_f32 * std::i16::MAX as f32) as i16;
                            if writer_guard.write_sample(sample_i16).is_err() {
                                eprintln!("[RUST THREAD CB - F32] Error writing sample."); break;
                            }
                        }
                    } else { eprintln!("[RUST THREAD CB - F32] Failed to lock writer mutex."); }
                };
                // Build the stream for F32
                 device.build_input_stream::<f32, _, _>(&stream_config, data_callback, error_callback)
            }
            other_format => {
                eprintln!("[RUST THREAD] Unsupported sample format selected: {:?}", other_format);
                // Handle other formats if necessary, or return error
                 Err(cpal::BuildStreamError::StreamConfigNotSupported)
            }
        }
        // Consolidate error handling for build_input_stream
        .map_err(|e| {
             let err_msg = format!("Failed to build input stream for format {:?}: {}", actual_format, e);
             eprintln!("[RUST THREAD] {}", err_msg);
             // Use the separate clone for build error reporting
             let _ = app_handle_for_build_err.emit_all("recording_error", err_msg.clone()); 
             err_msg // Return the error message for the thread spawn result
        });
        
        // Check if stream building failed
        let stream = match stream {
            Ok(s) => s,
            Err(e) => return, // Exit thread if stream build failed
        };

        println!("[RUST THREAD DEBUG] Input stream built successfully.");

        // Play the stream
        if let Err(e) = stream.play() {
             eprintln!("[RUST THREAD] Failed to play stream: {}. Emitting error.", e);
             // Use the play error clone
             let _ = app_handle_for_play_err.emit_all("recording_error", format!("Stream play failed: {}", e));
             return;
        }
        println!("[RUST THREAD] Stream playing.");

        // --- Wait for Stop Signal ---
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
    drop(state_guard);

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
    println!("[RUST AUDIO] stop_backend_recording command received");

    // --- Extract state ---
    let (stop_sender_opt, path_opt, join_handle_opt, writer_arc_mutex_opt) = {
        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state: {}", e))?;
        if !state_guard.is_actively_recording {
            return Err("Not actively recording".to_string());
        }
        println!("[RUST AUDIO] Preparing to stop recording...");
        
        (   state_guard.stop_signal_sender.take(),
            state_guard.temp_wav_path.take(),
            state_guard.recording_thread_handle.take(),
            state_guard.writer.take()
        )
    };

    // --- Signal and Wait for Thread ---
    if let Some(tx_stop) = stop_sender_opt {
        println!("[RUST AUDIO] Signaling recording thread to stop...");
        drop(tx_stop);
    } else {
        if let Ok(mut state_guard) = recording_state.lock() {
            state_guard.is_actively_recording = false;
        }
        return Err("Stop signal sender was missing in state.".to_string());
    }

    if let Some(handle) = join_handle_opt {
        println!("[RUST AUDIO] Waiting for recording thread to join...");
        if handle.join().is_err() {
            println!("[RUST AUDIO WARNING] Recording thread panicked!");
            if let Ok(mut state_guard) = recording_state.lock() {
                state_guard.is_actively_recording = false;
            }
            return Err("Recording thread panicked".to_string());
        } else {
            println!("[RUST AUDIO] Recording thread joined successfully.");
        }
    } else {
        if let Ok(mut state_guard) = recording_state.lock() {
            state_guard.is_actively_recording = false;
        }
        return Err("Recording thread handle missing.".to_string());
    }

    // --- Finalize Writer ---
    let final_path = match path_opt { 
        Some(p) => p,
        None => {
            let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for missing path error: {}", e))?;
            state_guard.is_actively_recording = false;
            println!("[RUST AUDIO ERROR] WAV path missing, resetting state and returning error.");
            return Err("WAV path was missing in state.".to_string());
        }
    };
    let final_path_string: String;
    println!("[RUST AUDIO] Attempting to finalize WAV file at: {}", final_path.display());
    if let Some(writer_arc_mutex) = writer_arc_mutex_opt {
        match Arc::try_unwrap(writer_arc_mutex) {
            Ok(writer_mutex) => {
                match writer_mutex.into_inner() {
                    Ok(writer) => {
                        if let Err(e) = writer.finalize() {
                            let err_msg = format!("Failed to finalize WavWriter: {}", e);
                            println!("[RUST AUDIO ERROR] {}", err_msg);
                            let _ = std::fs::remove_file(&final_path);
                            let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for finalize error: {}", e))?;
                            state_guard.is_actively_recording = false;
                            println!("[RUST AUDIO] Finalize failed, resetting state and returning error.");
                            return Err(err_msg); 
                        }
                        println!("[RUST AUDIO] WAV file finalized successfully.");
                        final_path_string = final_path.to_string_lossy().into_owned();
                    }
                    Err(poisoned) => {
                        let err_msg = format!("WavWriter Mutex was poisoned: {:?}", poisoned);
                        println!("[RUST AUDIO ERROR] {}", err_msg);
                        let _ = std::fs::remove_file(&final_path);
                        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for poison error: {}", e))?;
                        state_guard.is_actively_recording = false;
                        println!("[RUST AUDIO] Mutex poisoned, resetting state and returning error.");
                        return Err(err_msg);
                    }
                }
            }
            Err(_) => { 
                let err_msg = "Failed to get exclusive ownership of WavWriter Arc".to_string();
                println!("[RUST AUDIO ERROR] {}", err_msg);
                let _ = std::fs::remove_file(&final_path);
                let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for Arc unwrap error: {}", e))?;
                state_guard.is_actively_recording = false;
                println!("[RUST AUDIO] Arc unwrap failed, resetting state and returning error.");
                return Err(err_msg);
            }
        }
    } else { 
        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for missing writer error: {}", e))?;
        state_guard.is_actively_recording = false;
        println!("[RUST AUDIO ERROR] Writer missing, resetting state and returning error.");
        return Err("Writer was missing from state.".to_string()); 
    }

    // --- Call Transcription ---
    if !final_path.exists() {
        let err_msg = format!("Final WAV file does not exist after finalize: {}", final_path.display());
        println!("[RUST AUDIO ERROR] {}", err_msg);
        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for missing file error: {}", e))?;
        state_guard.is_actively_recording = false;
        println!("[RUST AUDIO] File missing post-finalize, resetting state and returning error.");
        return Err(err_msg);
    }
    println!("[RUST AUDIO] Proceeding to transcription for path: {}", final_path_string);
    let transcription_result = transcription::transcribe_local_audio_impl(
        app_handle.clone(),
        transcription_state,
        final_path_string.clone(), 
        auto_paste
    ).await;

    println!("[RUST AUDIO] Transcription call completed. Result: {:?}", transcription_result);

    // --- SET is_actively_recording = false HERE --- 
    { 
        match recording_state.lock() {
            Ok(mut state_guard) => {
                state_guard.is_actively_recording = false;
                println!("[RUST AUDIO] FINAL state reset: is_actively_recording set to false.");
            }
            Err(e) => {
                println!("[RUST AUDIO CRITICAL ERROR] Failed to lock state for FINAL reset: {}. State might be inconsistent.", e);
            }
        }
    } 

    let _ = app_handle.emit_all("recording_status_changed", "stopped");
    transcription_result
}

// We might need helper functions here later for cpal setup/callback 