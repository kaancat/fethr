#![allow(unused_imports)] // Temp allow while debugging
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;
use tauri::{command, AppHandle, Manager, State};
use uuid::Uuid;
use crate::SharedRecordingState; // Import SharedRecordingState from main/lib
use crate::transcription::{self, TranscriptionState}; // Import transcription state
use cpal::{SupportedStreamConfig, SampleFormat, SampleRate};
use std::fs::File;
use std::io::BufWriter;
use scopeguard::defer;

// --- ADD THESE IMPORTS ---
use crate::{write_to_clipboard_internal, paste_text_to_cursor}; // Import from main.rs
// --- END IMPORTS ---

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

    let unique_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir();
    let temp_wav_path = temp_dir.join(format!("fethr_rec_{}.wav", unique_id));
    println!("[RUST AUDIO] Recording path: {}", temp_wav_path.display());

    let (tx_stop, rx_stop) = mpsc::channel();

    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| "No input device available".to_string())?;
    println!("[RUST AUDIO DEBUG] Default input device: {:?}", device.name().unwrap_or_else(|_| "Unnamed".to_string()));

    println!("[RUST AUDIO DEBUG] Finding best supported input config...");
    let preferred_format_order = [SampleFormat::I16, SampleFormat::F32];
    let mut best_config: Option<cpal::SupportedStreamConfig> = None;
    // ... (Keep the robust config finding logic from previous step) ...
     'format_loop: for &format in preferred_format_order.iter() {
         // ... existing logic ...
          if let Ok(mut configs_iter) = device.supported_input_configs() {
              if let Some(range) = configs_iter.find(|range| range.sample_format() == format && range.channels() == 1) {
                  // ... found mono ... select rate ... set best_config ... break ...
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
                     // ... found any channel ... select rate ... set best_config ... break ...
                      println!("[RUST AUDIO DEBUG]   -> Found {:?} range ({} channels). Selecting max rate: {}", format, range.channels(), range.max_sample_rate().0);
                      best_config = Some(range.with_max_sample_rate());
                      break 'format_loop;
                  }
             }
         }
          println!("[RUST AUDIO DEBUG] No {:?} configs found.", format);
     } // End format loop
     let supported_config = best_config.ok_or_else(|| "No supported I16 or F32 input config found".to_string())?;
     let actual_sample_rate = supported_config.sample_rate().0;
     let stream_config: cpal::StreamConfig = supported_config.config();
     let actual_format = supported_config.sample_format();
     println!("[RUST AUDIO] Selected config: Rate: {}, Channels: {}, Format: {:?}", actual_sample_rate, stream_config.channels, actual_format);
     // ... End Config Finding Logic ...


    let spec = hound::WavSpec { channels: 1, sample_rate: actual_sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let writer = hound::WavWriter::create(&temp_wav_path, spec).map_err(|e| format!("Failed to create WavWriter: {}", e))?;
    // --- Wrap the Writer in Some() before putting in Arc/Mutex ---
    let writer_mutex: Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>> = Arc::new(Mutex::new(Some(writer)));

    let writer_clone = Arc::clone(&writer_mutex);
    let _app_handle_for_error_cb = app_handle.clone();
    let _app_handle_for_build_err = app_handle.clone();
    let _app_handle_for_play_err = app_handle.clone();

    let recording_handle = thread::spawn(move || {
        println!("[RUST THREAD] Recording thread started.");
        let error_callback = move |_err| { /* ... */ };

        println!("[RUST THREAD DEBUG] Building stream for format: {:?}", actual_format);
        let stream_result = match actual_format {
            SampleFormat::I16 => { /* ... build stream for i16 ... */
                let data_callback = move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut writer_opt_guard) = writer_clone.lock() {
                        if let Some(writer_guard) = writer_opt_guard.as_mut() {
                             for &sample in data.iter() { if writer_guard.write_sample(sample).is_err() { /* ... */ break; } }
                        }
                    }
                };
                 device.build_input_stream::<i16, _, _>(&stream_config, data_callback, error_callback)
            }
            SampleFormat::F32 => { /* ... build stream for f32 ... */
                 let data_callback = move |data: &[f32], _: &cpal::InputCallbackInfo| {
                     if let Ok(mut writer_opt_guard) = writer_clone.lock() {
                         if let Some(writer_guard) = writer_opt_guard.as_mut() {
                            for &sample_f32 in data.iter() {
                                let clamped_f32 = sample_f32.max(-1.0).min(1.0);
                                let sample_i16 = (clamped_f32 * std::i16::MAX as f32) as i16;
                                if writer_guard.write_sample(sample_i16).is_err() { /* ... */ break; }
                            }
                         }
                     }
                 };
                  device.build_input_stream::<f32, _, _>(&stream_config, data_callback, error_callback)
            }
            _ => Err(cpal::BuildStreamError::StreamConfigNotSupported)
        };

        let stream = match stream_result { Ok(s) => s, Err(_e) => { /* ... error handling ... */ return; } };
        println!("[RUST THREAD DEBUG] Input stream built successfully.");

        if let Err(_e) = stream.play() { /* ... error handling ... */ return; }
        println!("[RUST THREAD] Stream playing.");

        let _ = rx_stop.recv(); // Block until stop signal
         println!("[RUST THREAD] Stop signal received.");
         drop(stream);
         println!("[RUST THREAD] Stream dropped.");
         println!("[RUST THREAD] Recording thread finished.");
    }); // End thread spawn

    // --- Update Tauri State ---
    state_guard.stop_signal_sender = Some(tx_stop);
    state_guard.temp_wav_path = Some(temp_wav_path); // No clone needed
    state_guard.recording_thread_handle = Some(recording_handle);
    state_guard.writer = Some(writer_mutex); // Store Arc<Mutex<Option<Writer>>>
    state_guard.is_actively_recording = true;

    println!("[RUST AUDIO] Backend recording started successfully.");
    let _ = app_handle.emit_all("recording_status_changed", "started");
    Ok(())
}


#[command]
pub async fn stop_backend_recording(
    app_handle: AppHandle,
    recording_state: State<'_, SharedRecordingState>,
    transcription_state: State<'_, TranscriptionState>, // Use TranscriptionState from transcription mod
    auto_paste: bool,
) -> Result<String, String> {
    println!("[RUST AUDIO STOP] Received stop command. AutoPaste: {}", auto_paste);

    // --- Setup Scopeguard for State Reset ---
    defer! {
        match recording_state.lock() {
            Ok(_state_guard) => {
                println!("[RUST AUDIO SCOPEGUARD] FINAL state reset check. Signaling frontend to reset state.");
            }
            Err(e) => {
                 println!("[RUST AUDIO SCOPEGUARD CRITICAL ERROR] Failed to lock state for FINAL reset: {}. State might be inconsistent.", e);
            }
        }
    }
    // --- End Scopeguard Setup ---

    // Use block to extract path string
    let final_path_string = {
        let mut state_guard = recording_state.lock().map_err(|e| format!("Failed to lock state for stopping: {}", e))?;
        println!("[RUST AUDIO STOP] Acquired state lock.");
        
        if !state_guard.is_actively_recording { return Err("Not currently recording".to_string()); }

        if let Some(sender) = state_guard.stop_signal_sender.take() { 
            let _ = sender.send(()); 
            println!("[RUST AUDIO STOP] Stop signal sent.");
        } else { 
            println!("[RUST AUDIO STOP WARNING] Stop signal sender was already None."); 
        }
        
        if let Some(handle) = state_guard.recording_thread_handle.take() { 
            match handle.join() {
                Ok(_) => println!("[RUST AUDIO STOP] Recording thread joined successfully."),
                Err(_) => println!("[RUST AUDIO STOP WARNING] Recording thread panicked!"),
            }
        } else { 
            println!("[RUST AUDIO STOP WARNING] Recording thread handle was already None.");
        }
        
        let writer_option_arc = state_guard.writer.take(); // Option<Arc<Mutex<Option<WavWriter<...>>>>>
        let final_path = state_guard.temp_wav_path.clone(); // Clone before releasing lock

        // Set is_actively_recording to false here, after thread stop but before transcription
        println!("[RUST AUDIO STOP] Setting is_actively_recording to false.");
        state_guard.is_actively_recording = false;

        drop(state_guard); // Release lock

        // Finalize writer outside lock
        if let Some(writer_arc) = writer_option_arc {
            println!("[RUST AUDIO STOP] Attempting finalize WAV writer...");
             match writer_arc.lock() { // Lock the Mutex<Option<WavWriter>>
                 Ok(mut writer_opt_guard) => {
                     if let Some(writer) = writer_opt_guard.take() { // Take ownership from Option
                         println!("[RUST AUDIO STOP] Writer state before finalize: Duration={}ms, Len={}", writer.duration(), writer.len());
                         if let Err(e) = writer.finalize() { println!("[RUST AUDIO WARNING] Failed to finalize WAV writer: {}.", e); }
                         else { println!("[RUST AUDIO STOP] WAV writer finalized successfully."); }
                     } else { println!("[RUST AUDIO WARNING] Writer was already taken/finalized."); }
                 },
                 Err(e) => println!("[RUST AUDIO WARNING] Failed to lock writer mutex for finalize: {}", e)
             }
        } else { println!("[RUST AUDIO WARNING] Writer Arc missing from state during stop."); }

        // Return path string
        final_path.ok_or("Temp WAV path was None after lock release".to_string())?
             .to_string_lossy().into_owned()
    };


    // --- Call Transcription ---
    println!("[RUST AUDIO] Invoking transcription for: {}", final_path_string);
    let transcription_result = transcription::transcribe_audio_file( // Call the command version
        app_handle.clone(),
        transcription_state,
        final_path_string.clone(), // Pass path
        auto_paste // Pass flag
    ).await;


    // --- Handle Copy/Paste based on transcription_result ---
    let final_return_result = match transcription_result {
        Ok(text) => {
            println!("[RUST AUDIO] Transcription successful. Proceeding with Copy/Paste...");
            match write_to_clipboard_internal(text.clone()) { // Removed .await here
                Ok(_) => {
                    println!("[RUST AUDIO] Copied to clipboard successfully.");
                    if auto_paste {
                        println!("[RUST AUDIO] Auto-paste enabled, attempting paste...");
                        match paste_text_to_cursor(text.clone()).await { // await the async command
                            Ok(_) => println!("[RUST AUDIO] Paste command executed OK."),
                            Err(e) => println!("[RUST AUDIO WARNING] Paste command failed: {}", e),
                        }
                    } else { println!("[RUST AUDIO] Auto-paste disabled."); }
                }
                Err(e) => { println!("[RUST AUDIO WARNING] Failed to copy to clipboard: {}. Skipping paste.", e); }
            }
            Ok(text) // Return original transcription text
        }
        Err(e) => {
             println!("[RUST AUDIO] Transcription failed: {}", e);
             Err(e) // Propagate the error
        }
    };

    let _ = app_handle.emit_all("recording_status_changed", "stopped");

    final_return_result
}