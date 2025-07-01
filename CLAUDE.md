# Fethr - Voice Transcription App

## Important Development Guidelines
- **ALWAYS commit changes after completing a set of tasks** - Use git to create commits when you finish implementing features or fixing bugs
- Create meaningful commit messages that describe what was changed and why
- Don't wait until everything is perfect - commit working increments

## Project Overview
Fethr is a lightweight cross-platform voice transcription app built with Tauri (Rust backend) and React (TypeScript frontend). The app provides real-time voice transcription using local Whisper.cpp models with a clean, minimal UI featuring a floating pill interface.

**Last Updated**: January 2025

## Current Architecture

### Backend (Rust/Tauri)
- **Audio Processing**: `audio_manager.rs` - Handles recording, format conversion, and audio pipeline
- **Transcription**: `transcription.rs` - Whisper.cpp integration with model management
- **Dictionary**: `dictionary_manager.rs` & `dictionary_corrector.rs` - Custom word dictionary with conservative correction
- **AI Actions**: `ai_actions_manager.rs` - Post-processing with OpenAI/Anthropic via Vercel proxy
- **Configuration**: `config.rs` - TOML-based settings management
- **Hotkeys**: Global hotkey system using `rdev` for AltGr (Right Alt) recording

### Frontend (React/TypeScript)
- **Main UI**: Floating pill interface with instant click response
- **Recording States**: Visual feedback with brand blue (#87CEFA) theme
- **Editor**: `EditorPage.tsx` - Text editing with AI enhancement options
- **Settings**: Comprehensive settings tabs including:
  - Audio device selection with microphone testing
  - Whisper model selection with card-based UI
  - Dictionary management
  - AI integration settings
- **History**: Transcription history with search and editing capabilities

### Key Features
- Local Whisper.cpp transcription (multiple model sizes)
- Custom dictionary support with conservative correction
- AI post-processing (summarize, email formatting, prompt optimization)
- Cross-platform (Windows, macOS, Linux)
- Minimal resource usage (~30-50MB RAM)
- **Audio device selection and real-time testing**
- **Global hotkey support (AltGr/Right Alt) with push-to-talk and toggle modes**
- **Instant UI responsiveness with zero-delay interactions**
- **User statistics tracking via Supabase**

## Recent Changes (January 2025)

### UI/UX Improvements
- **Instant click response**: Removed ALL delays from recording button
- **Visual state improvements**: Better recording state management and feedback
- **Brand color update**: Changed from purple to brand blue (#87CEFA)
- **Redesigned Whisper model selector**: New card-based UI

### Audio Features
- **Full audio device selection**: Choose specific microphones
- **Microphone testing**: Real-time audio level visualization
- **Audio settings**: Gain control, noise suppression, auto-gain control

### Dictionary Correction
- **Simplified approach**: Removed fuzzy matching to prevent false positives
- **Conservative corrections**: Only exact matches and known Whisper error patterns
- **Common word protection**: Prevents corrections like "can" → "Kaan"

### Backend Improvements
- **Better error handling**: Fixed duplicate stop requests
- **State synchronization**: Fixed recording state issues
- **Performance**: Optimized for instant responsiveness

## Development Commands
```bash
# Development mode
npm run tauri dev

# Build for production
npm run tauri build

# Frontend only
npm run dev

# Linting
npm run lint
npm run typecheck
```

## Current Focus Areas
- Maintaining instant UI responsiveness
- Improving transcription accuracy
- Enhancing user experience with visual feedback
- Ensuring cross-platform compatibility
## Supabase MCP Integration
- Supabase MCP is configured for direct database access
- Can query tables, check user statistics, and debug database issues
- Service role key is securely stored in local Claude configuration
