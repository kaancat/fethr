import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { listen } from '@tauri-apps/api/event';

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
            const { data, error: fetchError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (fetchError) throw fetchError;

            setSubscription(data);
            setError(null);
        } catch (err) {
            console.error('Error fetching subscription:', err);
            setError(err as Error);
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

    // Computed values
    const wordUsage = subscription?.word_usage_this_period || 0;
    const wordLimit = subscription?.word_limit_this_period || 0;
    const isUnlimited = wordLimit > 900000000; // Consider > 900M as unlimited
    const hasActiveSubscription = subscription?.status === 'active' || false;

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