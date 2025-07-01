-- Fix increment_transcription_stats to use cumulative totals instead of weekly buckets
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
        date_trunc('week', CURRENT_DATE)::DATE,
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

-- Update get_or_create_user_stats to use Sunday as week start
CREATE OR REPLACE FUNCTION public.get_or_create_user_stats(p_user_id UUID)
RETURNS public.user_statistics AS $$
DECLARE
    v_result public.user_statistics;
    v_week_start DATE;
    v_last_streak INTEGER;
    v_longest_streak INTEGER;
    v_last_transcription_date DATE;
BEGIN
    -- Get the start of the current week (Sunday)
    v_week_start := CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INTEGER;
    
    -- Try to get existing stats for current week
    SELECT * INTO v_result
    FROM public.user_statistics
    WHERE user_id = p_user_id AND week_start_date = v_week_start;
    
    -- If not found, create new entry
    IF NOT FOUND THEN
        -- Get the most recent streak info from any previous week
        SELECT daily_streak, longest_streak, last_transcription_date
        INTO v_last_streak, v_longest_streak, v_last_transcription_date
        FROM public.user_statistics
        WHERE user_id = p_user_id
        ORDER BY last_transcription_date DESC NULLS LAST
        LIMIT 1;
        
        -- If we have a previous record, check if we should continue the streak
        IF v_last_transcription_date IS NOT NULL THEN
            -- Only continue streak if last transcription was yesterday or today
            IF v_last_transcription_date < CURRENT_DATE - INTERVAL '1 day' THEN
                v_last_streak := 0;  -- Reset streak if more than 1 day gap
            END IF;
        ELSE
            v_last_streak := 0;
            v_longest_streak := 0;
        END IF;
        
        INSERT INTO public.user_statistics (
            user_id,
            week_start_date,
            daily_streak,
            longest_streak,
            last_transcription_date
        ) VALUES (
            p_user_id,
            v_week_start,
            COALESCE(v_last_streak, 0),
            COALESCE(v_longest_streak, 0),
            v_last_transcription_date
        )
        RETURNING * INTO v_result;
    END IF;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;