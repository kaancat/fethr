-- Fix ambiguous column references in get_dashboard_stats_enhanced
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
            COALESCE(lifetime_words_transcribed, 0) as words_count,
            COALESCE(lifetime_transcriptions, 0) as transcriptions_count
        FROM user_statistics
        WHERE user_id = p_user_id
        LIMIT 1
    ),
    today_stats AS (
        -- Get today's stats from user_daily_activity
        SELECT 
            COALESCE(SUM(total_words), 0) as words_today
        FROM user_daily_activity
        WHERE user_id = p_user_id
        AND activity_date = (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE
    ),
    hourly_stats AS (
        -- Get most active hour from transcription_timestamps
        SELECT 
            EXTRACT(HOUR FROM transcribed_at AT TIME ZONE p_user_timezone)::INT as active_hour,
            COUNT(*) as hour_count
        FROM transcription_timestamps
        WHERE user_id = p_user_id
        GROUP BY active_hour
        ORDER BY hour_count DESC
        LIMIT 1
    )
    SELECT 
        COALESCE(ls.words_count, 0) AS total_words,
        COALESCE(ls.transcriptions_count, 0) AS total_transcriptions,
        calculate_daily_streak(p_user_id, p_user_timezone) AS daily_streak,
        COALESCE(ts.words_today, 0) AS today_words,
        CASE 
            WHEN COALESCE(ls.transcriptions_count, 0) > 0 
            THEN COALESCE(ls.words_count, 0) / COALESCE(ls.transcriptions_count, 0)
            ELSE 0 
        END AS average_words_per_session,
        COALESCE(hs.active_hour, 14) AS most_active_hour -- Default to 2 PM if no data
    FROM lifetime_stats ls
    CROSS JOIN today_stats ts
    LEFT JOIN hourly_stats hs ON true;
END;
$$ LANGUAGE plpgsql;