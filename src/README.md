# Fethr

A modern desktop application for audio recording with hotkey support, built with Tauri.

## Features

- Hold-to-record functionality with Ctrl+Shift+A hotkey
- Double-tap-to-lock recording mode
- Audio visualization and monitoring
- Custom event-driven architecture

## Development

### Prerequisites

- Node.js
- Rust (for Tauri backend)
- Windows 10 or later recommended

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Build

```bash
# Create production build
npm run build
```

## Architecture

Fethr uses a hybrid architecture combining:

- Tauri for native capabilities and cross-platform support
- React for UI components
- Custom event-driven system for application state management

### Core Components

- **HotkeyManager**: Handles keyboard input and manages recording state transitions
- **AudioManager**: Singleton service for microphone access and audio recording
- **Visualization**: Real-time audio waveform display

## Debugging

The application includes extensive debugging features:

- Detailed logging in both components
- Methods to force trigger recording callbacks
- Timestamp tracking for audio events

## Contributing

See the dev_log.md file for recent changes and development notes. 