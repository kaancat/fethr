// src/components/LoginForm.tsx
import React, { useState } from 'react';
import { supabase } from '@/lib/supabaseClient'; // Adjust path if needed
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // Ensure Input is added via shadcn cli
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast"; // Use shadcn toast

export const LoginForm: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>(''); // For feedback messages
  const { toast } = useToast();

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    console.log(`[LoginForm] Attempting login for: ${email}`);

    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      console.error('[LoginForm] Login Error:', error.message);
      // setMessage(`Login Failed: ${error.message}`); // Option 1: Show message below form
      toast({ // Option 2: Show toast
            variant: "destructive",
            title: "Login Failed",
            description: error.message || "An unexpected error occurred.",
      });
    } else {
      console.log('[LoginForm] Login successful (Auth state change listener will update UI)');
      setMessage('Login successful! Redirecting...'); // Or just let the state change handle it
      // No need to manually set user state here, the onAuthStateChange listener in App.tsx handles it.
      // Clear form maybe?
      // setEmail('');
      // setPassword('');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="email" className="text-gray-300">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@example.com"
          className="bg-[#0b0719] border border-[#8A2BE2]/30 text-white placeholder-gray-500 ring-offset-[#0b0719] focus:ring-1 focus:ring-[#8A2BE2]/50 focus:ring-offset-1"
          disabled={loading}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password" className="text-gray-300">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="••••••••"
          className="bg-[#0b0719] border border-[#8A2BE2]/30 text-white placeholder-gray-500 ring-offset-[#0b0719] focus:ring-1 focus:ring-[#8A2BE2]/50 focus:ring-offset-1"
          disabled={loading}
        />
      </div>
      {message && <p className="text-sm text-center text-red-400">{message}</p>}
      <Button type="submit" className="w-full bg-[#8A2BE2] hover:bg-[#8A2BE2]/90 text-white" disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </Button>
    </form>
  );
}; 