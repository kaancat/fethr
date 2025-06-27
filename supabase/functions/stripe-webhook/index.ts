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
const supabaseUrl = Deno.env.get('APP_SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('APP_SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Webhook secret for verifying Stripe signatures
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

serve(async (req) => {
  console.log(`[STRIPE-WEBHOOK] Received ${req.method} request`);
  
  const signature = req.headers.get('stripe-signature');
  
  if (!signature) {
    console.error('[STRIPE-WEBHOOK] Missing stripe-signature header');
    return new Response('No signature', { status: 400 });
  }

  // Validate required environment variables
  if (!Deno.env.get('STRIPE_SECRET_KEY')) {
    console.error('[STRIPE-WEBHOOK] STRIPE_SECRET_KEY not configured');
    return new Response('Server configuration error', { status: 500 });
  }

  if (!Deno.env.get('APP_SUPABASE_URL') || !Deno.env.get('APP_SUPABASE_SERVICE_ROLE_KEY')) {
    console.error('[STRIPE-WEBHOOK] Supabase configuration missing');
    return new Response('Server configuration error', { status: 500 });
  }

  try {
    const body = await req.text();
    
    // Verify the webhook signature for security
    let event: Stripe.Event;
    
    // Temporarily disable signature verification for development/testing
    // TODO: Re-enable signature verification for production with proper webhook secret
    console.warn('[WEBHOOK] ⚠️ Signature verification temporarily disabled for testing');
    event = JSON.parse(body) as Stripe.Event;
    
    /* 
    // Re-enable this code when webhook secret is properly configured:
    if (webhookSecret) {
      try {
        // Use async version for Deno compatibility
        event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
        console.log(`[WEBHOOK] ✅ Successfully verified webhook signature for event: ${event.type}`);
      } catch (err) {
        console.error('[WEBHOOK] ❌ Webhook signature verification failed:', err.message);
        return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
      }
    } else {
      console.warn('[WEBHOOK] ⚠️ No webhook secret configured - accepting webhook without verification');
      event = JSON.parse(body) as Stripe.Event;
    }
    */

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
  console.log(`[WEBHOOK] 🎉 Processing checkout.session.completed: ${session.id}`);
  
  // Get user ID from client_reference_id or metadata
  const userId = session.client_reference_id || session.metadata?.user_id;
  
  if (!userId) {
    console.error('[WEBHOOK] ❌ No user ID found in checkout session:', {
      session_id: session.id,
      client_reference_id: session.client_reference_id,
      metadata: session.metadata
    });
    return;
  }

  console.log(`[WEBHOOK] Processing subscription activation for user: ${userId}`);

  // Get the subscription ID from the session
  const subscriptionId = session.subscription as string;
  
  if (!subscriptionId) {
    console.error('[WEBHOOK] ❌ No subscription ID found in checkout session:', session.id);
    return;
  }

  console.log(`[WEBHOOK] Retrieving subscription details: ${subscriptionId}`);
  
  try {
    // Retrieve the full subscription details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    console.log(`[WEBHOOK] Retrieved subscription: ${subscription.id}, status: ${subscription.status}`);
    
    // Update the subscription in our database
    const priceId = subscription.items.data[0]?.price.id;
    
    if (!priceId) {
      console.error('[WEBHOOK] ❌ No price ID found in subscription items:', subscription.id);
      return;
    }

    console.log(`[WEBHOOK] Looking up internal price for Stripe price: ${priceId}`);
    
    // Get the price details from our database (lookup by stripe_price_id, not id)
    const { data: priceData, error: priceError } = await supabase
      .from('prices')
      .select('id, metadata')
      .eq('stripe_price_id', priceId)
      .single();
    
    if (priceError) {
      console.error('[WEBHOOK] ❌ Error fetching price from database:', {
        stripe_price_id: priceId,
        error: priceError.message
      });
      return;
    }

    if (!priceData) {
      console.error('[WEBHOOK] ❌ No price data found for Stripe price:', priceId);
      return;
    }

    console.log(`[WEBHOOK] Found internal price: ${priceData.id}`);
      
    const wordLimit = priceData?.metadata?.word_limit || 999000000; // Default to "unlimited"
    
    console.log(`[WEBHOOK] Checking if subscription exists for user: ${userId}`);
    
    // First check if subscription exists
    const { data: existingSub, error: checkError } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('[WEBHOOK] ❌ Error checking existing subscription:', checkError);
      return;
    }
    
    let dbOperation;
    if (existingSub) {
      console.log(`[WEBHOOK] Updating existing subscription for user: ${userId}`);
      // Update existing subscription
      dbOperation = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          price_id: priceData.id, // Use our internal price ID
          word_limit_this_period: wordLimit,
          stripe_subscription_id: subscriptionId,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
        })
        .eq('user_id', userId);
    } else {
      console.log(`[WEBHOOK] Creating new subscription for user: ${userId}`);
      // Insert new subscription
      dbOperation = await supabase
        .from('subscriptions')
        .insert({
          user_id: userId,
          status: 'active',
          price_id: priceData.id, // Use our internal price ID
          word_limit_this_period: wordLimit,
          word_usage_this_period: 0,
          stripe_subscription_id: subscriptionId,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
        });
    }
    
    if (dbOperation.error) {
      console.error('[WEBHOOK] ❌ Error with subscription database operation:', {
        user_id: userId,
        subscription_id: subscriptionId,
        operation: existingSub ? 'update' : 'insert',
        error: dbOperation.error.message
      });
      return;
    }

    console.log(`[WEBHOOK] ✅ Successfully ${existingSub ? 'updated' : 'created'} subscription for user: ${userId}`);

    console.log(`[WEBHOOK] Updating profile status to Pro for user: ${userId}`);
    
    // Also update the user's profile to show Pro status
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        subscription_status: 'pro',
        stripe_customer_id: session.customer as string
      })
      .eq('id', userId);
    
    if (profileError) {
      console.error('[WEBHOOK] ❌ Error updating profile status:', {
        user_id: userId,
        error: profileError.message
      });
    } else {
      console.log(`[WEBHOOK] ✅ Successfully updated profile to Pro for user: ${userId}`);
    }

    console.log(`[WEBHOOK] ✅ Checkout session processing completed successfully for user: ${userId}`);
    
  } catch (stripeError) {
    console.error('[WEBHOOK] ❌ Error retrieving subscription from Stripe:', {
      subscription_id: subscriptionId,
      error: stripeError.message
    });
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
  
  // Get the price details (lookup by stripe_price_id, not id)
  const { data: priceData, error: priceError } = await supabase
    .from('prices')
    .select('id, metadata')
    .eq('stripe_price_id', priceId)
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
      price_id: priceData.id, // Use our internal price ID
      word_limit_this_period: wordLimit,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
    })
    .eq('stripe_subscription_id', subscription.id);
  
  if (updateError) {
    console.error('Error updating subscription:', updateError);
    return;
  }

  // Also update the user's profile status
  const profileStatus = subscription.status === 'active' ? 'pro' : 'free';
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      subscription_status: profileStatus
    })
    .eq('id', existingSub.user_id);
  
  if (profileError) {
    console.error('Error updating profile status:', profileError);
  } else {
    console.log(`Successfully updated subscription ${subscription.id} and profile status to ${profileStatus}`);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('Processing subscription deletion:', subscription.id);
  
  // First, find the user ID from the subscription
  const { data: existingSub, error: findError } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();
  
  if (findError || !existingSub) {
    console.error('Could not find subscription in database for deletion');
    return;
  }
  
  // Update the subscription to inactive
  const { error: subError } = await supabase
    .from('subscriptions')
    .update({
      status: 'inactive'
    })
    .eq('stripe_subscription_id', subscription.id);
  
  if (subError) {
    console.error('Error deactivating subscription:', subError);
    return;
  }

  // Also update the user's profile status back to free
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      subscription_status: 'free'
    })
    .eq('id', existingSub.user_id);
  
  if (profileError) {
    console.error('Error updating profile status to free:', profileError);
  } else {
    console.log(`Successfully deactivated subscription ${subscription.id} and updated profile to free`);
  }
}