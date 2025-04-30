use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;
use tauri::{command, AppHandle, Manager, State};
use uuid::Uuid;

use crate::SharedRecordingState;
use crate::transcription::{self, TranscriptionState};

#[command]
pub async fn start_backend_recording(
    app_handle: AppHandle,
    recording_state: State<'_, SharedRecordingState>,
) -> Result<(), String> {
    println!("[RUST AUDIO] start_backend_recording command received");

    let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state: {}", e))?;

    if state_guard.is_actively_recording {
        println!("[RUST AUDIO WARN] Initial check failed: Already recording");
        return Err("Already recording".to_string());
    }

    if state_guard.is_actively_recording {
         println!("[RUST AUDIO WARN] Second check failed: State changed unexpectedly? Already recording");
        return Err("Already recording".to_string());
    }

    // --- Setup IDs and Paths ---
    let unique_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir();
    let temp_wav_path = temp_dir.join(format!("fethr_rec_{}.wav", unique_id));
    println!("[RUST AUDIO] Recording path: {}", temp_wav_path.display());

    // --- Setup Channel for Stop Signal ---
    let (tx_stop, rx_stop): (mpsc::Sender<()>, mpsc::Receiver<()>) = mpsc::channel();

    // --- Get CPAL Config FIRST to determine actual sample rate ---
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| "No input device available".to_string())?;
    let supported_config = device.supported_input_configs()
        .map_err(|e| format!("Failed to query input configs: {}", e))?
        .find(|c| c.sample_format() == cpal::SampleFormat::I16 && c.channels() == 1 && 
              c.min_sample_rate().0 <= 16000 && c.max_sample_rate().0 >= 16000)
        .map(|c| c.with_sample_rate(cpal::SampleRate(16000)))
        .or_else(|| device.supported_input_configs().ok()?
            .find(|c| c.sample_format() == cpal::SampleFormat::I16)
            .map(|c| c.with_max_sample_rate()))
        .ok_or_else(|| "No supported I16 input config found".to_string())?;
    
    let actual_sample_rate = supported_config.sample_rate().0;
    let stream_config: cpal::StreamConfig = supported_config.clone().into(); // Clone needed as supported_config is used later
    println!("[RUST AUDIO] Actual sample rate to be used: {}", actual_sample_rate);

    // --- Configure WAV Writer using ACTUAL sample rate ---
    let spec = hound::WavSpec { 
        channels: 1, 
        sample_rate: actual_sample_rate, // **** USE ACTUAL RATE ****
        bits_per_sample: 16, 
        sample_format: hound::SampleFormat::Int 
    };
    let writer = hound::WavWriter::create(&temp_wav_path, spec)
        .map_err(|e| format!("Failed to create WavWriter: {}", e))?;
    let writer_mutex = Arc::new(Mutex::new(writer));

    // --- Clone Arcs for Thread ---
    let writer_clone = writer_mutex.clone();
    let app_handle_clone = app_handle.clone();

    // --- Spawn Recording Thread ---
    let recording_handle = thread::spawn(move || {
        println!("[RUST THREAD] Recording thread started.");
        
        // --- Define Callbacks --- (Using stream_config from outer scope)
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
            let _ = app_handle_clone.emit_all("recording_error", format!("CPAL Error: {}", err));
        };

        // --- Build and Play Stream ---
        let stream = device.build_input_stream(&stream_config, data_callback, error_callback)
            .expect("Failed to build input stream");
        stream.play().expect("Failed to play stream");
        println!("[RUST THREAD] Stream playing.");

        // --- Wait for Stop Signal ---
        println!("[RUST THREAD] Waiting for stop signal...");
        let _ = rx_stop.recv(); // Block until sender drops or sends signal
        println!("[RUST THREAD] Stop signal received.");
        
        // Stream and writer_clone are dropped automatically when thread ends
        println!("[RUST THREAD] Recording thread finished.");
    });

    // --- Update Tauri State ---
    state_guard.stop_signal_sender = Some(tx_stop);
    state_guard.temp_wav_path = Some(temp_wav_path.clone());
    state_guard.recording_thread_handle = Some(recording_handle);
    state_guard.writer = Some(writer_mutex.clone());

    println!("[RUST AUDIO DEBUG] >>> Preparing to set is_actively_recording=true <<< Checkpoint A");
    drop(state_guard);

    match recording_state.lock() {
        Ok(mut final_state_guard) => {
            final_state_guard.is_actively_recording = true;
             println!("[RUST AUDIO DEBUG] >>> State set: is_actively_recording=true <<< Checkpoint C");
        }
        Err(e) => {
            eprintln!("[RUST AUDIO CRITICAL] Failed to re-lock state to set is_actively_recording=true: {}. State might be inconsistent.", e);
            return Err(format!("Failed to set final recording state: {}", e));
        }
    }

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
        
        // Take ownership of the options needed to stop/finalize
        (
            state_guard.stop_signal_sender.take(),
            state_guard.temp_wav_path.take(),
            state_guard.recording_thread_handle.take(),
            state_guard.writer.take()
        )
    };

    // --- Signal and Wait for Thread ---
    if let Some(tx_stop) = stop_sender_opt {
        println!("[RUST AUDIO] Signaling recording thread to stop...");
        drop(tx_stop); // Dropping sender signals receiver
    } else {
        // Reset recording state before returning error
        if let Ok(mut state_guard) = recording_state.lock() {
            state_guard.is_actively_recording = false;
        }
        return Err("Stop signal sender was missing in state.".to_string());
    }

    if let Some(handle) = join_handle_opt {
        println!("[RUST AUDIO] Waiting for recording thread to join...");
        if handle.join().is_err() {
            println!("[RUST AUDIO WARNING] Recording thread panicked!");
            // Even if thread panicked, ensure state is reset
            if let Ok(mut state_guard) = recording_state.lock() {
                state_guard.is_actively_recording = false;
            }
            return Err("Recording thread panicked".to_string());
        } else {
            println!("[RUST AUDIO] Recording thread joined successfully.");
        }
    } else {
        // Reset recording state before returning error
        if let Ok(mut state_guard) = recording_state.lock() {
            state_guard.is_actively_recording = false;
        }
        return Err("Recording thread handle missing.".to_string());
    }

    // --- Finalize Writer ---
    let final_path = match path_opt { // Use match to handle Option before finalization logic
        Some(p) => p,
        None => {
            // Reset state before returning error
            let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for missing path error: {}", e))?;
            state_guard.is_actively_recording = false;
            println!("[RUST AUDIO ERROR] WAV path missing, resetting state and returning error.");
            return Err("WAV path was missing in state.".to_string());
        }
    };
    let final_path_string; // Declare variable for path string
    println!("[RUST AUDIO] Attempting to finalize WAV file at: {}", final_path.display());
    if let Some(writer_arc_mutex) = writer_arc_mutex_opt {
        match Arc::try_unwrap(writer_arc_mutex) {
            Ok(writer_mutex) => {
                match writer_mutex.into_inner() {
                    Ok(writer) => {
                        if let Err(e) = writer.finalize() {
                            let err_msg = format!("Failed to finalize WavWriter: {}", e);
                            println!("[RUST AUDIO ERROR] {}", err_msg);
                            let _ = std::fs::remove_file(&final_path); // Attempt cleanup
                            // Reset state before returning error
                            let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for finalize error: {}", e))?;
                            state_guard.is_actively_recording = false;
                            println!("[RUST AUDIO] Finalize failed, resetting state and returning error.");
                            return Err(err_msg); 
                        }
                        println!("[RUST AUDIO] WAV file finalized successfully.");
                        final_path_string = final_path.to_string_lossy().into_owned(); // Assign path string on success
                    }
                    Err(poisoned) => {
                        let err_msg = format!("WavWriter Mutex was poisoned: {:?}", poisoned);
                        println!("[RUST AUDIO ERROR] {}", err_msg);
                        let _ = std::fs::remove_file(&final_path); // Attempt cleanup
                        // Reset state before returning error
                        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for poison error: {}", e))?;
                        state_guard.is_actively_recording = false;
                        println!("[RUST AUDIO] Mutex poisoned, resetting state and returning error.");
                        return Err(err_msg);
                    }
                }
            }
            Err(_) => { // Error trying to unwrap Arc
                let err_msg = "Failed to get exclusive ownership of WavWriter Arc".to_string();
                println!("[RUST AUDIO ERROR] {}", err_msg);
                let _ = std::fs::remove_file(&final_path); // Attempt cleanup
                // Reset state before returning error
                let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for Arc unwrap error: {}", e))?;
                state_guard.is_actively_recording = false;
                println!("[RUST AUDIO] Arc unwrap failed, resetting state and returning error.");
                return Err(err_msg);
            }
        }
    } else { // writer_arc_mutex_opt was None
        // Reset state before returning error
        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for missing writer error: {}", e))?;
        state_guard.is_actively_recording = false;
        println!("[RUST AUDIO ERROR] Writer missing, resetting state and returning error.");
        return Err("Writer was missing from state.".to_string()); 
    }

    // --- Call Transcription ---
    // Check file existence *after* successful finalization
    if !final_path.exists() {
        let err_msg = format!("Final WAV file does not exist after finalize: {}", final_path.display());
        println!("[RUST AUDIO ERROR] {}", err_msg);
        // Reset state before returning error
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

    // --- *** SET is_actively_recording = false HERE (Finally!) *** ---
    // This executes AFTER transcription attempt (Ok or Err) and BEFORE returning.
    { 
        match recording_state.lock() {
            Ok(mut state_guard) => {
                state_guard.is_actively_recording = false;
                println!("[RUST AUDIO] FINAL state reset: is_actively_recording set to false.");
            }
            Err(e) => {
                // Log error, but proceed to return result anyway
                println!("[RUST AUDIO CRITICAL ERROR] Failed to lock state for FINAL reset: {}. State might be inconsistent.", e);
            }
        }
    } 

    let _ = app_handle.emit_all("recording_status_changed", "stopped");
    // Return the result (Ok or Err) from the transcription call
    transcription_result
}

// We might need helper functions here later for cpal setup/callback 