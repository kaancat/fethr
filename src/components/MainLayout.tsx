import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, BookOpen, Clock, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MainLayoutProps {
  children: React.ReactNode;
}

function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/dictionary', label: 'Dictionary', icon: BookOpen },
    { path: '/history', label: 'History', icon: Clock },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-gradient-to-br from-[#0A0F1A] to-[#020409]">
      {/* Sidebar */}
      <div className="w-48 flex-shrink-0 border-r border-[#A6F6FF]/10 px-4 py-6 relative">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-white">fethr</h1>
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
                    ? 'bg-[#A6F6FF]/10 text-white'
                    : 'text-gray-400 hover:bg-[#A6F6FF]/5 hover:text-gray-200'
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