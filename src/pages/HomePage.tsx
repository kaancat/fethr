import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, Clock, Zap, Copy } from 'lucide-react';
import type { HistoryEntry } from '../types';
import { supabase } from '@/lib/supabaseClient';

interface DashboardStats {
  total_words: number;
  total_transcriptions: number;
  weekly_streak: number;
  today_words: number;
  average_words_per_session: number;
  dictionary_size: number;
  most_active_hour: number;
  recent_transcriptions: HistoryEntry[];
}

function HomePage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userName, setUserName] = useState<string>('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      
      // Check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        // Get user statistics from Supabase
        try {
          const stats = await invoke<DashboardStats>('get_user_statistics', {
            user_id: session.user.id,
            access_token: session.access_token
          });
          setStats(stats);
        } catch (error) {
          console.error('Failed to load user statistics, falling back to local stats:', error);
          // Fall back to local stats if Supabase fails
          const localStats = await invoke<DashboardStats>('get_dashboard_stats');
          setStats(localStats);
        }
      } else {
        // Not authenticated, use local stats only
        const stats = await invoke<DashboardStats>('get_dashboard_stats');
        setStats(stats);
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
      setIsLoading(false);
    }
  };


  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#0A0F1A] to-[#020409]">
        <Loader2 className="h-8 w-8 animate-spin text-[#A6F6FF]" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-gradient-to-br from-[#0A0F1A] to-[#020409]">
      <div className="h-full flex flex-col p-8">
        <div className="max-w-7xl mx-auto w-full flex flex-col h-full">
          {/* Header */}
          <div className="mb-6 flex-shrink-0">
            <h1 className="text-3xl font-semibold text-white mb-2">
              {getGreeting()}, {userName}
            </h1>
            <p className="text-neutral-400">
              Hold down <span className="text-neutral-300">fn</span> and speak into any textbox
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 flex-shrink-0">
          {/* Weekly Streak Card */}
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-neutral-400">
                Weekly streak
              </CardTitle>
              <Zap className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {stats?.weekly_streak || 0} {stats?.weekly_streak === 1 ? 'day' : 'days'}
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {stats?.weekly_streak === 7 ? 'Perfect week! 🔥' : 'You are off to a great start!'}
              </p>
            </CardContent>
          </Card>

          {/* Total Words Card */}
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-neutral-400">
                Total words dictated
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {formatNumber(stats?.total_words || 0)} 
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {stats?.today_words || 0} words today
              </p>
            </CardContent>
          </Card>

          {/* Time Saved Card */}
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-neutral-400">
                Time saved
              </CardTitle>
              <Clock className="h-4 w-4 text-[#A6F6FF]" />
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
                <div className="h-full overflow-y-auto pr-2 space-y-3">
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
              </CardContent>
            </Card>

            {/* Insights Card */}
            <Card className="bg-gradient-to-br from-[#8B9EFF]/10 to-[#A6F6FF]/10 border-[#8B9EFF]/20 flex flex-col overflow-hidden">
              <CardHeader className="flex-shrink-0">
                <CardTitle className="text-lg font-medium text-white">
                  Your Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-6">
                <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <Clock className="h-5 w-5 text-[#ADC2FF]" />
                <div>
                  <p className="text-sm text-neutral-300">Most productive hour</p>
                  <p className="text-xs text-neutral-500">
                    {stats?.most_active_hour !== undefined 
                      ? `${stats.most_active_hour}:00 - ${stats.most_active_hour + 1}:00`
                      : 'No data yet'}
                  </p>
                </div>
              </div>
              
              <div className="pt-2 border-t border-neutral-800">
                <p className="text-sm text-neutral-300 mb-1">Average session length</p>
                <p className="text-2xl font-semibold text-white">
                  {stats?.average_words_per_session || 0} words
                </p>
              </div>

                  <div className="pt-2 border-t border-neutral-800">
                    <p className="text-sm text-neutral-300 mb-1">Total sessions</p>
                    <p className="text-2xl font-semibold text-white">
                      {stats?.total_transcriptions || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;