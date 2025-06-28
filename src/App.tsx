import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { RecordingState } from './types';
import RecordingPill from './components/RecordingPill';
import { toast } from "react-hot-toast"; // Keep react-hot-toast for now as it's still used for notifications
import { Toaster } from "@/components/ui/toaster"; // Import shadcn/ui Toaster
import { TooltipProvider } from "@/components/ui/tooltip"; // Import TooltipProvider
import HomePage from './pages/HomePage';
import DictionaryPage from './pages/DictionaryPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import PillPage from './pages/PillPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import PaymentCancelPage from './pages/PaymentCancelPage';
import MainLayout from './components/MainLayout';
import './index.css';
import { supabase } from '@/lib/supabaseClient'; // Import the Supabase client
import { Session, User } from '@supabase/supabase-js'; // Import Session and User types

// Log to confirm Supabase client module is loaded
console.log('[App.tsx] Supabase client module loaded.', supabase ? 'Instance exists.' : 'Instance MISSING.');

// Define interface for the test utility
interface FethrDragTestInterface {
    start: () => void;
    end: () => void;
}

// Extend Window interface to include our test utility
declare global {
    interface Window {
        FethrDragTest?: FethrDragTestInterface;
    }
}

// Define the structure for the state update payload from the backend
interface StateUpdatePayload {
    state: RecordingState | string; // Allow string initially for mapping
    duration_ms: number;
    transcription_result: string | null;
    error_message: string | null;
}

function App() {
  const initialPathname = window.location.pathname;
  console.log(`[App] Rendering. Initial Pathname detected: ${initialPathname}`);

  // Add State for Auth Session/User:
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true); // Track initial loading

  // Add useEffect to Listen for Auth Changes:
  useEffect(() => {
      console.log('[Auth Listener] Setting up Supabase auth listener.');
      setLoadingAuth(true);

      // Get initial session
      supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          setUser(session?.user ?? null);
          setLoadingAuth(false);
          console.log('[Auth Listener] Initial session loaded:', session ? 'Exists' : 'None');
      }).catch(error => {
           console.error('[Auth Listener] Error getting initial session:', error);
           setLoadingAuth(false);
      });

      // Set up the listener for future changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          console.log('[Auth Listener] Auth state changed. New session:', session ? 'Exists' : 'None', 'Event:', _event);
          setSession(session);
          setUser(session?.user ?? null);
          setLoadingAuth(false); // Ensure loading is set to false on changes too
      });

      // Cleanup function to unsubscribe
      return () => {
          console.log('[Auth Listener] Unsubscribing from auth changes.');
          subscription?.unsubscribe();
      };
  }, []); // Run only once on mount

  return (
    <TooltipProvider>
      <MemoryRouter initialEntries={[initialPathname]}>
        <Routes>
          {/* Main routes with layout */}
          <Route path="/" element={<MainLayout><HomePage /></MainLayout>} />
          <Route path="/dictionary" element={<MainLayout><DictionaryPage /></MainLayout>} />
          <Route path="/history" element={<MainLayout><HistoryPage /></MainLayout>} />
          <Route path="/settings" element={<MainLayout><SettingsPage user={user} loadingAuth={loadingAuth} /></MainLayout>} />
          
          {/* Routes without layout */}
          <Route path="/pill" element={<PillPage />} />
          <Route path="/payment/success" element={<PaymentSuccessPage />} />
          <Route path="/payment/cancel" element={<PaymentCancelPage />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App; 