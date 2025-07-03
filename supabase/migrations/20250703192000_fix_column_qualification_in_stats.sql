-- Fix column qualification to avoid ambiguity with output columns
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
            COALESCE(us.lifetime_words_transcribed, 0) as words_count,
            COALESCE(us.lifetime_transcriptions, 0) as transcriptions_count
        FROM user_statistics us
        WHERE us.user_id = p_user_id
        LIMIT 1
    ),
    today_stats AS (
        -- Get today's stats from user_daily_activity
        SELECT 
            COALESCE(SUM(uda.total_words), 0) as words_today
        FROM user_daily_activity uda
        WHERE uda.user_id = p_user_id
        AND uda.activity_date = (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE
    ),
    hourly_stats AS (
        -- Get most active hour from transcription_timestamps
        SELECT 
            EXTRACT(HOUR FROM tt.transcribed_at AT TIME ZONE p_user_timezone)::INT as active_hour,
            COUNT(*) as hour_count
        FROM transcription_timestamps tt
        WHERE tt.user_id = p_user_id
        GROUP BY active_hour
        ORDER BY hour_count DESC
        LIMIT 1
    )
    SELECT 
        COALESCE(ls.words_count, 0)::BIGINT,
        COALESCE(ls.transcriptions_count, 0)::BIGINT,
        calculate_daily_streak(p_user_id, p_user_timezone),
        COALESCE(ts.words_today, 0)::BIGINT,
        CASE 
            WHEN COALESCE(ls.transcriptions_count, 0) > 0 
            THEN (COALESCE(ls.words_count, 0) / COALESCE(ls.transcriptions_count, 0))::BIGINT
            ELSE 0::BIGINT
        END,
        COALESCE(hs.active_hour, 14)
    FROM lifetime_stats ls
    CROSS JOIN today_stats ts
    LEFT JOIN hourly_stats hs ON true;
END;
$$ LANGUAGE plpgsql;