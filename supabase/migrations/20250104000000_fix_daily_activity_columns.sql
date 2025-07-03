-- Fix increment_transcription_stats to use correct column names for user_daily_activity
CREATE OR REPLACE FUNCTION increment_transcription_stats(
    p_user_id UUID,
    p_word_count INT,
    p_duration_seconds INT DEFAULT 0,
    p_session_id UUID DEFAULT NULL,
    p_user_timezone TEXT DEFAULT 'UTC'
)
RETURNS VOID AS $$
DECLARE
    v_subscription_id UUID;
    v_activity_date DATE;
BEGIN
    -- Calculate activity date in user's timezone
    v_activity_date := (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE;
    
    -- Record the transcription
    INSERT INTO transcription_timestamps (user_id, word_count, transcribed_at, duration_seconds, session_id)
    VALUES (p_user_id, p_word_count, CURRENT_TIMESTAMP, p_duration_seconds, p_session_id);
    
    -- Update or create daily activity record (using user's local date)
    INSERT INTO user_daily_activity (user_id, activity_date, total_transcriptions, total_words)
    VALUES (p_user_id, v_activity_date, 1, p_word_count)
    ON CONFLICT (user_id, activity_date) 
    DO UPDATE SET 
        total_transcriptions = user_daily_activity.total_transcriptions + 1,
        total_words = user_daily_activity.total_words + p_word_count;
    
    -- Update lifetime statistics
    INSERT INTO user_statistics (
        user_id, 
        total_words_transcribed, 
        total_transcriptions,
        lifetime_words_transcribed,
        lifetime_transcriptions,
        daily_streak,
        longest_streak
    )
    VALUES (
        p_user_id, 
        p_word_count, 
        1,
        p_word_count,
        1,
        1,
        1
    )
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        total_words_transcribed = user_statistics.total_words_transcribed + p_word_count,
        total_transcriptions = user_statistics.total_transcriptions + 1,
        lifetime_words_transcribed = user_statistics.lifetime_words_transcribed + p_word_count,
        lifetime_transcriptions = user_statistics.lifetime_transcriptions + 1,
        daily_streak = calculate_daily_streak(p_user_id, p_user_timezone),
        longest_streak = GREATEST(user_statistics.longest_streak, calculate_daily_streak(p_user_id, p_user_timezone));
    
    -- Check if user has active subscription
    SELECT id INTO v_subscription_id
    FROM subscriptions
    WHERE user_id = p_user_id
    AND status IN ('active', 'trialing')
    ORDER BY current_period_end DESC
    LIMIT 1;
    
    -- If active subscription found, update word usage
    IF v_subscription_id IS NOT NULL THEN
        UPDATE subscriptions
        SET word_usage_this_period = word_usage_this_period + p_word_count
        WHERE id = v_subscription_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Optional: Fix missing daily activity records based on existing transcription data
-- This will retroactively create daily activity records for any missing days
INSERT INTO user_daily_activity (user_id, activity_date, total_transcriptions, total_words)
SELECT 
    user_id,
    DATE(transcribed_at AT TIME ZONE 'Europe/Copenhagen') as activity_date,
    COUNT(*) as total_transcriptions,
    SUM(word_count) as total_words
FROM transcription_timestamps
WHERE user_id = 'a0c96de6-cee0-4770-84a0-9e87e89ab59f'  -- Your user ID
GROUP BY user_id, DATE(transcribed_at AT TIME ZONE 'Europe/Copenhagen')
ON CONFLICT (user_id, activity_date) DO NOTHING;