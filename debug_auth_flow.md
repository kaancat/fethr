# Debug Auth Flow Issue

## The Problem
The `increment_transcription_stats` function exists in Supabase and has correct permissions, but it's not being called when transcriptions happen.

## What We Found
1. The migration created the function and table correctly
2. Permissions were fixed (GRANT INSERT was needed)
3. The Rust code passes auth credentials from audio_manager to transcription
4. BUT: The log messages showing the Supabase calls aren't appearing

## Missing Log Messages
We should see these but don't:
```
[Transcription] User details found (User ID: 9b6baf2c-3d03-4879-9274-26f3ade4d26d), proceeding with word count update for X words.
[Transcription] About to call usage and stats updates...
```

## Hypothesis
The auth credentials (`user_id_opt` and `access_token_opt`) are likely `None` when they reach the transcription function, even though they're passed from audio_manager.

## Quick Fix to Test
Add debug logging to the transcription function to see what's happening:

```rust
// In transcription.rs, right before the auth check:
println!("[DEBUG] Auth check - user_id_opt: {:?}, access_token_opt present: {}", 
    user_id_opt, access_token_opt.is_some());

if let (Some(user_id), Some(access_token)) = (user_id_opt, access_token_opt) {
    println!("[DEBUG] Auth check PASSED - user_id: {}", user_id);
    // ... rest of the code
} else {
    println!("[DEBUG] Auth check FAILED - missing credentials");
}
```

## Questions for Supabase AI
1. "Can you help me debug why the increment_transcription_stats function isn't being called? The function exists and has INSERT permissions, but no rows are added to transcription_timestamps table."

2. "Is there a way to add logging to the increment_transcription_stats function to see if it's being called at all?"

3. "Can I check the Supabase logs to see if there are any RPC calls to increment_transcription_stats?"