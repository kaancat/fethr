import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { Home, BookOpen, Clock, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { useSubscription } from '@/hooks/useSubscription';

interface MainLayoutProps {
  children: React.ReactNode;
}

function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [userId, setUserId] = useState<string | undefined>();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const { hasActiveSubscription } = useSubscription(userId);
  
  // Get user ID and auth state
  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        setIsAuthenticated(true);
      } else {
        setUserId(undefined);
        setIsAuthenticated(false);
      }
    };
    fetchUser();
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserId(session.user.id);
        setIsAuthenticated(true);
      } else {
        setUserId(undefined);
        setIsAuthenticated(false);
      }
    });
    
    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  // Navigation event listener for backend-triggered route changes
  useEffect(() => {
    console.log("[MainLayout] Setting up listener for navigate-to-route.");

    const unlistenNavigate = listen<string>('navigate-to-route', (event) => {
      console.log("[MainLayout] Received navigate-to-route event:", event.payload);
      const route = event.payload;
      
      // Validate the route is one of our known routes
      const validRoutes = ['/', '/dictionary', '/history', '/settings', '/pill'];
      if (validRoutes.includes(route)) {
        console.log("[MainLayout] Navigating to route:", route);
        navigate(route);
      } else {
        console.warn("[MainLayout] Invalid route received:", route);
      }
    });

    // Listen for navigate to history with edit
    const unlistenNavigateToHistory = listen('navigate-to-history-with-edit', () => {
      console.log("[MainLayout] Received navigate-to-history-with-edit event");
      navigate('/history');
      // Set a flag that HistoryPage can check
      window.localStorage.setItem('edit-latest-on-load', 'true');
    });

    // Cleanup function
    return () => {
      console.log("[MainLayout] Cleaning up navigation listeners.");
      unlistenNavigate.then(f => f());
      unlistenNavigateToHistory.then(f => f());
    };
  }, [navigate]);

  const menuItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/dictionary', label: 'Dictionary', icon: BookOpen },
    { path: '/history', label: 'History', icon: Clock },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-[#0b0719]">
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-[#8A2BE2]/10 px-4 py-6 relative">
        <div className="mb-8">
          <img 
            src={isAuthenticated && hasActiveSubscription ? "/assets/logos/fethr-pro-logo.png" : "/assets/logos/fethr-logo.png"} 
            alt="Fethr" 
            className="h-16 w-auto object-contain" 
          />
        </div>
        
        <nav className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || 
                           (item.path === '/settings' && location.pathname.startsWith('/settings'));
            
            return (
              <Button
                key={item.path}
                variant="ghost"
                onClick={() => navigate(item.path)}
                className={`w-full justify-start text-left px-3 py-2 rounded bg-transparent ${
                  isActive
                    ? 'bg-[#8A2BE2]/10 text-white'
                    : 'text-gray-400 hover:bg-[#8A2BE2]/5 hover:text-gray-200'
                }`}
              >
                <Icon className="mr-3 h-4 w-4" />
                {item.label}
              </Button>
            );
          })}
        </nav>
        
        {/* Footer - Version */}
        <div className="absolute bottom-4 left-4 text-xs text-gray-600">
          Version 0.1.0
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

export default MainLayout;