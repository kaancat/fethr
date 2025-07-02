# Timezone Localization Plan for Daily Streaks

## Current State
- All timestamps stored in UTC
- Daily streak calculations use UTC midnight as day boundary
- Users in different timezones see day changes at different local times

## Proposed Solution: Client-Side Localization

### 1. Database Changes
```sql
-- Modify the calculate_daily_streak function to accept timezone parameter
CREATE OR REPLACE FUNCTION calculate_daily_streak(p_user_id UUID, p_user_timezone TEXT DEFAULT 'UTC')
RETURNS INT AS $$
DECLARE
    v_current_date DATE;
    v_streak INT := 0;
    v_check_date DATE;
BEGIN
    -- Get the most recent activity date in user's timezone
    SELECT MAX(DATE(transcribed_at AT TIME ZONE p_user_timezone))
    INTO v_current_date
    FROM transcription_timestamps
    WHERE user_id = p_user_id;
    
    -- If no activity, return 0
    IF v_current_date IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Check if the streak is still active (activity today or yesterday in user's timezone)
    IF v_current_date < (CURRENT_TIMESTAMP AT TIME ZONE p_user_timezone)::DATE - INTERVAL '1 day' THEN
        RETURN 0;
    END IF;
    
    -- Count consecutive days backwards from the most recent activity
    v_check_date := v_current_date;
    WHILE EXISTS (
        SELECT 1 
        FROM transcription_timestamps 
        WHERE user_id = p_user_id 
        AND DATE(transcribed_at AT TIME ZONE p_user_timezone) = v_check_date
    ) LOOP
        v_streak := v_streak + 1;
        v_check_date := v_check_date - INTERVAL '1 day';
    END LOOP;
    
    RETURN v_streak;
END;
$$ LANGUAGE plpgsql;
```

### 2. Frontend Changes

#### Add timezone detection utility:
```typescript
// src/utils/timezone.ts
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getLocalMidnightUTC(): Date {
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return localMidnight;
}

export function getLocalDayBoundaries() {
  const timezone = getUserTimezone();
  const now = new Date();
  
  // Start of today in local time
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Start of tomorrow in local time
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  
  return {
    todayStartUTC: todayStart.toISOString(),
    tomorrowStartUTC: tomorrowStart.toISOString(),
    timezone
  };
}
```

#### Update the dashboard stats call:
```typescript
// Pass timezone to backend
const timezone = getUserTimezone();
const stats = await invoke<DashboardStats>('get_dashboard_stats_with_auth', {
  userId: session.user.id,
  accessToken: session.access_token,
  timezone: timezone // New parameter
});
```

### 3. Backend Changes

#### Update Rust command to accept timezone:
```rust
#[tauri::command]
async fn get_dashboard_stats_with_auth(
    app_handle: AppHandle, 
    user_id: String, 
    access_token: String,
    timezone: Option<String> // New parameter
) -> Result<DashboardStats, String> {
    let user_timezone = timezone.unwrap_or_else(|| "UTC".to_string());
    
    // Pass timezone to database function
    let stats_response = client
        .post(format!("{}/rest/v1/rpc/get_dashboard_stats_enhanced", supabase_url))
        .json(&serde_json::json!({
            "p_user_id": user_id,
            "p_user_timezone": user_timezone
        }))
        // ... rest of the code
}
```

### 4. Benefits
- Users see streaks based on their local midnight
- More intuitive - "did I use Fethr today?" based on user's actual day
- All data still stored in UTC for consistency
- Can easily show both local and UTC times if needed

### 5. Migration Strategy
1. Update database functions to accept timezone parameter (default 'UTC' for backward compatibility)
2. Detect user timezone in frontend
3. Pass timezone to all relevant API calls
4. Update tooltips to say "based on your local timezone" instead of "UTC timezone"

Would you like me to implement this timezone localization?