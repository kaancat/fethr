-- Create a comprehensive function to get all dashboard statistics
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
    v_total_words BIGINT;
    v_total_transcriptions BIGINT;
    v_daily_streak INTEGER;
    v_today_words BIGINT;
    v_average_words_per_session BIGINT;
    v_most_active_hour INTEGER;
    v_week_start DATE;
BEGIN
    -- Get the start of current week (Sunday)
    v_week_start := CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INTEGER;
    
    -- Get total words from subscription
    SELECT COALESCE(word_usage_this_period, 0)
    INTO v_total_words
    FROM public.subscriptions
    WHERE user_id = p_user_id
    LIMIT 1;
    
    -- Get aggregated stats from user_statistics
    WITH all_stats AS (
        SELECT 
            SUM(total_transcriptions) as total_transcriptions,
            MAX(daily_streak) as daily_streak,
            MAX(last_transcription_date) as last_transcription_date
        FROM public.user_statistics
        WHERE user_id = p_user_id
    ),
    today_stats AS (
        SELECT 
            COALESCE(SUM(weekly_words_transcribed), 0) as today_words
        FROM public.user_statistics
        WHERE user_id = p_user_id
        AND last_transcription_date = CURRENT_DATE
    )
    SELECT 
        COALESCE(all_stats.total_transcriptions, 0),
        COALESCE(all_stats.daily_streak, 0),
        today_stats.today_words
    INTO 
        v_total_transcriptions,
        v_daily_streak,
        v_today_words
    FROM all_stats, today_stats;
    
    -- Calculate average words per session
    IF v_total_transcriptions > 0 THEN
        v_average_words_per_session := v_total_words / v_total_transcriptions;
    ELSE
        v_average_words_per_session := 0;
    END IF;
    
    -- For now, set most active hour to a default (this could be enhanced later)
    v_most_active_hour := 14; -- 2 PM as default
    
    -- Build the result JSON
    v_result := json_build_object(
        'total_words', v_total_words,
        'total_transcriptions', v_total_transcriptions,
        'daily_streak', v_daily_streak,
        'today_words', v_today_words,
        'average_words_per_session', v_average_words_per_session,
        'most_active_hour', v_most_active_hour,
        'dictionary_size', 0, -- Will be fetched from local
        'recent_transcriptions', '[]'::json -- Will be fetched from local
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to track transcription timestamps for hour analysis
CREATE TABLE IF NOT EXISTS public.transcription_timestamps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    transcribed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    word_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS policies
ALTER TABLE public.transcription_timestamps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own timestamps" ON public.transcription_timestamps
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own timestamps" ON public.transcription_timestamps
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Update increment_transcription_stats to also track timestamps
CREATE OR REPLACE FUNCTION public.increment_transcription_stats(
    p_user_id UUID,
    p_word_count INTEGER
) RETURNS void AS $$
DECLARE
    v_minutes_saved DECIMAL(10, 2);
    v_last_transcription_date DATE;
    v_current_streak INTEGER;
    v_longest_streak INTEGER;
    v_existing_total_words BIGINT;
    v_existing_total_transcriptions BIGINT;
    v_existing_total_minutes DECIMAL(10, 2);
BEGIN
    -- Calculate minutes saved (typing speed: 50 WPM, speaking speed: 130 WPM)
    v_minutes_saved := (p_word_count::DECIMAL / 50) - (p_word_count::DECIMAL / 130);
    
    -- Insert timestamp record for hour tracking
    INSERT INTO public.transcription_timestamps (user_id, word_count)
    VALUES (p_user_id, p_word_count);
    
    -- Get the user's existing stats (cumulative totals)
    SELECT 
        SUM(total_words_transcribed),
        SUM(total_transcriptions),
        SUM(total_minutes_saved),
        MAX(last_transcription_date),
        MAX(daily_streak),
        MAX(longest_streak)
    INTO 
        v_existing_total_words,
        v_existing_total_transcriptions,
        v_existing_total_minutes,
        v_last_transcription_date,
        v_current_streak,
        v_longest_streak
    FROM public.user_statistics
    WHERE user_id = p_user_id;
    
    -- Initialize if no previous records
    IF v_existing_total_words IS NULL THEN
        v_existing_total_words := 0;
        v_existing_total_transcriptions := 0;
        v_existing_total_minutes := 0;
        v_current_streak := 1;
        v_longest_streak := 1;
    ELSE
        -- Calculate the new streak
        IF v_last_transcription_date = CURRENT_DATE - INTERVAL '1 day' THEN
            -- Consecutive day - increment streak
            v_current_streak := v_current_streak + 1;
        ELSIF v_last_transcription_date = CURRENT_DATE THEN
            -- Same day - keep current streak
            -- v_current_streak remains the same
        ELSE
            -- Streak broken - reset to 1
            v_current_streak := 1;
        END IF;
        
        -- Update longest streak if necessary
        v_longest_streak := GREATEST(v_longest_streak, v_current_streak);
    END IF;
    
    -- Update the subscription table with new total words
    UPDATE public.subscriptions
    SET word_usage_this_period = v_existing_total_words + p_word_count
    WHERE user_id = p_user_id;
    
    -- Insert or update user statistics for the current week (keeping weekly records for history)
    INSERT INTO public.user_statistics (
        user_id,
        total_words_transcribed,
        total_transcriptions,
        total_minutes_saved,
        week_start_date,
        weekly_words_transcribed,
        weekly_transcriptions,
        last_transcription_date,
        daily_streak,
        longest_streak
    ) VALUES (
        p_user_id,
        p_word_count,
        1,
        v_minutes_saved,
        CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INTEGER, -- Sunday as week start
        p_word_count,
        1,
        CURRENT_DATE,
        v_current_streak,
        v_longest_streak
    )
    ON CONFLICT (user_id, week_start_date) DO UPDATE SET
        total_words_transcribed = user_statistics.total_words_transcribed + p_word_count,
        total_transcriptions = user_statistics.total_transcriptions + 1,
        total_minutes_saved = user_statistics.total_minutes_saved + v_minutes_saved,
        weekly_words_transcribed = user_statistics.weekly_words_transcribed + p_word_count,
        weekly_transcriptions = user_statistics.weekly_transcriptions + 1,
        last_transcription_date = CURRENT_DATE,
        daily_streak = v_current_streak,
        longest_streak = v_longest_streak,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enhanced dashboard stats with hour analysis
CREATE OR REPLACE FUNCTION public.get_dashboard_stats_enhanced(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
    v_total_words BIGINT;
    v_total_transcriptions BIGINT;
    v_daily_streak INTEGER;
    v_today_words BIGINT;
    v_average_words_per_session BIGINT;
    v_most_active_hour INTEGER;
    v_hour_counts JSON;
BEGIN
    -- Get total words from subscription
    SELECT COALESCE(word_usage_this_period, 0)
    INTO v_total_words
    FROM public.subscriptions
    WHERE user_id = p_user_id
    LIMIT 1;
    
    -- Get aggregated stats from user_statistics
    WITH all_stats AS (
        SELECT 
            SUM(total_transcriptions) as total_transcriptions,
            MAX(daily_streak) as daily_streak,
            MAX(last_transcription_date) as last_transcription_date
        FROM public.user_statistics
        WHERE user_id = p_user_id
    ),
    today_stats AS (
        SELECT 
            COALESCE(SUM(weekly_words_transcribed), 0) as today_words
        FROM public.user_statistics
        WHERE user_id = p_user_id
        AND last_transcription_date = CURRENT_DATE
    ),
    hour_analysis AS (
        SELECT 
            EXTRACT(HOUR FROM transcribed_at AT TIME ZONE 'UTC') as hour,
            COUNT(*) as count
        FROM public.transcription_timestamps
        WHERE user_id = p_user_id
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 1
    )
    SELECT 
        COALESCE(all_stats.total_transcriptions, 0),
        COALESCE(all_stats.daily_streak, 0),
        today_stats.today_words,
        COALESCE(hour_analysis.hour, 14) -- Default to 2 PM if no data
    INTO 
        v_total_transcriptions,
        v_daily_streak,
        v_today_words,
        v_most_active_hour
    FROM all_stats, today_stats
    LEFT JOIN hour_analysis ON true;
    
    -- Get hour distribution
    SELECT json_agg(
        json_build_object(
            'hour', hour,
            'count', count
        ) ORDER BY hour
    )
    INTO v_hour_counts
    FROM (
        SELECT 
            EXTRACT(HOUR FROM transcribed_at AT TIME ZONE 'UTC') as hour,
            COUNT(*) as count
        FROM public.transcription_timestamps
        WHERE user_id = p_user_id
        GROUP BY hour
    ) as hour_data;
    
    -- Calculate average words per session
    IF v_total_transcriptions > 0 THEN
        v_average_words_per_session := v_total_words / v_total_transcriptions;
    ELSE
        v_average_words_per_session := 0;
    END IF;
    
    -- Build the result JSON
    v_result := json_build_object(
        'total_words', v_total_words,
        'total_transcriptions', v_total_transcriptions,
        'daily_streak', v_daily_streak,
        'today_words', v_today_words,
        'average_words_per_session', v_average_words_per_session,
        'most_active_hour', v_most_active_hour,
        'hour_distribution', COALESCE(v_hour_counts, '[]'::json),
        'dictionary_size', 0, -- Will be fetched from local
        'recent_transcriptions', '[]'::json -- Will be fetched from local
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;