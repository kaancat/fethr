use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, Host, SampleFormat};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use log::{info, warn, error};

use crate::config::{AudioDeviceInfo, SETTINGS};

pub struct AudioDeviceManager {
    host: Host,
}

impl AudioDeviceManager {
    pub fn new() -> Self {
        Self {
            host: cpal::default_host(),
        }
    }

    /// Refresh and return all available input devices
    pub fn refresh_devices(&self) -> Result<Vec<AudioDeviceInfo>, String> {
        info!("[AudioDeviceManager] Refreshing audio devices...");
        
        let default_device = self.host.default_input_device();
        let default_device_name = default_device
            .as_ref()
            .and_then(|d| d.name().ok())
            .unwrap_or_else(|| "Unknown".to_string());

        let mut devices = Vec::new();
        
        match self.host.input_devices() {
            Ok(device_iter) => {
                for (index, device) in device_iter.enumerate() {
                    match self.device_to_info(&device, index, &default_device_name) {
                        Ok(device_info) => devices.push(device_info),
                        Err(e) => warn!("[AudioDeviceManager] Failed to get info for device: {}", e),
                    }
                }
            }
            Err(e) => {
                error!("[AudioDeviceManager] Failed to enumerate input devices: {}", e);
                return Err(format!("Failed to enumerate input devices: {}", e));
            }
        }

        info!("[AudioDeviceManager] Found {} input devices", devices.len());
        Ok(devices)
    }

    /// Convert cpal Device to AudioDeviceInfo
    fn device_to_info(&self, device: &Device, index: usize, default_name: &str) -> Result<AudioDeviceInfo, String> {
        let name = device.name().map_err(|e| format!("Failed to get device name: {}", e))?;
        let is_default = name == default_name;
        
        // Generate a unique ID based on device name and index
        let id = format!("device_{}_{}", index, name.replace(" ", "_").replace("(", "").replace(")", ""));
        
        // Get supported configurations to determine sample rate and channels
        let (sample_rate, channels) = match device.default_input_config() {
            Ok(config) => (config.sample_rate().0, config.channels()),
            Err(_) => {
                // Fallback to common values if we can't get device config
                warn!("[AudioDeviceManager] Could not get default config for {}, using fallback", name);
                (48000, 2) // Common fallback
            }
        };

        Ok(AudioDeviceInfo {
            id,
            name,
            is_default,
            sample_rate,
            channels,
        })
    }

    /// Get device by ID from currently available devices
    pub fn get_device_by_id(&self, device_id: &str) -> Option<Device> {
        info!("[AudioDeviceManager] Looking for device with ID: {}", device_id);
        
        match self.host.input_devices() {
            Ok(device_iter) => {
                for (index, device) in device_iter.enumerate() {
                    if let Ok(name) = device.name() {
                        let id = format!("device_{}_{}", index, name.replace(" ", "_").replace("(", "").replace(")", ""));
                        if id == device_id {
                            info!("[AudioDeviceManager] Found device: {}", name);
                            return Some(device);
                        }
                    }
                }
            }
            Err(e) => error!("[AudioDeviceManager] Failed to enumerate devices: {}", e),
        }
        
        warn!("[AudioDeviceManager] Device with ID {} not found", device_id);
        None
    }

    /// Get the currently selected device from settings, or default device
    pub fn get_selected_device(&self) -> Option<Device> {
        let selected_id = {
            let settings = SETTINGS.lock().unwrap();
            settings.audio.selected_input_device.clone()
        };

        if let Some(device_id) = selected_id {
            if let Some(device) = self.get_device_by_id(&device_id) {
                return Some(device);
            } else {
                warn!("[AudioDeviceManager] Selected device {} not available, falling back to default", device_id);
            }
        }

        // Fallback to default device
        self.host.default_input_device()
    }

    /// Test microphone levels for a specific device
    pub fn test_device_levels(&self, device_id: &str, duration_ms: u64) -> Result<f32, String> {
        info!("[AudioDeviceManager] Testing levels for device: {} ({}ms)", device_id, duration_ms);

        let device = self.get_device_by_id(device_id)
            .ok_or_else(|| format!("Device {} not found", device_id))?;

        let config = device.default_input_config()
            .map_err(|e| format!("Failed to get device config: {}", e))?;

        let sample_format = config.sample_format();
        let stream_config = config.into();

        // Shared state for level calculation
        let max_level = Arc::new(Mutex::new(0.0f32));
        let is_running = Arc::new(AtomicBool::new(true));

        let max_level_clone = max_level.clone();
        let is_running_clone = is_running.clone();

        // Build the input stream based on sample format
        let stream = match sample_format {
            SampleFormat::F32 => {
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if is_running_clone.load(Ordering::Relaxed) {
                            let level = data.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
                            let mut max_level_guard = max_level_clone.lock().unwrap();
                            if level > *max_level_guard {
                                *max_level_guard = level;
                            }
                        }
                    },
                    |err| error!("[AudioDeviceManager] Stream error: {}", err)
                )
            }
            SampleFormat::I16 => {
                device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if is_running_clone.load(Ordering::Relaxed) {
                            let level = data.iter()
                                .map(|&s| (s as f32 / i16::MAX as f32).abs())
                                .fold(0.0f32, f32::max);
                            let mut max_level_guard = max_level_clone.lock().unwrap();
                            if level > *max_level_guard {
                                *max_level_guard = level;
                            }
                        }
                    },
                    |err| error!("[AudioDeviceManager] Stream error: {}", err)
                )
            }
            _ => return Err("Unsupported sample format".to_string()),
        }.map_err(|e| format!("Failed to build input stream: {}", e))?;

        // Start the stream
        use cpal::traits::StreamTrait;
        stream.play().map_err(|e| format!("Failed to start stream: {}", e))?;

        // Record for the specified duration
        thread::sleep(Duration::from_millis(duration_ms));

        // Stop recording
        is_running.store(false, Ordering::Relaxed);
        drop(stream);

        // Get the maximum level recorded
        let final_level = {
            let max_level_guard = max_level.lock().unwrap();
            *max_level_guard
        };

        info!("[AudioDeviceManager] Test completed. Max level: {:.3}", final_level);
        Ok(final_level)
    }

    /// Get default device info
    #[allow(dead_code)]
    pub fn get_default_device(&self) -> Option<AudioDeviceInfo> {
        if let Some(default_device) = self.host.default_input_device() {
            if let Ok(name) = default_device.name() {
                return self.device_to_info(&default_device, 0, &name).ok();
            }
        }
        None
    }
}

// Global audio device manager instance
lazy_static::lazy_static! {
    pub static ref AUDIO_DEVICE_MANAGER: AudioDeviceManager = AudioDeviceManager::new();
}