#![allow(unused_imports)] // Temp allow while debugging
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::thread::JoinHandle;
use tauri::{command, AppHandle, Manager, State};
use uuid::Uuid;
use log::{error, info, warn};
use crate::SharedRecordingState; // Import SharedRecordingState from main/lib
use crate::transcription::{self, TranscriptionState}; // Import transcription state
use cpal::{SupportedStreamConfig, SampleFormat, SampleRate};
use std::fs::File;
use std::io::BufWriter;
use scopeguard::defer;
use std::time::Duration;
use std::path::PathBuf;
use serde::Deserialize;

// Add imports for the new state management
use crate::RECORDING_LIFECYCLE;
use crate::RecordingLifecycle; // Import the enum itself
use crate::config::SETTINGS; // Import the config settings

// --- ADD THESE IMPORTS ---
use crate::{write_to_clipboard_internal, paste_text_to_cursor}; // Import from main.rs
// --- END IMPORTS ---

#[derive(Deserialize, Debug)]
pub struct StopRecordingPayloadArgs {
    auto_paste: bool,
    user_id: Option<String>,    // Optional: User might not be logged in
    access_token: Option<String>, // Optional: User might not be logged in
}

#[derive(Deserialize, Debug)]
pub struct StartRecordingPayloadArgs {
    user_id: Option<String>,    // Optional: User might not be logged in
    access_token: Option<String>, // Optional: User might not be logged in
}

#[command]
pub async fn start_backend_recording(
    app_handle: AppHandle,
    audio_state: State<'_, SharedRecordingState>,
    args: StartRecordingPayloadArgs,
) -> Result<(), String> {
    println!("[RUST AUDIO] start_backend_recording command received");
    println!("[RUST AUDIO] User ID: {:?}, Access Token present: {}", args.user_id, args.access_token.is_some());

    // Check if user is authenticated
    if args.user_id.is_none() || args.access_token.is_none() {
        println!("[RUST AUDIO] No authentication provided - rejecting recording start");
        return Err("Authentication required to start recording".to_string());
    }

    let session_active_flag = Arc::new(AtomicBool::new(true)); // Create flag for this session

    // --- Lock and Check Lifecycle State FIRST ---
    { // Scope for lifecycle lock
        let mut lifecycle_guard = RECORDING_LIFECYCLE.lock().unwrap();
        println!("[RUST AUDIO] Checking lifecycle state: {:?}", *lifecycle_guard);
        match *lifecycle_guard {
            RecordingLifecycle::Idle => {
                // It's Idle, okay to proceed. Update lifecycle state.
                println!("[RUST AUDIO] Lifecycle is Idle. Transitioning to Recording.");
                *lifecycle_guard = RecordingLifecycle::Recording(session_active_flag.clone()); // Store the flag
            }
            _ => {
                // Already Recording or Stopping
                println!("[RUST AUDIO WARN] Lifecycle not Idle ({:?}). Cannot start new recording.", *lifecycle_guard);
                return Err(format!("Cannot start recording, lifecycle state is: {:?}", *lifecycle_guard));
            }
        }
    } // Lifecycle lock released
    // --- End Lifecycle Check ---


    // --- Proceed with Audio Setup (if lifecycle was Idle) ---
    let mut audio_state_guard = audio_state.lock().map_err(|e| format!("Failed to lock audio state: {}", e))?;

    let unique_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir();
    let temp_wav_path = temp_dir.join(format!("fethr_rec_{}.wav", unique_id));
    println!("[RUST AUDIO] Recording path: {}", temp_wav_path.display());
    let (tx_stop, rx_stop) = mpsc::channel();

    let _host = cpal::default_host();
    
    // Use the audio device manager to get the selected device
    use crate::audio_devices::AUDIO_DEVICE_MANAGER;
    let device = AUDIO_DEVICE_MANAGER.get_selected_device()
        .ok_or_else(|| "No input device available".to_string())?;
    
    let device_name = device.name().unwrap_or_else(|_| "Unnamed".to_string());
    println!("[RUST AUDIO DEBUG] Using input device: {}", device_name);

    println!("[RUST AUDIO DEBUG] Finding best supported input config...");
    let preferred_format_order = [SampleFormat::I16, SampleFormat::F32];
    let mut best_config: Option<cpal::SupportedStreamConfig> = None;
   
    // Keep the existing config finding logic
    'format_loop: for &format in preferred_format_order.iter() {
        if let Ok(mut configs_iter) = device.supported_input_configs() {
            if let Some(range) = configs_iter.find(|range| range.sample_format() == format && range.channels() == 1) {
                println!("[RUST AUDIO DEBUG]   -> Found Mono {:?} range.", format);
                let desired_rate = if range.min_sample_rate().0 <= 48000 && range.max_sample_rate().0 >= 48000 { SampleRate(48000) }
                                    else if range.min_sample_rate().0 <= 16000 && range.max_sample_rate().0 >= 16000 { SampleRate(16000) }
                                    else { range.max_sample_rate() };
                println!("[RUST AUDIO DEBUG]   -> Selecting rate: {}", desired_rate.0);
                best_config = Some(range.with_sample_rate(desired_rate));
                break 'format_loop;
            }
        }
        if best_config.is_none() {
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
    let actual_sample_rate = supported_config.sample_rate().0;
    let stream_config: cpal::StreamConfig = supported_config.config();
    let actual_format = supported_config.sample_format();
    println!("[RUST AUDIO] Selected config: Rate: {}, Channels: {}, Format: {:?}", actual_sample_rate, stream_config.channels, actual_format);

    let spec = hound::WavSpec { channels: 1, sample_rate: actual_sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let writer = hound::WavWriter::create(&temp_wav_path, spec).map_err(|e| format!("Failed to create WavWriter: {}", e))?;
    let writer_mutex: Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>> = Arc::new(Mutex::new(Some(writer)));

    // --- Recording Thread (Needs the flag) ---
    let writer_clone = Arc::clone(&writer_mutex);
    let session_active_clone = session_active_flag.clone(); // Clone flag for the thread
    let _app_handle_for_error_cb = app_handle.clone();
    let _app_handle_for_build_err = app_handle.clone();
    let _app_handle_for_play_err = app_handle.clone();

    let recording_handle = thread::spawn(move || {
        println!("[RUST THREAD] Recording thread started.");
        
        // Defer is optional now, stop command explicitly sets flag false
        defer! ({
            println!("[RUST THREAD Defer] Setting session active flag FALSE.");
            session_active_clone.store(false, Ordering::SeqCst);
        });

        let error_callback = move |_err| { /* Same as before */ };

        println!("[RUST THREAD DEBUG] Building stream for format: {:?}", actual_format);
        let stream_result = match actual_format {
            SampleFormat::I16 => {
                let data_callback = move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut writer_opt_guard) = writer_clone.lock() {
                        if let Some(writer_guard) = writer_opt_guard.as_mut() {
                             for &sample in data.iter() { if writer_guard.write_sample(sample).is_err() { break; } }
                        }
                    }
                };
                device.build_input_stream::<i16, _, _>(&stream_config, data_callback, error_callback)
            }
            SampleFormat::F32 => {
                let data_callback = move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut writer_opt_guard) = writer_clone.lock() {
                        if let Some(writer_guard) = writer_opt_guard.as_mut() {
                            for &sample_f32 in data.iter() {
                                let clamped_f32 = sample_f32.max(-1.0).min(1.0);
                                let sample_i16 = (clamped_f32 * std::i16::MAX as f32) as i16;
                                if writer_guard.write_sample(sample_i16).is_err() { break; }
                            }
                        }
                    }
                };
                device.build_input_stream::<f32, _, _>(&stream_config, data_callback, error_callback)
            }
            _ => Err(cpal::BuildStreamError::StreamConfigNotSupported)
        };

        let stream = match stream_result { 
            Ok(s) => s, 
            Err(e) => { 
                println!("[RUST THREAD ERROR] Failed to build stream: {:?}", e); 
                return; 
            } 
        };

        if let Err(e) = stream.play() { 
            println!("[RUST THREAD ERROR] Failed to play stream: {:?}", e); 
            return; 
        }
        println!("[RUST THREAD] Stream playing.");

        // --- Loop checking channel and flag (unchanged) ---
        loop {
            // Try receiving stop signal without blocking indefinitely
            match rx_stop.try_recv() {
                Ok(_) => { // Stop signal received
                    println!("[RUST THREAD] Stop signal received via channel.");
                    break; // Exit loop to stop recording
                }
                Err(mpsc::TryRecvError::Empty) => {
                    // No signal yet, check atomic flag
                    if !session_active_clone.load(Ordering::SeqCst) {
                         println!("[RUST THREAD] Session flag became false. Stopping.");
                         break; // Exit loop if flag externaly set false
                    }
                    // Flag is still true, no signal, sleep briefly
                    thread::sleep(Duration::from_millis(50)); // Check ~20 times/sec
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                     println!("[RUST THREAD ERR] Stop signal sender disconnected! Stopping.");
                     break; // Exit loop if channel broken
                }
            }
        }
        // --- End Loop ---

        println!("[RUST THREAD] Stopping stream and thread.");
        drop(stream); // Ensure stream is dropped before thread ends
    });
    // --- End Recording Thread ---


    // --- Store details in AudioRecordingState ---
    audio_state_guard.stop_signal_sender = Some(tx_stop);
    audio_state_guard.temp_wav_path = Some(temp_wav_path);
    audio_state_guard.recording_thread_handle = Some(recording_handle); // Store JoinHandle
    audio_state_guard.writer = Some(writer_mutex);
    // No need to store the Arc<AtomicBool> here anymore

    println!("[RUST AUDIO] Backend recording started successfully.");
    let _ = app_handle.emit_all("recording_status_changed", "started");
    Ok(())
}


#[command]
pub async fn stop_backend_recording(
    app_handle: AppHandle,
    audio_state: State<'_, SharedRecordingState>,
    transcription_state: State<'_, TranscriptionState>,
    args: StopRecordingPayloadArgs,
) -> Result<String, String> {
    info!("[RUST AUDIO STOP] Received stop command. Payload: {:?}", args);
    info!("[RUST AUDIO STOP] User ID: {:?}, Access Token present: {}", args.user_id, args.access_token.is_some());

    // Get auto_paste setting from config if needed
    let effective_auto_paste = {
        if !args.auto_paste {
            // If auto_paste is false in the command, use that
            false
        } else {
            // Otherwise, check the config setting
            let settings_guard = SETTINGS.lock().unwrap();
            settings_guard.auto_paste
        }
    };
    info!("[RUST AUDIO STOP] Effective auto_paste setting: {}", effective_auto_paste);

    let session_active_flag: Arc<AtomicBool>; // Flag to signal thread

    // --- Block 1: Check Lifecycle, Signal Stop ---
    {
        let mut lifecycle_guard = RECORDING_LIFECYCLE.lock().unwrap();
        println!("[RUST AUDIO STOP] Checking lifecycle state: {:?}", *lifecycle_guard);

        match &*lifecycle_guard {
            RecordingLifecycle::Recording(flag) => {
                 println!("[RUST AUDIO STOP] Lifecycle is Recording. Transitioning to Stopping.");
                 session_active_flag = flag.clone(); // Get the flag for this session
                 *lifecycle_guard = RecordingLifecycle::Stopping; // Update state
            }
            RecordingLifecycle::Idle => {
                println!("[RUST AUDIO STOP ERR] Stop called but Lifecycle is Idle.");
                return Err("Not currently recording (Lifecycle Idle)".to_string());
            }
             RecordingLifecycle::Stopping => {
                println!("[RUST AUDIO STOP WARN] Stop called but Lifecycle is already Stopping.");
                 return Err("Already stopping".to_string()); // Prevent duplicate stop processing
             }
        }
    } // Lifecycle lock released

    // --- Signal thread using BOTH channel and atomic flag ---
    println!("[RUST AUDIO STOP] Setting session active flag FALSE.");
    session_active_flag.store(false, Ordering::SeqCst); // Signal thread via atomic

    // Variables for handles and resources
    let mut _handle_opt: Option<JoinHandle<()>> = None; // Variable for handle
    let mut _temp_path_opt: Option<PathBuf> = None;
    let mut _writer_arc_opt: Option<Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>>> = None; // Type for writer

    { // Lock audio state briefly to get handles/path/writer
        let mut audio_state_guard = audio_state.lock().unwrap();
         println!("[RUST AUDIO STOP] Acquired audio state lock (Signal/Join Phase).");

        println!("[RUST AUDIO STOP] Sending stop signal via channel...");
        if let Some(sender) = audio_state_guard.stop_signal_sender.take() {
             let _ = sender.send(());
             println!("[RUST AUDIO STOP] Stop signal sent.");
        } else {
             println!("[RUST AUDIO STOP WARNING] Stop signal sender was None.");
        }

        _handle_opt = audio_state_guard.recording_thread_handle.take(); // Take handle
        _temp_path_opt = audio_state_guard.temp_wav_path.clone(); // Clone path
        _writer_arc_opt = audio_state_guard.writer.take(); // Take writer Arc

    } // Audio state lock released BEFORE joining thread


    // --- Join Thread ---
    if let Some(handle) = _handle_opt { // Use the handle taken earlier
        println!("[RUST AUDIO STOP] Joining recording thread...");
         match handle.join() {
             Ok(_) => println!("[RUST AUDIO STOP] Recording thread joined successfully."),
             Err(_) => println!("[RUST AUDIO STOP WARNING] Recording thread panicked! State might be inconsistent."),
         }
    } else {
          println!("[RUST AUDIO STOP WARNING] Recording thread handle was None before join.");
    }
     println!("[RUST AUDIO STOP] Recording thread stopped/joined.");
    // --- End Join Thread ---


    // --- Block 2: Reset Lifecycle to Idle (CRITICAL: Do this AFTER join) ---
    {
        let mut lifecycle_guard = RECORDING_LIFECYCLE.lock().unwrap();
         println!("[RUST AUDIO STOP] Resetting Lifecycle to Idle (State was: {:?})", *lifecycle_guard);
         // Only reset if it was Stopping, otherwise something else might have happened
         if *lifecycle_guard == RecordingLifecycle::Stopping {
             *lifecycle_guard = RecordingLifecycle::Idle;
         } else {
              println!("[RUST AUDIO STOP WARN] Lifecycle was not Stopping ({:?}) during reset attempt!", *lifecycle_guard);
         }
    } // Lifecycle lock released
    // --- End Lifecycle Reset ---


    // --- Block 3: Finalize Writer (Outside locks) ---
     let final_path_str_result: Result<String, String> = _temp_path_opt
          .ok_or_else(|| "Temp WAV path was None during cleanup".to_string())
          .map(|p| p.to_string_lossy().into_owned());

     if let Some(writer_arc) = _writer_arc_opt {
        println!("[RUST AUDIO STOP] Attempting finalize WAV writer...");
        match writer_arc.lock() {
           Ok(mut writer_opt_guard) => {
               if let Some(writer) = writer_opt_guard.take() {
                   println!("[RUST AUDIO STOP] Finalizing writer (Len: {} samples)...", writer.len());
                   if let Err(e) = writer.finalize() {
                       println!("[RUST AUDIO WARNING] Failed to finalize WAV writer: {}. Continuing...", e);
                   } else {
                       println!("[RUST AUDIO STOP] WAV writer finalized successfully.");
                   }
               } else { println!("[RUST AUDIO WARNING] Writer was already taken/finalized (outside lock)."); }
           },
           Err(e) => println!("[RUST AUDIO WARNING] Failed to lock writer mutex for finalize: {}", e)
       }
     } else { println!("[RUST AUDIO WARNING] Writer Arc missing during stop."); }
     // --- End Finalize ---


    // --- Proceed with Transcription (if path is valid) ---
    match final_path_str_result {
        Ok(temp_wav_path_str) => {
            info!(
                "[RUST AUDIO STOP] Path is valid. Proceeding to transcribe: {}",
                temp_wav_path_str
            );
            // Correctly get the transcription state
            // let ts_state = transcription_state.inner().clone(); // REMOVE THIS LINE

            // Call transcribe_audio_file with the State wrapper directly
            let transcription_result = transcription::transcribe_audio_file(
                app_handle.clone(),
                transcription_state, // Pass the State wrapper directly
                temp_wav_path_str,
                args.auto_paste,   // From the new struct
                args.user_id,      // New argument
                args.access_token, // New argument
            )
            .await;

            let transcription_result_to_return: Result<String, String>;

            match transcription_result {
                Ok(transcribed_text) => {
                    info!("[RUST AUDIO STOP] Transcription successful: {}", transcribed_text);

                    // Attempt to write to clipboard first
                    match write_to_clipboard_internal(transcribed_text.clone()) {
                        Ok(_) => {
                            info!("[RUST AUDIO STOP] Successfully wrote to clipboard.");
                            // Emit copied event *before* paste or final reset
                            log::info!("[RUST AUDIO] Emitting 'fethr-copied-to-clipboard' to frontend.");
                            if let Err(e) = app_handle.emit_all("fethr-copied-to-clipboard", ()) {
                                log::error!("[RUST AUDIO] Failed to emit 'fethr-copied-to-clipboard': {}", e);
                            }

                            if effective_auto_paste {
                                info!("[RUST AUDIO STOP] Auto-paste is enabled. Attempting paste.");
                                if let Err(e) = paste_text_to_cursor().await {
                                    error!("[RUST AUDIO STOP] Failed to paste text: {}. Transcription was: '{}'", e, transcribed_text);
                                    // Don't return error for paste failure, just log it.
                                    // Frontend will have the text on clipboard and can manage edit state.
                                }
                            } else {
                                info!("[RUST AUDIO STOP] Auto-paste is disabled. Clipboard write was successful.");
                            }
                        },
                        Err(e) => {
                            error!("[RUST AUDIO STOP] Failed to write to clipboard: {}. Transcription was: '{}'", e, transcribed_text);
                            // Even if clipboard write fails, we proceed to signal reset, but don't emit copied event.
                            // The frontend will get the transcription result directly from this command's Ok().
                        }
                    }
                    // Return the transcribed text regardless of clipboard/paste outcome
                    transcription_result_to_return = Ok(transcribed_text);
                },
                Err(e) => {
                    error!("[RUST AUDIO STOP] Transcription failed: {}", e);
                    transcription_result_to_return = Err(e.to_string());
                }
            }
            transcription_result_to_return
        },
        Err(e) => {
             eprintln!("[RUST AUDIO STOP ERROR] Failed to get audio path: {}. Cannot transcribe.", e);
             
             // Emit error event
             error!("[RUST Emit Error] Emitting fethr-error-occurred: {}", e);
             if let Err(emit_err) = app_handle.emit_all("fethr-error-occurred", e.clone()) {
                 error!("[RUST ERROR] Failed to emit fethr-error-occurred event: {}", emit_err);
             }
             
             // Ensure we signal a reset to get back to IDLE state on path error
             println!("[RUST AUDIO STOP] Path error. Triggering backend state reset...");
             let _ = crate::signal_reset_complete(app_handle.clone()); // Reset here too
             
             Err(e)
        }
    }
}