import { supabase } from '@/lib/supabaseClient';
import { Session } from '@supabase/supabase-js';

// Cache for session to reduce API calls
let cachedSession: Session | null = null;
let sessionCacheTime = 0;
const SESSION_CACHE_DURATION = 30000; // 30 seconds

/**
 * Get a valid session, refreshing if necessary
 * This ensures we always have a fresh token for API calls
 */
export async function getValidSession(): Promise<Session | null> {
  try {
    // Check cache first
    const now = Date.now();
    if (cachedSession && now - sessionCacheTime < SESSION_CACHE_DURATION) {
      // Check if token is about to expire (within 5 minutes)
      const expiresAt = cachedSession.expires_at ? cachedSession.expires_at * 1000 : 0;
      if (expiresAt > now + 300000) { // 5 minutes buffer
        return cachedSession;
      }
    }

    // Get current session
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('[Auth] Error getting session:', error);
      cachedSession = null;
      return null;
    }

    if (!session) {
      cachedSession = null;
      return null;
    }

    // Check if token needs refresh (expires within 5 minutes)
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAt <= now + 300000) {
      console.log('[Auth] Token expiring soon, refreshing...');
      const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) {
        console.error('[Auth] Error refreshing session:', refreshError);
        // Return existing session anyway, let the API call fail if needed
        cachedSession = session;
        sessionCacheTime = now;
        return session;
      }

      cachedSession = refreshedSession;
      sessionCacheTime = now;
      return refreshedSession;
    }

    // Session is valid
    cachedSession = session;
    sessionCacheTime = now;
    return session;
  } catch (error) {
    console.error('[Auth] Unexpected error in getValidSession:', error);
    return null;
  }
}

/**
 * Clear the session cache (e.g., after logout)
 */
export function clearSessionCache() {
  cachedSession = null;
  sessionCacheTime = 0;
}

/**
 * Execute a function with automatic retry on auth failure
 */
export async function withAuthRetry<T>(
  fn: (session: Session) => Promise<T>,
  maxRetries = 1
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i <= maxRetries; i++) {
    const session = await getValidSession();
    
    if (!session) {
      throw new Error('No active session');
    }

    try {
      return await fn(session);
    } catch (error: any) {
      lastError = error;
      
      // Check if it's an auth error
      if (error?.status === 401 || error?.message?.includes('JWT')) {
        console.log('[Auth] Got 401, attempting to refresh token...');
        // Force refresh on next attempt
        clearSessionCache();
        if (i < maxRetries) {
          const { data: { session: newSession } } = await supabase.auth.refreshSession();
          if (newSession) {
            cachedSession = newSession;
            sessionCacheTime = Date.now();
            continue;
          }
        }
      }
      
      // Not an auth error or last retry, throw it
      throw error;
    }
  }

  throw lastError || new Error('Auth retry failed');
}

/**
 * Check if an error is an authentication error
 */
export function isAuthError(error: any): boolean {
  return error?.status === 401 || 
         error?.code === 'PGRST301' ||
         error?.message?.toLowerCase().includes('jwt') ||
         error?.message?.toLowerCase().includes('unauthorized');
}

/**
 * Get a user-friendly error message
 */
export function getErrorMessage(error: any): string {
  if (isAuthError(error)) {
    return 'Your session has expired. Please sign in again.';
  }
  
  if (error?.status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  
  if (error?.status >= 500) {
    return 'Server error. Please try again later.';
  }
  
  if (error?.message?.includes('network')) {
    return 'Network error. Please check your connection.';
  }
  
  return error?.message || 'An unexpected error occurred';
}