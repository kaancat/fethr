-- Drop existing objects if they exist (safe for re-running)
DROP FUNCTION IF EXISTS increment_transcription_stats(UUID, INTEGER);
DROP FUNCTION IF EXISTS get_or_create_user_stats(UUID);

-- Create user_statistics table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.user_statistics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Lifetime stats
    total_words_transcribed BIGINT DEFAULT 0,
    total_transcriptions BIGINT DEFAULT 0,
    total_minutes_saved DECIMAL(10, 2) DEFAULT 0,
    -- Weekly stats
    week_start_date DATE NOT NULL,
    weekly_words_transcribed BIGINT DEFAULT 0,
    weekly_transcriptions BIGINT DEFAULT 0,
    -- Daily stats
    last_transcription_date DATE,
    daily_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure one record per user per week
    UNIQUE(user_id, week_start_date)
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_user_statistics_user_id ON public.user_statistics(user_id);
CREATE INDEX IF NOT EXISTS idx_user_statistics_week_start ON public.user_statistics(week_start_date);

-- Enable RLS
ALTER TABLE public.user_statistics ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own statistics" ON public.user_statistics;
DROP POLICY IF EXISTS "Users can insert own statistics" ON public.user_statistics;
DROP POLICY IF EXISTS "Users can update own statistics" ON public.user_statistics;

-- Create policies
CREATE POLICY "Users can view own statistics" ON public.user_statistics
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own statistics" ON public.user_statistics
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own statistics" ON public.user_statistics
    FOR UPDATE USING (auth.uid() = user_id);

-- Function to get or create current week stats
CREATE OR REPLACE FUNCTION get_or_create_user_stats(p_user_id UUID)
RETURNS public.user_statistics AS $$
DECLARE
    v_week_start DATE;
    v_stats public.user_statistics;
BEGIN
    -- Calculate start of current week (Monday)
    v_week_start := date_trunc('week', CURRENT_DATE)::DATE;
    
    -- Try to get existing stats for this week
    SELECT * INTO v_stats
    FROM public.user_statistics
    WHERE user_id = p_user_id AND week_start_date = v_week_start;
    
    -- If not found, create new record
    IF NOT FOUND THEN
        INSERT INTO public.user_statistics (user_id, week_start_date)
        VALUES (p_user_id, v_week_start)
        RETURNING * INTO v_stats;
    END IF;
    
    RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment transcription stats
CREATE OR REPLACE FUNCTION increment_transcription_stats(
    p_user_id UUID,
    p_word_count INTEGER
) RETURNS void AS $$
DECLARE
    v_week_start DATE;
    v_typing_minutes DECIMAL(10, 2);
    v_speaking_minutes DECIMAL(10, 2);
    v_saved_minutes DECIMAL(10, 2);
BEGIN
    -- Calculate start of current week
    v_week_start := date_trunc('week', CURRENT_DATE)::DATE;
    
    -- Calculate time saved (50 WPM typing vs 130 WPM speaking)
    v_typing_minutes := p_word_count::DECIMAL / 50;
    v_speaking_minutes := p_word_count::DECIMAL / 130;
    v_saved_minutes := v_typing_minutes - v_speaking_minutes;
    
    -- Upsert statistics
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
        1,
        NOW()
    )
    ON CONFLICT (user_id, week_start_date) DO UPDATE SET
        total_words_transcribed = user_statistics.total_words_transcribed + p_word_count,
        total_transcriptions = user_statistics.total_transcriptions + 1,
        total_minutes_saved = user_statistics.total_minutes_saved + v_saved_minutes,
        weekly_words_transcribed = user_statistics.weekly_words_transcribed + p_word_count,
        weekly_transcriptions = user_statistics.weekly_transcriptions + 1,
        last_transcription_date = CURRENT_DATE,
        daily_streak = CASE
            WHEN user_statistics.last_transcription_date = CURRENT_DATE - INTERVAL '1 day' 
                THEN user_statistics.daily_streak + 1
            WHEN user_statistics.last_transcription_date = CURRENT_DATE 
                THEN user_statistics.daily_streak
            ELSE 1
        END,
        longest_streak = GREATEST(
            user_statistics.longest_streak,
            CASE
                WHEN user_statistics.last_transcription_date = CURRENT_DATE - INTERVAL '1 day' 
                    THEN user_statistics.daily_streak + 1
                WHEN user_statistics.last_transcription_date = CURRENT_DATE 
                    THEN user_statistics.daily_streak
                ELSE 1
            END
        ),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;