# Release v0.18.6

**Date:** 2026-03-09
**Previous version:** 0.18.5

## Changes

### Features
- Voice transcription and dictation with on-device Whisper (Metal GPU acceleration on macOS)
- Live dictation via microphone with Web Speech API fallback to whisper-rs
- Meeting recording with full transcription and timestamped segments
- 5 Whisper model sizes with download management in Settings
- Language selection from 99 supported languages

### Fixes
- Fix CI build failures for whisper-rs on all platforms (Metal feature macOS-only, ALSA/clang deps for Linux)
- Set macOS deployment target to 14.0 (Sonoma) to resolve whisper.cpp compilation errors

## Files Changed
- 30+ files changed across 4 commits
