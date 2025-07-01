-- Fix permissions for increment_transcription_stats function

-- Option 1: Grant INSERT permission to the function owner
-- First, check who owns the function
SELECT proname, proowner::regrole 
FROM pg_proc 
WHERE proname = 'increment_transcription_stats';

-- Then grant permission (replace 'postgres' with actual owner if different)
GRANT INSERT ON public.transcription_timestamps TO postgres;

-- Option 2: Since the function uses SECURITY DEFINER, make sure it's owned by a role with proper permissions
-- You might need to recreate the function or change its owner
ALTER FUNCTION public.increment_transcription_stats(UUID, INTEGER) OWNER TO postgres;

-- Option 3: Grant permissions through a policy (if using RLS)
-- Make sure service role can insert
CREATE POLICY "Service role can insert timestamps" ON public.transcription_timestamps
    FOR INSERT 
    TO service_role
    WITH CHECK (true);

-- Test the permission again
SELECT has_table_privilege('public.transcription_timestamps', 'INSERT');

-- Also check if the table has proper RLS policies for the executing user
SELECT * FROM pg_policies WHERE tablename = 'transcription_timestamps';