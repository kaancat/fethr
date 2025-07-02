-- Migration: Lifetime Stats and Daily Activity Tracking
-- This migration updates the statistics system to track lifetime stats and proper daily streaks

-- Step 1: Add missing columns to transcription_timestamps
ALTER TABLE transcription_timestamps 
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS session_id UUID;

-- Add index for session queries
CREATE INDEX IF NOT EXISTS idx_transcription_timestamps_session 
ON transcription_timestamps(user_id, session_id, transcribed_at);

-- Step 2: Create user_daily_activity table for accurate streak tracking
CREATE TABLE IF NOT EXISTS user_daily_activity (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,
    total_words INTEGER DEFAULT 0,
    total_transcriptions INTEGER DEFAULT 0,
    total_duration_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, activity_date)
);

-- Add index for streak calculations
CREATE INDEX IF NOT EXISTS idx_user_daily_activity_streak 
ON user_daily_activity(user_id, activity_date DESC);

-- Enable RLS
ALTER TABLE user_daily_activity ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_daily_activity
CREATE POLICY "Users can view own daily activity" ON user_daily_activity
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily activity" ON user_daily_activity
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily activity" ON user_daily_activity
    FOR UPDATE USING (auth.uid() = user_id);

-- Step 3: Add lifetime tracking columns to user_statistics
ALTER TABLE user_statistics
ADD COLUMN IF NOT EXISTS lifetime_words_transcribed BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lifetime_transcriptions BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lifetime_duration_seconds BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lifetime_minutes_saved NUMERIC DEFAULT 0;

-- Step 4: Migrate existing data to lifetime columns
UPDATE user_statistics us
SET 
    lifetime_words_transcribed = COALESCE((
        SELECT SUM(weekly_words_transcribed) 
        FROM user_statistics 
        WHERE user_id = us.user_id
    ), 0),
    lifetime_transcriptions = COALESCE((
        SELECT SUM(weekly_transcriptions) 
        FROM user_statistics 
        WHERE user_id = us.user_id
    ), 0)
WHERE us.id = (
    SELECT id FROM user_statistics 
    WHERE user_id = us.user_id 
    ORDER BY created_at DESC 
    LIMIT 1
);

-- Step 5: Populate user_daily_activity from existing transcription_timestamps
INSERT INTO user_daily_activity (user_id, activity_date, total_words, total_transcriptions, total_duration_seconds)
SELECT 
    user_id,
    DATE(transcribed_at AT TIME ZONE 'UTC') as activity_date,
    SUM(word_count) as total_words,
    COUNT(*) as total_transcriptions,
    SUM(COALESCE(duration_seconds, 0)) as total_duration_seconds
FROM transcription_timestamps
WHERE user_id IS NOT NULL
GROUP BY user_id, DATE(transcribed_at AT TIME ZONE 'UTC')
ON CONFLICT (user_id, activity_date) DO NOTHING;

-- Step 6: Create function to calculate daily streak
CREATE OR REPLACE FUNCTION calculate_daily_streak(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_streak INTEGER := 0;
    v_current_date DATE;
    v_activity_date DATE;
    v_prev_date DATE;
BEGIN
    -- Get the most recent activity date
    SELECT MAX(activity_date) INTO v_current_date
    FROM user_daily_activity
    WHERE user_id = p_user_id;
    
    IF v_current_date IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Check if user has activity today or yesterday (to maintain streak)
    IF v_current_date < CURRENT_DATE - INTERVAL '1 day' THEN
        RETURN 0;
    END IF;
    
    -- Count consecutive days backwards from most recent activity
    v_prev_date := v_current_date;
    
    FOR v_activity_date IN 
        SELECT activity_date 
        FROM user_daily_activity 
        WHERE user_id = p_user_id 
        ORDER BY activity_date DESC
    LOOP
        -- If there's a gap of more than 1 day, streak is broken
        IF v_prev_date - v_activity_date > 1 THEN
            EXIT;
        END IF;
        
        v_streak := v_streak + 1;
        v_prev_date := v_activity_date;
    END LOOP;
    
    RETURN v_streak;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Update increment_transcription_stats function
CREATE OR REPLACE FUNCTION increment_transcription_stats(
    p_user_id UUID,
    p_word_count INTEGER,
    p_duration_seconds INTEGER DEFAULT 0,
    p_session_id UUID DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    v_current_week_start DATE;
    v_today DATE;
    v_stats_id UUID;
    v_minutes_saved NUMERIC;
BEGIN
    IF p_user_id IS NULL OR p_word_count IS NULL OR p_word_count <= 0 THEN
        RETURN;
    END IF;
    
    -- Calculate time saved (typing at 50 WPM vs actual duration)
    IF p_duration_seconds > 0 THEN
        v_minutes_saved := (p_word_count::NUMERIC / 50.0) - (p_duration_seconds::NUMERIC / 60.0);
    ELSE
        -- Fallback: estimate based on speaking speed of 130 WPM
        v_minutes_saved := (p_word_count::NUMERIC / 50.0) - (p_word_count::NUMERIC / 130.0);
    END IF;
    
    -- Get current week start and today
    v_current_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
    v_today := CURRENT_DATE;
    
    -- Insert transcription timestamp
    INSERT INTO transcription_timestamps (user_id, word_count, duration_seconds, session_id, transcribed_at)
    VALUES (p_user_id, p_word_count, p_duration_seconds, p_session_id, NOW());
    
    -- Update or insert daily activity
    INSERT INTO user_daily_activity (user_id, activity_date, total_words, total_transcriptions, total_duration_seconds)
    VALUES (p_user_id, v_today, p_word_count, 1, p_duration_seconds)
    ON CONFLICT (user_id, activity_date) 
    DO UPDATE SET
        total_words = user_daily_activity.total_words + p_word_count,
        total_transcriptions = user_daily_activity.total_transcriptions + 1,
        total_duration_seconds = user_daily_activity.total_duration_seconds + p_duration_seconds,
        updated_at = NOW();
    
    -- Get or create user statistics record
    SELECT id INTO v_stats_id
    FROM user_statistics
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF v_stats_id IS NULL THEN
        INSERT INTO user_statistics (
            user_id,
            total_words_transcribed,
            total_transcriptions,
            total_minutes_saved,
            week_start_date,
            weekly_words_transcribed,
            weekly_transcriptions,
            last_transcription_date,
            daily_streak,
            longest_streak,
            lifetime_words_transcribed,
            lifetime_transcriptions,
            lifetime_duration_seconds,
            lifetime_minutes_saved
        ) VALUES (
            p_user_id,
            p_word_count,
            1,
            v_minutes_saved,
            v_current_week_start,
            p_word_count,
            1,
            v_today,
            1,
            1,
            p_word_count,
            1,
            p_duration_seconds,
            v_minutes_saved
        );
    ELSE
        -- Update existing statistics
        UPDATE user_statistics
        SET
            total_words_transcribed = total_words_transcribed + p_word_count,
            total_transcriptions = total_transcriptions + 1,
            total_minutes_saved = total_minutes_saved + v_minutes_saved,
            weekly_words_transcribed = CASE 
                WHEN week_start_date = v_current_week_start 
                THEN weekly_words_transcribed + p_word_count 
                ELSE p_word_count 
            END,
            weekly_transcriptions = CASE 
                WHEN week_start_date = v_current_week_start 
                THEN weekly_transcriptions + 1 
                ELSE 1 
            END,
            week_start_date = v_current_week_start,
            last_transcription_date = v_today,
            lifetime_words_transcribed = COALESCE(lifetime_words_transcribed, 0) + p_word_count,
            lifetime_transcriptions = COALESCE(lifetime_transcriptions, 0) + 1,
            lifetime_duration_seconds = COALESCE(lifetime_duration_seconds, 0) + p_duration_seconds,
            lifetime_minutes_saved = COALESCE(lifetime_minutes_saved, 0) + v_minutes_saved,
            updated_at = NOW()
        WHERE id = v_stats_id;
        
        -- Update daily streak
        UPDATE user_statistics
        SET daily_streak = calculate_daily_streak(p_user_id),
            longest_streak = GREATEST(longest_streak, calculate_daily_streak(p_user_id))
        WHERE id = v_stats_id;
    END IF;
    
    -- Update subscription usage
    UPDATE subscriptions
    SET word_usage_this_period = COALESCE(word_usage_this_period, 0) + p_word_count
    WHERE user_id = p_user_id
    AND status = 'active';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE LOG 'Error in increment_transcription_stats: %', SQLERRM;
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Update get_dashboard_stats_enhanced for lifetime stats
CREATE OR REPLACE FUNCTION get_dashboard_stats_enhanced(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
    v_total_words BIGINT;
    v_total_transcriptions BIGINT;
    v_daily_streak INTEGER;
    v_today_words BIGINT;
    v_avg_words INTEGER;
    v_most_active_hour INTEGER;
    v_hour_distribution JSON;
    v_dictionary_size INTEGER;
    v_recent_transcriptions JSON;
    v_lifetime_minutes_saved NUMERIC;
    v_lifetime_duration_seconds BIGINT;
BEGIN
    -- Get lifetime statistics
    SELECT 
        COALESCE(lifetime_words_transcribed, total_words_transcribed) as total_words,
        COALESCE(lifetime_transcriptions, total_transcriptions) as total_transcriptions,
        COALESCE(lifetime_minutes_saved, total_minutes_saved) as minutes_saved,
        COALESCE(lifetime_duration_seconds, 0) as duration_seconds
    INTO v_total_words, v_total_transcriptions, v_lifetime_minutes_saved, v_lifetime_duration_seconds
    FROM user_statistics
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Calculate daily streak
    v_daily_streak := calculate_daily_streak(p_user_id);
    
    -- Get today's words
    SELECT COALESCE(SUM(total_words), 0)
    INTO v_today_words
    FROM user_daily_activity
    WHERE user_id = p_user_id
    AND activity_date = CURRENT_DATE;
    
    -- Calculate average words per session
    IF v_total_transcriptions > 0 THEN
        v_avg_words := v_total_words / v_total_transcriptions;
    ELSE
        v_avg_words := 0;
    END IF;
    
    -- Get most active hour
    SELECT EXTRACT(HOUR FROM transcribed_at)::INTEGER
    INTO v_most_active_hour
    FROM transcription_timestamps
    WHERE user_id = p_user_id
    GROUP BY EXTRACT(HOUR FROM transcribed_at)
    ORDER BY COUNT(*) DESC
    LIMIT 1;
    
    -- Get hour distribution
    SELECT json_agg(
        json_build_object(
            'hour', hour,
            'count', count
        ) ORDER BY hour
    )
    INTO v_hour_distribution
    FROM (
        SELECT 
            EXTRACT(HOUR FROM transcribed_at)::INTEGER as hour,
            COUNT(*)::INTEGER as count
        FROM transcription_timestamps
        WHERE user_id = p_user_id
        AND transcribed_at >= NOW() - INTERVAL '7 days'
        GROUP BY EXTRACT(HOUR FROM transcribed_at)
    ) h;
    
    -- Build result
    v_result := json_build_object(
        'total_words', COALESCE(v_total_words, 0),
        'total_transcriptions', COALESCE(v_total_transcriptions, 0),
        'daily_streak', COALESCE(v_daily_streak, 0),
        'today_words', COALESCE(v_today_words, 0),
        'average_words_per_session', COALESCE(v_avg_words, 0),
        'most_active_hour', v_most_active_hour,
        'hour_distribution', COALESCE(v_hour_distribution, '[]'::JSON),
        'dictionary_size', 0,
        'recent_transcriptions', '[]'::JSON,
        'lifetime_minutes_saved', COALESCE(v_lifetime_minutes_saved, 0),
        'lifetime_duration_seconds', COALESCE(v_lifetime_duration_seconds, 0)
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 9: Clean up duplicate weekly records (keep only the most recent)
DELETE FROM user_statistics
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id) id
    FROM user_statistics
    ORDER BY user_id, created_at DESC
);