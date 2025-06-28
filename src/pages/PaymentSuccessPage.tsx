import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { emit } from '@tauri-apps/api/event';

export default function PaymentSuccessPage() {
    const navigate = useNavigate();
    const [isVerifying, setIsVerifying] = useState(true);
    const [subscriptionStatus, setSubscriptionStatus] = useState<'active' | 'pending' | 'error'>('pending');

    useEffect(() => {
        const verifySubscription = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    navigate('/');
                    return;
                }

                // Wait longer for webhook to process (Stripe webhooks can take a few seconds)
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Check subscription status
                const { data: subscription, error } = await supabase
                    .from('subscriptions')
                    .select('status, word_limit_this_period')
                    .eq('user_id', session.user.id)
                    .single();

                if (error) {
                    console.error('Error fetching subscription:', error);
                    setSubscriptionStatus('error');
                    toast.error('Unable to verify subscription status');
                } else if (subscription && subscription.status === 'active' && subscription.word_limit_this_period > 2000) {
                    setSubscriptionStatus('active');
                    toast.success('Welcome to Fethr Pro!');
                    
                    // Emit subscription refresh events to update UI across the app
                    try {
                        await emit('subscription-updated', { userId: session.user.id });
                        await emit('word_usage_updated', { userId: session.user.id });
                        console.log('✅ Subscription refresh events emitted successfully');
                    } catch (error) {
                        console.error('❌ Failed to emit subscription events:', error);
                    }
                    
                    // Redirect to main app after 4 seconds (giving more time to see success message)
                    setTimeout(() => {
                        navigate('/');
                    }, 4000);
                } else {
                    // Subscription might still be processing
                    setSubscriptionStatus('pending');
                    
                    // Try again with longer interval (webhooks can be slow)
                    setTimeout(() => {
                        verifySubscription();
                    }, 5000);
                }
            } catch (error) {
                console.error('Error in verification:', error);
                setSubscriptionStatus('error');
            } finally {
                setIsVerifying(false);
            }
        };

        verifySubscription();
    }, [navigate]);

    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-xl p-8 text-center">
                {subscriptionStatus === 'active' ? (
                    <>
                        <CheckCircle2 className="w-20 h-20 text-green-500 mx-auto mb-4" />
                        <h1 className="text-3xl font-bold text-white mb-2">Payment Successful!</h1>
                        <p className="text-gray-300 mb-6">
                            Welcome to Fethr Pro! You now have unlimited transcriptions.
                        </p>
                        <p className="text-gray-400 text-sm">
                            Redirecting you back to the app...
                        </p>
                    </>
                ) : (
                    <>
                        <Loader2 className="w-20 h-20 text-blue-500 mx-auto mb-4 animate-spin" />
                        <h1 className="text-2xl font-bold text-white mb-2">
                            {isVerifying ? 'Processing Payment...' : 'Verifying Subscription...'}
                        </h1>
                        <p className="text-gray-300 mb-4">
                            {subscriptionStatus === 'error' 
                                ? 'There was an issue verifying your subscription. Please contact support if this persists.'
                                : 'Please wait while we activate your Pro subscription.'}
                        </p>
                        {subscriptionStatus === 'pending' && !isVerifying && (
                            <p className="text-gray-400 text-sm">
                                This may take a few moments...
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}