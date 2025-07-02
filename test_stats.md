# Testing Dashboard Stats from Supabase

## Steps to Test:

1. **Start your app locally** (in a terminal where Rust is installed):
   ```bash
   npm run tauri dev
   ```

2. **Make a test transcription**:
   - Use the app to record and transcribe something
   - This should trigger the `increment_transcription_stats` function in Supabase

3. **Check the database** (in Supabase SQL Editor):
   ```sql
   -- Check if timestamp was recorded
   SELECT * FROM transcription_timestamps 
   WHERE user_id = 'your-user-id' 
   ORDER BY transcribed_at DESC 
   LIMIT 5;

   -- Check if stats were updated
   SELECT * FROM subscriptions 
   WHERE user_id = 'your-user-id';

   -- Test the enhanced stats function directly
   SELECT get_dashboard_stats_enhanced('your-user-id'::uuid);
   ```

4. **Check the app dashboard**:
   - Go to the home page in your app
   - The stats should now be fetched from Supabase
   - You should see:
     - Total words from `subscriptions.word_usage_this_period`
     - Daily streak from `user_statistics`
     - Most active hour calculated from `transcription_timestamps`

## What the migration added:

1. **transcription_timestamps table**: Tracks when each transcription happens for hour analysis
2. **Updated increment_transcription_stats**: Now also inserts timestamp records
3. **get_dashboard_stats_enhanced function**: Calculates all stats in the database including:
   - Total words (from subscriptions table)
   - Total transcriptions (sum from user_statistics)
   - Daily streak (from user_statistics)
   - Today's words (from user_statistics where date = today)
   - Average words per session (calculated)
   - Most active hour (from transcription_timestamps)

## Debugging:

If stats aren't updating:
1. Check browser console for errors
2. Check Supabase logs for function execution
3. Verify your user_id is correct
4. Check that the migration ran successfully by looking for the new table and functions