-- Fix increment_transcription_stats to handle user_statistics table constraints correctly
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
    v_stats_record RECORD;
BEGIN
    -- Calculate activity date in user's timezone
    v_activity_date := (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE;
    
    -- Record the transcription in transcription_timestamps
    INSERT INTO transcription_timestamps (user_id, word_count, transcribed_at, duration_seconds, session_id)
    VALUES (p_user_id, p_word_count, CURRENT_TIMESTAMP, p_duration_seconds, p_session_id);
    
    -- Update or create daily activity record (using user's local date)
    INSERT INTO user_daily_activity (user_id, activity_date, total_transcriptions, total_words)
    VALUES (p_user_id, v_activity_date, 1, p_word_count)
    ON CONFLICT (user_id, activity_date) 
    DO UPDATE SET 
        total_transcriptions = user_daily_activity.total_transcriptions + 1,
        total_words = user_daily_activity.total_words + p_word_count,
        updated_at = CURRENT_TIMESTAMP;
    
    -- Handle user_statistics update differently to avoid constraint issues
    -- First, check if a record exists for this user
    SELECT * INTO v_stats_record
    FROM user_statistics
    WHERE user_id = p_user_id
    LIMIT 1;
    
    IF v_stats_record.id IS NULL THEN
        -- No record exists, create one
        INSERT INTO user_statistics (
            user_id,
            total_words_transcribed,
            total_transcriptions,
            lifetime_words_transcribed,
            lifetime_transcriptions,
            daily_streak,
            longest_streak,
            week_start_date,
            weekly_words_transcribed,
            weekly_transcriptions,
            last_transcription_date
        )
        VALUES (
            p_user_id,
            p_word_count,
            1,
            p_word_count,
            1,
            1,
            1,
            DATE_TRUNC('week', v_activity_date)::DATE,
            p_word_count,
            1,
            v_activity_date
        );
    ELSE
        -- Record exists, update it
        UPDATE user_statistics
        SET 
            total_words_transcribed = COALESCE(total_words_transcribed, 0) + p_word_count,
            total_transcriptions = COALESCE(total_transcriptions, 0) + 1,
            lifetime_words_transcribed = COALESCE(lifetime_words_transcribed, 0) + p_word_count,
            lifetime_transcriptions = COALESCE(lifetime_transcriptions, 0) + 1,
            daily_streak = calculate_daily_streak(p_user_id, p_user_timezone),
            longest_streak = GREATEST(COALESCE(longest_streak, 0), calculate_daily_streak(p_user_id, p_user_timezone)),
            last_transcription_date = v_activity_date,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = p_user_id;
    END IF;
    
    -- Update subscription word usage if active
    UPDATE subscriptions
    SET word_usage_this_period = COALESCE(word_usage_this_period, 0) + p_word_count
    WHERE user_id = p_user_id
    AND status IN ('active', 'trialing');
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error but don't fail the whole operation
        RAISE LOG 'Error in increment_transcription_stats: %', SQLERRM;
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;