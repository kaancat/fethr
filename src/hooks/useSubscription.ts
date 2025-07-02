import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { listen } from '@tauri-apps/api/event';
import { getValidSession, isAuthError } from '@/utils/supabaseAuth';

interface Subscription {
    id: string;
    user_id: string;
    status: 'active' | 'inactive' | 'trialing' | 'past_due' | 'canceled';
    price_id: string;
    word_usage_this_period: number;
    word_limit_this_period: number;
    current_period_start: string;
    current_period_end: string;
    stripe_subscription_id?: string;
    stripe_customer_id?: string;
}

interface UseSubscriptionReturn {
    subscription: Subscription | null;
    loading: boolean;
    error: Error | null;
    wordUsage: number;
    wordLimit: number;
    isUnlimited: boolean;
    hasActiveSubscription: boolean;
    refetch: () => Promise<void>;
}

export function useSubscription(userId: string | undefined): UseSubscriptionReturn {
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [realtimeChannel, setRealtimeChannel] = useState<RealtimeChannel | null>(null);

    const fetchSubscription = async () => {
        if (!userId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            
            // Ensure we have a valid session before making the request
            const session = await getValidSession();
            if (!session) {
                throw new Error('No valid session available');
            }
            
            const { data, error: fetchError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (fetchError) {
                // Handle specific error cases
                if (fetchError.code === 'PGRST116') {
                    // No subscription found - this is okay for free users
                    console.log('[Subscription] No subscription found for user - likely free tier');
                    setSubscription(null);
                    setError(null);
                    return;
                }
                throw fetchError;
            }

            setSubscription(data);
            setError(null);
        } catch (err: any) {
            console.error('Error fetching subscription:', err);
            
            // Don't treat auth errors as subscription errors
            if (isAuthError(err)) {
                console.log('[Subscription] Auth error - session may have expired');
                setError(null); // Don't show error for auth issues
            } else {
                setError(err as Error);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!userId) return;

        // Initial fetch
        fetchSubscription();

        // Set up real-time subscription
        const channel = supabase
            .channel(`subscription-changes-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'subscriptions',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => {
                    console.log('Subscription change detected:', payload);
                    
                    if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
                        setSubscription(payload.new as Subscription);
                    } else if (payload.eventType === 'DELETE') {
                        setSubscription(null);
                    }
                }
            )
            .subscribe();

        setRealtimeChannel(channel);

        // Listen for subscription update events (e.g., from payment success)
        const subscriptionUpdateListener = listen('subscription-updated', (event) => {
            console.log('🔄 Subscription update event received:', event);
            const payload = event.payload as { userId: string };
            if (payload.userId === userId) {
                console.log('✅ Refetching subscription data due to update event');
                fetchSubscription();
            }
        });

        // Cleanup
        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
            subscriptionUpdateListener.then(unlisten => unlisten());
        };
    }, [userId]);

    // Computed values with safe defaults
    const wordUsage = subscription?.word_usage_this_period || 0;
    const wordLimit = subscription?.word_limit_this_period || 1500; // Default free tier limit
    const isUnlimited = wordLimit > 900000000; // Consider > 900M as unlimited
    const hasActiveSubscription = subscription?.status === 'active' || subscription?.status === 'trialing' || false;

    return {
        subscription,
        loading,
        error,
        wordUsage,
        wordLimit,
        isUnlimited,
        hasActiveSubscription,
        refetch: fetchSubscription
    };
}