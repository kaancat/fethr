/**
 * Get the user's timezone from the browser
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Fallback to UTC if timezone detection fails
    return 'UTC';
  }
}

/**
 * Get the start of today in the user's local timezone
 */
export function getLocalDayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Get the start of tomorrow in the user's local timezone
 */
export function getLocalDayEnd(): Date {
  const start = getLocalDayStart();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return end;
}

/**
 * Format hour for display (0-23 to 12-hour format with AM/PM)
 */
export function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

/**
 * Get a human-friendly timezone name (e.g., "EST", "PST", "CET")
 * This is a simplified version - full timezone abbreviations are complex
 */
export function getTimezoneAbbreviation(): string {
  const timezone = getUserTimezone();
  const date = new Date();
  
  // Try to get the short timezone name
  try {
    const short = date.toLocaleTimeString('en-US', {
      timeZoneName: 'short',
      timeZone: timezone,
    });
    return short.split(' ').pop() || timezone;
  } catch {
    return timezone;
  }
}