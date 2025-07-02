-- Update calculate_daily_streak to be timezone-aware
CREATE OR REPLACE FUNCTION calculate_daily_streak(p_user_id UUID, p_user_timezone TEXT DEFAULT 'UTC')
RETURNS INT AS $$
DECLARE
    v_current_date DATE;
    v_streak INT := 0;
    v_check_date DATE;
BEGIN
    -- Get the most recent activity date in user's timezone
    SELECT MAX(DATE(transcribed_at AT TIME ZONE p_user_timezone))
    INTO v_current_date
    FROM transcription_timestamps
    WHERE user_id = p_user_id;
    
    -- If no activity, return 0
    IF v_current_date IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Check if the streak is still active (activity today or yesterday in user's timezone)
    IF v_current_date < (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE - INTERVAL '1 day' THEN
        RETURN 0;
    END IF;
    
    -- Count consecutive days backwards from the most recent activity
    v_check_date := v_current_date;
    WHILE EXISTS (
        SELECT 1 
        FROM transcription_timestamps 
        WHERE user_id = p_user_id 
        AND DATE(transcribed_at AT TIME ZONE p_user_timezone) = v_check_date
    ) LOOP
        v_streak := v_streak + 1;
        v_check_date := v_check_date - INTERVAL '1 day';
    END LOOP;
    
    RETURN v_streak;
END;
$$ LANGUAGE plpgsql;

-- Update get_dashboard_stats_enhanced to accept timezone
CREATE OR REPLACE FUNCTION get_dashboard_stats_enhanced(p_user_id UUID, p_user_timezone TEXT DEFAULT 'UTC')
RETURNS TABLE (
    total_words BIGINT,
    total_transcriptions BIGINT,
    daily_streak INT,
    today_words BIGINT,
    average_words_per_session BIGINT,
    most_active_hour INT
) AS $$
BEGIN
    RETURN QUERY
    WITH user_stats AS (
        SELECT 
            COALESCE(SUM(word_count), 0) as total_words,
            COUNT(*) as total_transcriptions,
            COALESCE(SUM(CASE 
                WHEN DATE(transcribed_at AT TIME ZONE p_user_timezone) = (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE 
                THEN word_count 
                ELSE 0 
            END), 0) as today_words
        FROM transcription_timestamps
        WHERE user_id = p_user_id
    ),
    hourly_stats AS (
        SELECT 
            EXTRACT(HOUR FROM transcribed_at AT TIME ZONE p_user_timezone)::INT as hour,
            COUNT(*) as count
        FROM transcription_timestamps
        WHERE user_id = p_user_id
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 1
    )
    SELECT 
        us.total_words,
        us.total_transcriptions,
        calculate_daily_streak(p_user_id, p_user_timezone),
        us.today_words,
        CASE 
            WHEN us.total_transcriptions > 0 
            THEN us.total_words / us.total_transcriptions 
            ELSE 0 
        END as average_words_per_session,
        COALESCE(hs.hour, 0) as most_active_hour
    FROM user_stats us
    LEFT JOIN hourly_stats hs ON true;
END;
$$ LANGUAGE plpgsql;

-- Update increment_transcription_stats to record activity in user's timezone
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
    INSERT INTO user_daily_activity (user_id, activity_date, transcription_count, word_count)
    VALUES (p_user_id, v_activity_date, 1, p_word_count)
    ON CONFLICT (user_id, activity_date) 
    DO UPDATE SET 
        transcription_count = user_daily_activity.transcription_count + 1,
        word_count = user_daily_activity.word_count + p_word_count,
        last_activity_at = CURRENT_TIMESTAMP;
    
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