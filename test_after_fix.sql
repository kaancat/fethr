-- Test if the fix worked

-- 1. First, check if permissions are now correct
SELECT has_table_privilege('public.transcription_timestamps', 'INSERT');

-- 2. Test the function manually (replace with your actual user_id)
-- You can get your user_id from the auth.users table or your app
SELECT increment_transcription_stats('YOUR_USER_ID_HERE'::uuid, 25);

-- 3. Check if the row was inserted
SELECT * FROM public.transcription_timestamps 
ORDER BY created_at DESC 
LIMIT 5;

-- 4. Check if the stats were updated in subscriptions
SELECT user_id, word_usage_this_period 
FROM public.subscriptions 
WHERE user_id = 'YOUR_USER_ID_HERE'::uuid;

-- 5. Test the enhanced stats function
SELECT get_dashboard_stats_enhanced('YOUR_USER_ID_HERE'::uuid);

-- 6. If you want to see all transcription timestamps for debugging
SELECT 
    user_id,
    word_count,
    transcribed_at,
    EXTRACT(HOUR FROM transcribed_at AT TIME ZONE 'UTC') as hour
FROM public.transcription_timestamps
ORDER BY transcribed_at DESC;