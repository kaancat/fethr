# Cleanup Manifest - January 2025

## Phase 2: Dead Code Cleanup

### Code Modifications
- Added `#[allow(dead_code)]` attributes to preserve potentially useful but currently unused code:
  - `main.rs`: SubscriptionData and UserStatsData structs
  - `auth_manager.rs`: Module-level allow for session caching code
  - `stats_queue.rs`: Module-level allow for retry queue functionality
  - `dictionary_corrector.rs`: stats() method and DictionaryStats struct
  - `word_usage_tracker.rs`: save_to_file() method
  - `audio_devices.rs`: get_default_device() method

### Analysis Results
- **Supabase Structure**: Found 12 migration files and 2 edge functions (create-checkout, stripe-webhook)
- **Build Artifacts**: 8.1GB in `src-tauri/target/` (use `cargo clean` to remove)
- **Stats Queue**: Module is actively used for failed stats retry, kept with allow attributes

---

# Cleanup Manifest - Phase 1

## Files Deleted

### Python Artifacts
- `src-tauri/resources/simple_whisper_solution.py` - Unused Python Whisper implementation

### Build Artifacts  
- `build_output.log` - Old build log from June
- `tauri_build.log` - Old Tauri build log from June

### Documentation Cleanup
- `Logs from test-sessions.md` - Large test session logs (121KB)
- `debug_auth_flow.md` - Old debugging documentation
- `test_stats.md` - Old test statistics
- `filler_removal_edge_cases_fix.md` - Intermediate filler work documentation
- `filler_removal_fix_summary.md` - Redundant filler summary

### Assets Cleanup
- `public/feather-logo.png` - Duplicate logo file
- `public/Icons/edit icon.png` - Poorly named icon with space
- `src-tauri/vendor/models/desktop.ini` - Windows system file

## Files Preserved

### Recent Work
- `FINAL_FILLER_REMOVAL_STATUS.md` - Final status of filler removal feature
- `filler_removal_analysis.md` - Important analysis documentation
- `filler_removal_final_fixes.md` - Final fixes documentation
- `FILLER_TEST_EXAMPLES.md` - Test examples for filler removal

### Core Files
- All source code in `/src` and `/src-tauri/src`
- All configuration files (package.json, Cargo.toml, etc.)
- CLAUDE.md project instructions
- README files

## Space Saved
- Approximately 8.1GB in `src-tauri/target` (build artifacts - not deleted, requires `cargo clean`)
- ~130KB in documentation and log files

## Recommendations
1. Run `cd src-tauri && cargo clean` to clear 8.1GB of build artifacts when needed
2. Consider adding more items to .gitignore to prevent future accumulation
3. Set up automated cleanup in CI/CD pipeline