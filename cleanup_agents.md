# Fethr Cleanup Agents - Deep Analysis

## Agent 1: Dead Code Detective
**Domain**: Unused functions, structs, and fields
**Status**: ACTIVE

### Findings from Compiler Warnings:

#### main.rs
- `SubscriptionData.word_usage_this_period` - Field never read
- `UserStatsData.daily_streak` - Field never read

#### dictionary_corrector.rs
- `DictionaryCorrector::stats()` - Method never used
- `DictionaryStats` struct - Never constructed

#### word_usage_tracker.rs
- `UsageTracker::save_to_file()` - Function never used

#### audio_devices.rs
- `AudioDeviceManager::get_default_device()` - Method never used

#### auth_manager.rs (Heavy dead code)
- `SessionCache` struct - Fields never read (user_id, access_token, expires_at)
- `SESSION_CACHE_DURATION` constant - Never used
- `TOKEN_EXPIRY_BUFFER` constant - Never used
- `validate_token()` - Function never used
- `with_auth_retry()` - Function never used
- `is_auth_error()` - Function never used
- `cache_session()` - Function never used
- `get_error_message()` - Function never used

#### stats_queue.rs (Entire module seems unused)
- `MAX_RETRY_COUNT` - Constant never used
- `dequeue_stats_update()` - Function never used
- `requeue_failed_update()` - Function never used
- `get_queue_size()` - Function never used
- `process_queued_updates()` - Function never used
- `clear_queue()` - Function never used

#### smart_formatter.rs
- `SmartFormatter.preserve_meaning` - Field never read
- `SmartFormatter::with_settings()` - Method never used
- `find_quoted_regions()` - Method never used
- `is_in_quotes()` - Method never used

### Recommendations:
1. Remove entire `stats_queue.rs` module if not planned for use
2. Clean up auth_manager.rs - remove session caching code
3. Remove unused struct fields or add `#[allow(dead_code)]` if planned for future

## Agent 2: Supabase Structure Analyzer
**Domain**: Supabase folders and database files
**Status**: PENDING

### Search Targets:
- `/supabase` directory
- Migration files
- Seed files
- Config files
- SQL scripts

## Agent 3: Build Artifact Hunter
**Domain**: Build outputs and temporary files
**Status**: ACTIVE

### Known Issues:
- `src-tauri/target/` - 8.1GB of build artifacts
- Need to check for:
  - `.next/` cache
  - `dist/` folders
  - Temporary test outputs
  - Coverage reports

## Agent 4: Dependency Auditor
**Domain**: Unused dependencies in Cargo.toml and package.json
**Status**: PENDING

### Analysis Needed:
- Check if all Rust crates are actually used
- Verify npm packages are imported
- Look for duplicate functionality

## Agent 5: Test File Investigator
**Domain**: Old test files and test data
**Status**: PENDING

### Search Patterns:
- `*test*.rs` files
- `*spec*.ts` files
- Test fixtures
- Mock data files

## Agent 6: Configuration Consolidator
**Domain**: Duplicate or outdated config files
**Status**: PENDING

### Check for:
- Multiple env files
- Old config backups
- Deprecated settings
- Unused feature flags