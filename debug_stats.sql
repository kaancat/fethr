-- Debug queries to check why transcription_timestamps isn't being populated

-- 1. Check if the table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'transcription_timestamps'
);

-- 2. Check table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'transcription_timestamps'
ORDER BY ordinal_position;

-- 3. Check if RLS is enabled and policies exist
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'transcription_timestamps';

-- 4. Check the current function definition
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_name = 'increment_transcription_stats'
AND routine_schema = 'public';

-- 5. Test inserting directly (replace with your actual user_id)
-- INSERT INTO public.transcription_timestamps (user_id, word_count)
-- VALUES ('your-user-id'::uuid, 10);

-- 6. Check if there are any rows
SELECT COUNT(*) FROM public.transcription_timestamps;

-- 7. Try calling the function manually (replace with your actual user_id)
-- SELECT increment_transcription_stats('your-user-id'::uuid, 50);

-- 8. Check for any errors in the function by wrapping in exception block
DO $$
DECLARE
    test_user_id UUID := 'your-user-id'::uuid; -- Replace with actual user_id
BEGIN
    -- Try to insert into transcription_timestamps
    INSERT INTO public.transcription_timestamps (user_id, word_count)
    VALUES (test_user_id, 10);
    
    RAISE NOTICE 'Insert successful';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
END $$;