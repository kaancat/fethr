-- Fix streak calculation to work across week boundaries
-- This migration updates the increment_transcription_stats function to properly
-- track daily streaks that span multiple weeks

-- Drop the old function
DROP FUNCTION IF EXISTS increment_transcription_stats(UUID, INTEGER);

-- Create improved function that maintains streak across weeks
CREATE OR REPLACE FUNCTION increment_transcription_stats(
    p_user_id UUID,
    p_word_count INTEGER
) RETURNS void AS $$
DECLARE
    v_week_start DATE;
    v_typing_minutes DECIMAL(10, 2);
    v_speaking_minutes DECIMAL(10, 2);
    v_saved_minutes DECIMAL(10, 2);
    v_last_transcription_date DATE;
    v_current_streak INTEGER;
    v_longest_streak INTEGER;
BEGIN
    -- Calculate start of current week
    v_week_start := date_trunc('week', CURRENT_DATE)::DATE;
    
    -- Calculate time saved (50 WPM typing vs 130 WPM speaking)
    v_typing_minutes := p_word_count::DECIMAL / 50;
    v_speaking_minutes := p_word_count::DECIMAL / 130;
    v_saved_minutes := v_typing_minutes - v_speaking_minutes;
    
    -- Get the user's most recent transcription date and current streak from ANY week
    SELECT 
        last_transcription_date,
        daily_streak,
        longest_streak
    INTO 
        v_last_transcription_date,
        v_current_streak,
        v_longest_streak
    FROM public.user_statistics
    WHERE user_id = p_user_id
    ORDER BY last_transcription_date DESC NULLS LAST
    LIMIT 1;
    
    -- If no previous record found, initialize values
    IF NOT FOUND THEN
        v_last_transcription_date := NULL;
        v_current_streak := 0;
        v_longest_streak := 0;
    END IF;
    
    -- Calculate the new streak
    IF v_last_transcription_date IS NULL THEN
        -- First transcription ever
        v_current_streak := 1;
    ELSIF v_last_transcription_date = CURRENT_DATE THEN
        -- Already transcribed today, keep the same streak
        -- v_current_streak remains unchanged
    ELSIF v_last_transcription_date = CURRENT_DATE - INTERVAL '1 day' THEN
        -- Transcribed yesterday, increment the streak
        v_current_streak := v_current_streak + 1;
    ELSE
        -- Streak broken, reset to 1
        v_current_streak := 1;
    END IF;
    
    -- Update longest streak if needed
    v_longest_streak := GREATEST(v_longest_streak, v_current_streak);
    
    -- Upsert statistics for the current week
    INSERT INTO public.user_statistics (
        user_id,
        week_start_date,
        total_words_transcribed,
        total_transcriptions,
        total_minutes_saved,
        weekly_words_transcribed,
        weekly_transcriptions,
        last_transcription_date,
        daily_streak,
        longest_streak,
        updated_at
    ) VALUES (
        p_user_id,
        v_week_start,
        p_word_count,
        1,
        v_saved_minutes,
        p_word_count,
        1,
        CURRENT_DATE,
        v_current_streak,
        v_longest_streak,
        NOW()
    )
    ON CONFLICT (user_id, week_start_date) DO UPDATE SET
        total_words_transcribed = user_statistics.total_words_transcribed + p_word_count,
        total_transcriptions = user_statistics.total_transcriptions + 1,
        total_minutes_saved = user_statistics.total_minutes_saved + v_saved_minutes,
        weekly_words_transcribed = user_statistics.weekly_words_transcribed + p_word_count,
        weekly_transcriptions = user_statistics.weekly_transcriptions + 1,
        last_transcription_date = CURRENT_DATE,
        daily_streak = v_current_streak,
        longest_streak = v_longest_streak,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also update the get_or_create_user_stats function to return the most recent streak
CREATE OR REPLACE FUNCTION get_or_create_user_stats(p_user_id UUID)
RETURNS public.user_statistics AS $$
DECLARE
    v_week_start DATE;
    v_stats public.user_statistics;
    v_latest_streak INTEGER;
    v_longest_streak INTEGER;
BEGIN
    -- Calculate start of current week (Monday)
    v_week_start := date_trunc('week', CURRENT_DATE)::DATE;
    
    -- Get the latest streak from any previous week
    SELECT 
        daily_streak,
        longest_streak
    INTO 
        v_latest_streak,
        v_longest_streak
    FROM public.user_statistics
    WHERE user_id = p_user_id
    ORDER BY last_transcription_date DESC NULLS LAST
    LIMIT 1;
    
    -- Try to get existing stats for this week
    SELECT * INTO v_stats
    FROM public.user_statistics
    WHERE user_id = p_user_id AND week_start_date = v_week_start;
    
    -- If not found, create new record with carried-over streak values
    IF NOT FOUND THEN
        INSERT INTO public.user_statistics (
            user_id, 
            week_start_date,
            daily_streak,
            longest_streak
        )
        VALUES (
            p_user_id, 
            v_week_start,
            COALESCE(v_latest_streak, 0),
            COALESCE(v_longest_streak, 0)
        )
        RETURNING * INTO v_stats;
    END IF;
    
    RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;