-- Fix get_dashboard_stats_enhanced to use correct data sources
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
    WITH lifetime_stats AS (
        -- Get lifetime stats from user_statistics table
        SELECT 
            COALESCE(lifetime_words_transcribed, 0) as total_words,
            COALESCE(lifetime_transcriptions, 0) as total_transcriptions
        FROM user_statistics
        WHERE user_id = p_user_id
        LIMIT 1
    ),
    today_stats AS (
        -- Get today's stats from user_daily_activity
        SELECT 
            COALESCE(SUM(total_words), 0) as today_words
        FROM user_daily_activity
        WHERE user_id = p_user_id
        AND activity_date = (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE
    ),
    hourly_stats AS (
        -- Get most active hour from transcription_timestamps
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
        COALESCE(ls.total_words, 0),
        COALESCE(ls.total_transcriptions, 0),
        calculate_daily_streak(p_user_id, p_user_timezone),
        COALESCE(ts.today_words, 0),
        CASE 
            WHEN COALESCE(ls.total_transcriptions, 0) > 0 
            THEN COALESCE(ls.total_words, 0) / COALESCE(ls.total_transcriptions, 0)
            ELSE 0 
        END as average_words_per_session,
        COALESCE(hs.hour, 14) as most_active_hour -- Default to 2 PM if no data
    FROM lifetime_stats ls
    CROSS JOIN today_stats ts
    LEFT JOIN hourly_stats hs ON true;
END;
$$ LANGUAGE plpgsql;

-- Also update calculate_daily_streak to use user_daily_activity instead of transcription_timestamps
CREATE OR REPLACE FUNCTION calculate_daily_streak(p_user_id UUID, p_user_timezone TEXT DEFAULT 'UTC')
RETURNS INT AS $$
DECLARE
    v_current_date DATE;
    v_streak INT := 0;
    v_check_date DATE;
BEGIN
    -- Get the user's current date in their timezone
    v_current_date := (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE;
    
    -- Get the most recent activity date
    SELECT MAX(activity_date)
    INTO v_check_date
    FROM user_daily_activity
    WHERE user_id = p_user_id;
    
    -- If no activity, return 0
    IF v_check_date IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Check if the streak is still active (activity today or yesterday)
    IF v_check_date < v_current_date - INTERVAL '1 day' THEN
        RETURN 0;
    END IF;
    
    -- Count consecutive days backwards from the most recent activity
    WHILE EXISTS (
        SELECT 1 
        FROM user_daily_activity 
        WHERE user_id = p_user_id 
        AND activity_date = v_check_date
    ) LOOP
        v_streak := v_streak + 1;
        v_check_date := v_check_date - INTERVAL '1 day';
    END LOOP;
    
    RETURN v_streak;
END;
$$ LANGUAGE plpgsql;