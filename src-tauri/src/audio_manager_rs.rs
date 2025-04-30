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

    // --- Get CPAL Device and Log Supported Configs ---
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| "No input device available".to_string())?;
    println!("[RUST AUDIO DEBUG] Default input device: {:?}", device.name().unwrap_or_else(|_| "Unnamed".to_string()));

    // --- Log Available Configs --- (Already added in previous step, verify it remains)
    println!("[RUST AUDIO DEBUG] Querying supported input configs...");
    match device.supported_input_configs() {
        Ok(configs) => {
            println!("[RUST AUDIO DEBUG] --- Available Input Configs (Raw Ranges) ---");
            let mut count = 0;
            for config_range in configs { 
                 println!(
                    "[RUST AUDIO DEBUG]   - Range: Channels: {}, Min Rate: {}, Max Rate: {}, Format: {:?}",
                    config_range.channels(),
                    config_range.min_sample_rate().0,
                    config_range.max_sample_rate().0,
                    config_range.sample_format()
                );
                count += 1;
            }
            println!("[RUST AUDIO DEBUG] --- End Config Ranges (Found {}) ---", count);
            if count == 0 {
                 println!("[RUST AUDIO WARNING] No supported input config ranges returned by the iterator!");
            }
        }
        Err(e) => {
            println!("[RUST AUDIO ERROR] Failed to get supported input configs initially: {}", e);
            // If the initial query fails, the next one likely will too, but we try anyway.
        }
    }
    // --- End Logging ---

    // --- Find Supported Config (cpal 0.14.2 logic) ---
    let supported_config = device.supported_input_configs()
        .map_err(|e| format!("Failed to query input configs: {}", e))?
        .find_map(|range| { // Iterate through SupportedStreamConfigRange
            println!("[RUST AUDIO DEBUG] Checking Range: Channels: {}, Min Rate: {}, Max Rate: {}, Format: {:?}",
                range.channels(), range.min_sample_rate().0, range.max_sample_rate().0, range.sample_format());

            // Check format and channels FIRST
            if range.sample_format() == cpal::SampleFormat::I16 && range.channels() == 1 {
                // Try to get 16kHz if supported by this range
                if range.min_sample_rate().0 <= 16000 && range.max_sample_rate().0 >= 16000 {
                    println!("[RUST AUDIO DEBUG]   -> Found I16 Mono Range supporting 16kHz. Selecting 16kHz.");
                    Some(range.with_sample_rate(cpal::SampleRate(16000))) // Return specific config
                } else {
                    // Otherwise, take the max rate this range offers
                    println!("[RUST AUDIO DEBUG]   -> Found I16 Mono Range (doesn't support 16kHz). Selecting max rate: {}", range.max_sample_rate().0);
                    Some(range.with_max_sample_rate()) // Return specific config
                }
            } else {
                None // Skip this range if format/channels don't match
            }
        })
        // If NO I16 Mono range was found after checking all ranges:
        .or_else(|| {
             println!("[RUST AUDIO DEBUG] No I16 Mono config found. Looking for *ANY* I16 config...");
             device.supported_input_configs().ok()? // Re-query needed
                .find_map(|range| { // Iterate again
                     println!("[RUST AUDIO DEBUG] Checking Range (any channel): Channels: {}, Min Rate: {}, Max Rate: {}, Format: {:?}",
                         range.channels(), range.min_sample_rate().0, range.max_sample_rate().0, range.sample_format());
                    if range.sample_format() == cpal::SampleFormat::I16 {
                        println!("[RUST AUDIO DEBUG]   -> Found I16 Range (any channel). Selecting max rate: {}", range.max_sample_rate().0);
                        Some(range.with_max_sample_rate()) // Take the max rate
                    } else {
                        None
                    }
                })
        })
        // If STILL no I16 config found at all:
        .ok_or_else(|| "No supported I16 input config found".to_string())?; // Final error
    // --- End Config Finding Logic ---

    let actual_sample_rate = supported_config.sample_rate().0;
    let stream_config: cpal::StreamConfig = supported_config.config();
    println!("[RUST AUDIO] Selected config: Rate: {}, Channels: {}, Format: {:?}",
        actual_sample_rate, stream_config.channels, supported_config.sample_format());

    // --- Configure WAV Writer using ACTUAL sample rate ---
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: actual_sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int
    };
    let writer = hound::WavWriter::create(&temp_wav_path, spec)
        .map_err(|e| format!("Failed to create WavWriter: {}", e))?;
    let writer_mutex = Arc::new(Mutex::new(writer));

    // --- Clone Arcs for Thread ---
    let writer_clone = writer_mutex.clone();
    let app_handle_for_error_cb = app_handle.clone(); // Clone #1 for the error callback
    let app_handle_for_play_err = app_handle.clone(); // Clone #2 for play() error

    // --- Spawn Recording Thread ---
    let recording_handle = thread::spawn(move || {
        println!("[RUST THREAD] Recording thread started.");
        
        let data_callback = move |data: &[i16], _: &cpal::InputCallbackInfo| {
            if let Ok(mut writer_guard) = writer_clone.lock() {
                for &sample in data.iter() {
                    if writer_guard.write_sample(sample).is_err() {
                        eprintln!("[RUST THREAD CB] Error writing sample.");
                    }
                }
            } else { 
                eprintln!("[RUST THREAD CB] Failed to lock writer mutex."); 
            }
        };

        let error_callback = move |err| {
            eprintln!("[RUST THREAD CB] CPAL stream error: {}", err);
            // Use the first clone here
            let _ = app_handle_for_error_cb.emit_all("recording_error", format!("CPAL Error: {}", err)); 
        };

        // Build the input stream
        println!("[RUST AUDIO] Building input stream with config: {:?}", stream_config);
        let stream = match device.build_input_stream(
            &stream_config,
            data_callback, 
            error_callback
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[RUST THREAD] Failed to build input stream: {}. Emitting error.", e);
                 // Use the second clone here
                let _ = app_handle_for_play_err.emit_all("recording_error", format!("Stream build failed: {}", e));
                return;
            }
        };

        if let Err(e) = stream.play() {
             eprintln!("[RUST THREAD] Failed to play stream: {}. Emitting error.", e);
             // Use the second clone here as well
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
    state_guard.writer = Some(writer_mutex.clone()); // Store the writer mutex

    // Crucially, set the recording flag only AFTER everything is set up
    state_guard.is_actively_recording = true; 
    drop(state_guard); // Release lock

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