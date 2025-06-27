// Supabase Edge Function for handling Stripe webhooks
// Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno';

// Initialize Stripe with your secret key
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

// Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Webhook secret for verifying Stripe signatures
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  
  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    
    // Verify the webhook signature
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );

    console.log(`Processing webhook event: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionChange(subscription);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(
      `Webhook Error: ${err.message}`,
      { status: 400 }
    );
  }
});

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log('Processing checkout.session.completed:', session.id);
  
  // Get user ID from client_reference_id or metadata
  const userId = session.client_reference_id || session.metadata?.user_id;
  
  if (!userId) {
    console.error('No user ID found in session');
    return;
  }

  // Get the subscription ID from the session
  const subscriptionId = session.subscription as string;
  
  if (subscriptionId) {
    // Retrieve the full subscription details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Update the subscription in our database
    const priceId = subscription.items.data[0]?.price.id;
    
    if (priceId) {
      // Get the price details from our database
      const { data: priceData, error: priceError } = await supabase
        .from('prices')
        .select('metadata')
        .eq('id', priceId)
        .single();
      
      if (priceError) {
        console.error('Error fetching price:', priceError);
        return;
      }
      
      const wordLimit = priceData?.metadata?.word_limit || 999000000; // Default to "unlimited"
      
      // Update subscription in database
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          price_id: priceId,
          word_limit_this_period: wordLimit,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: session.customer as string,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
      
      if (updateError) {
        console.error('Error updating subscription:', updateError);
      } else {
        console.log(`Successfully activated Pro subscription for user ${userId}`);
      }
    }
  }
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  console.log('Processing subscription change:', subscription.id);
  
  // Find the user by stripe_subscription_id
  const { data: existingSub, error: findError } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();
  
  if (findError || !existingSub) {
    console.error('Could not find subscription in database');
    return;
  }
  
  const priceId = subscription.items.data[0]?.price.id;
  
  // Get the price details
  const { data: priceData, error: priceError } = await supabase
    .from('prices')
    .select('metadata')
    .eq('id', priceId)
    .single();
  
  if (priceError) {
    console.error('Error fetching price:', priceError);
    return;
  }
  
  const wordLimit = priceData?.metadata?.word_limit || 999000000;
  
  // Update subscription
  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      price_id: priceId,
      word_limit_this_period: wordLimit,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscription.id);
  
  if (updateError) {
    console.error('Error updating subscription:', updateError);
  } else {
    console.log(`Successfully updated subscription ${subscription.id}`);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('Processing subscription deletion:', subscription.id);
  
  // Find and update the subscription to inactive
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'inactive',
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscription.id);
  
  if (error) {
    console.error('Error deactivating subscription:', error);
  } else {
    console.log(`Successfully deactivated subscription ${subscription.id}`);
  }
}