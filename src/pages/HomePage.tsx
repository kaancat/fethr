import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, TrendingUp, Clock, Zap, Copy, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { HistoryEntry } from '../types';
import { supabase } from '@/lib/supabaseClient';
import type { User } from '@supabase/supabase-js';
import LoggedOutState from '../components/LoggedOutState';
import { getValidSession, withAuthRetry, getErrorMessage } from '@/utils/supabaseAuth';

interface DashboardStats {
  total_words: number;
  total_transcriptions: number;
  daily_streak: number;
  today_words: number;
  average_words_per_session: number;
  dictionary_size: number;
  most_active_hour: number;
  recent_transcriptions: HistoryEntry[];
}

interface HomePageProps {
  user: User | null;
  loadingAuth: boolean;
}

function HomePage({ user, loadingAuth }: HomePageProps) {
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userName, setUserName] = useState<string>('');
  const lastUpdateTimeRef = useRef(0);

  // Wrap loadDashboardData in useCallback to use it as a dependency
  const loadDashboardData = useCallback(async (skipLoadingState = false) => {
    // Debounce: Skip if we just updated less than 2 seconds ago
    const now = Date.now();
    if (skipLoadingState && now - lastUpdateTimeRef.current < 2000) {
      console.log('[HomePage] Skipping update - too soon since last update');
      return;
    }
    
    try {
      lastUpdateTimeRef.current = now;
      if (!skipLoadingState) {
        setIsLoading(true);
      }
      
      // Only load stats if user is authenticated
      if (user) {
        // Get dashboard stats with auth - using improved auth handling
        try {
          const stats = await withAuthRetry(async (session) => {
            return await invoke<DashboardStats>('get_dashboard_stats_with_auth', {
              userId: session.user.id,
              accessToken: session.access_token
            });
          });
          setStats(stats);
        } catch (error: any) {
          console.error('Failed to load dashboard stats:', error);
          
          // Show user-friendly error message
          const errorMsg = getErrorMessage(error);
          if (errorMsg.includes('session has expired')) {
            toast({
              variant: "destructive",
              title: "Session expired",
              description: "Please sign in again to view your statistics"
            });
          }
          
          // Try fallback to local stats
          try {
            const stats = await invoke<DashboardStats>('get_dashboard_stats');
            setStats(stats);
          } catch (fallbackError) {
            console.error('Failed to load local stats:', fallbackError);
            setStats(null);
          }
        }
      } else {
        // Not authenticated, don't show any stats
        setStats(null);
      }
      
      // Get user name from settings or use default
      const settings = await invoke<any>('get_settings').catch(() => null);
      setUserName(settings?.user_name || 'there');
      
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      toast({
        variant: "destructive",
        title: "Failed to load dashboard",
        description: "Some statistics may be unavailable"
      });
    } finally {
      if (!skipLoadingState) {
        setIsLoading(false);
      }
    }
  }, [toast, user]);

  useEffect(() => {
    // Only load dashboard data when auth loading is complete and we know the user state
    if (!loadingAuth) {
      loadDashboardData();
    }
  }, [loadingAuth, user, loadDashboardData]);

  // Listen for transcription events to refresh data
  useEffect(() => {
    let unlistenWordUsage: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        // Listen only for word usage updates (fired after transcription completes)
        unlistenWordUsage = await listen('word_usage_updated', () => {
          console.log('[HomePage] Word usage updated, refreshing data...');
          // Delay to ensure all backend processing is complete
          setTimeout(() => loadDashboardData(true), 1500); // Skip loading state
        });
      } catch (error) {
        console.error('[HomePage] Failed to setup event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      unlistenWordUsage?.();
    };
  }, [loadDashboardData]);


  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5) return 'Good night';  // 12am - 5am
    if (hour >= 5 && hour < 12) return 'Good morning';  // 5am - 12pm
    if (hour >= 12 && hour < 17) return 'Good afternoon';  // 12pm - 5pm
    if (hour >= 17 && hour < 22) return 'Good evening';  // 5pm - 10pm
    return 'Good night';  // 10pm - 12am
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const calculateTimeSaved = (totalWords: number): { time: string; unit: string } => {
    // Average typing speed: 50 WPM, Average speaking speed: 130 WPM
    const typingMinutes = totalWords / 50;
    const speakingMinutes = totalWords / 130;
    const savedMinutes = typingMinutes - speakingMinutes;
    
    if (savedMinutes < 60) {
      return { time: Math.round(savedMinutes).toString(), unit: savedMinutes === 1 ? 'minute' : 'minutes' };
    } else if (savedMinutes < 1440) { // Less than 24 hours
      const hours = Math.round(savedMinutes / 60);
      return { time: hours.toString(), unit: hours === 1 ? 'hour' : 'hours' };
    } else {
      const days = Math.round(savedMinutes / 1440);
      return { time: days.toString(), unit: days === 1 ? 'day' : 'days' };
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        toast({
          title: "Copied!",
          description: "Text copied to clipboard.",
        });
      })
      .catch(err => {
        console.error("Failed to copy text:", err);
        toast({
          variant: "destructive",
          title: "Copy Failed",
          description: "Could not copy text to clipboard.",
        });
      });
  };

  if (isLoading || loadingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0b0719]">
        <Loader2 className="h-8 w-8 animate-spin text-[#87CEFA]" />
      </div>
    );
  }

  // Show logged-out state if user is not authenticated
  if (!user) {
    return <LoggedOutState page="home" />;
  }

  return (
    <TooltipProvider>
      <div className="h-full overflow-hidden bg-[#0b0719]">
        <div className="h-full flex flex-col p-8">
          <div className="max-w-7xl mx-auto w-full flex flex-col h-full">
          {/* Header */}
          <div className="mb-6 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold text-white mb-2">
                  {getGreeting()}, {userName}
                </h1>
                <p className="text-neutral-400">
                  Hold down <span className="text-neutral-300">fn</span> and speak into any textbox
                </p>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 flex-shrink-0">
          {/* Daily Streak Card */}
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium text-neutral-400">
                  Daily streak
                </CardTitle>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-neutral-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Consecutive days with at least one transcription (UTC timezone). Resets if you miss a day. New day starts at midnight UTC.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Zap className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {stats?.daily_streak || 0} {stats?.daily_streak === 1 ? 'day' : 'days'}
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {(stats?.daily_streak ?? 0) >= 30 ? 'Incredible! 30+ day streak! 🔥' : 
                 (stats?.daily_streak ?? 0) >= 7 ? 'Great job! Keep it going!' :
                 (stats?.daily_streak ?? 0) === 0 ? 'Start your streak today!' :
                 'You are off to a great start!'}
              </p>
            </CardContent>
          </Card>

          {/* Total Words Card */}
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium text-neutral-400">
                  Total words dictated
                </CardTitle>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-neutral-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>All words you've transcribed using Fethr</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {formatNumber(stats?.total_words || 0)} 
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {stats?.today_words ? `${stats.today_words} words today` : 'Start speaking to track today\'s progress'}
              </p>
            </CardContent>
          </Card>

          {/* Time Saved Card */}
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium text-neutral-400">
                  Time saved
                </CardTitle>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-neutral-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Estimated time saved by speaking (130 WPM) instead of typing (50 WPM)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Clock className="h-4 w-4 text-[#87CEFA]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {calculateTimeSaved(stats?.total_words || 0).time} {calculateTimeSaved(stats?.total_words || 0).unit}
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Speaking is 2.6x faster than typing
              </p>
            </CardContent>
          </Card>
        </div>

          {/* Two Column Layout - Fill remaining height */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden">
            {/* Recent Activity */}
            <Card className="bg-neutral-900/50 border-neutral-800 flex flex-col overflow-hidden">
              <CardHeader className="flex-shrink-0">
                <CardTitle className="text-lg font-medium text-white">
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-6">
                <ScrollArea className="h-full pr-2">
                  <div className="space-y-3">
                  {stats?.recent_transcriptions.length === 0 ? (
                    <p className="text-neutral-500 text-sm">No transcriptions yet. Start speaking!</p>
                  ) : (
                    stats?.recent_transcriptions.map((entry, index) => (
                      <div key={index} className="group relative flex flex-col space-y-1 p-3 bg-neutral-800/50 rounded-md hover:bg-neutral-800/70 transition-colors">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-neutral-500">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-neutral-600">
                              {entry.text.split(/\s+/).length} words
                            </span>
                            <button
                              onClick={() => copyToClipboard(entry.text)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-neutral-700/50 rounded"
                              title="Copy text"
                            >
                              <Copy className="h-3 w-3 text-neutral-400" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-neutral-300 line-clamp-2">
                          {entry.text}
                        </p>
                      </div>
                    ))
                  )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Insights Card */}
            <Card className="bg-gradient-to-br from-[#8A2BE2]/10 to-[#DA70D6]/10 border-[#8A2BE2]/20 flex flex-col overflow-hidden">
              <CardHeader className="flex-shrink-0">
                <CardTitle className="text-lg font-medium text-white">
                  Your Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-6">
                <ScrollArea className="h-full">
                  <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Clock className="h-5 w-5 text-[#ADC2FF]" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-neutral-300">Most productive hour</p>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-neutral-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>The hour of day when you've made the most transcriptions historically (based on all-time data in UTC timezone)</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-neutral-500">
                      {stats?.most_active_hour !== null && stats?.most_active_hour !== undefined 
                        ? `${stats.most_active_hour}:00 - ${stats.most_active_hour + 1}:00`
                        : 'Keep using Fethr to discover your peak hours'}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="pt-2 border-t border-neutral-800">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm text-neutral-300">Average transcription length</p>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-neutral-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Average number of words per transcription (total words ÷ total transcriptions)</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-2xl font-semibold text-white">
                  {stats?.average_words_per_session && stats.average_words_per_session > 0 
                    ? `${stats.average_words_per_session} words`
                    : '—'}
                </p>
              </div>

                  <div className="pt-2 border-t border-neutral-800">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm text-neutral-300">Total transcriptions</p>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-neutral-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Total number of voice recordings you've made</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-2xl font-semibold text-white">
                      {stats?.total_transcriptions && stats.total_transcriptions > 0 
                        ? stats.total_transcriptions
                        : '0'}
                    </p>
                  </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

export default HomePage;