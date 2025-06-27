// Supabase Edge Function for creating Stripe checkout sessions
// Deploy with: supabase functions deploy create-checkout

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno';

// Initialize Stripe
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

// Supabase client
const supabaseUrl = Deno.env.get('APP_SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('APP_SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface CheckoutRequest {
  priceId: string; // Internal price ID
}

serve(async (req) => {
  console.log(`[CREATE-CHECKOUT] ${req.method} request received from ${req.headers.get('origin')}`);
  
  // CORS headers
  if (req.method === 'OPTIONS') {
    console.log('[CREATE-CHECKOUT] Handling preflight CORS request');
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    console.warn(`[CREATE-CHECKOUT] Method ${req.method} not allowed`);
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Get user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[CREATE-CHECKOUT] No authorization header provided');
      return new Response('Missing authorization header', { status: 401 });
    }

    // Verify JWT and get user
    console.log('[CREATE-CHECKOUT] Verifying user authentication...');
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      console.error('[CREATE-CHECKOUT] Authentication failed:', userError?.message);
      return new Response('Invalid token', { status: 401 });
    }

    console.log(`[CREATE-CHECKOUT] Authenticated user: ${user.id}`);

    // Parse request body with timeout protection
    let requestBody: CheckoutRequest;
    try {
      const bodyText = await req.text();
      if (!bodyText.trim()) {
        console.error('[CREATE-CHECKOUT] Empty request body');
        return new Response('Empty request body', { status: 400 });
      }
      requestBody = JSON.parse(bodyText);
    } catch (parseError) {
      console.error('[CREATE-CHECKOUT] Failed to parse request body:', parseError);
      return new Response('Invalid JSON in request body', { status: 400 });
    }

    const { priceId } = requestBody;

    // Validate input parameters
    if (!priceId || typeof priceId !== 'string' || priceId.trim().length === 0) {
      console.error('[CREATE-CHECKOUT] Invalid priceId:', priceId);
      return new Response('Missing or invalid priceId', { status: 400 });
    }

    console.log(`[CREATE-CHECKOUT] Processing checkout request for price: ${priceId}`);

    // Validate required environment variables
    if (!Deno.env.get('STRIPE_SECRET_KEY')) {
      console.error('[CREATE-CHECKOUT] STRIPE_SECRET_KEY not configured');
      return new Response('Server configuration error', { status: 500 });
    }

    // Look up the Stripe price ID from our database
    console.log(`[CREATE-CHECKOUT] Looking up price in database: ${priceId}`);
    const { data: priceData, error: priceError } = await supabase
      .from('prices')
      .select('stripe_price_id, metadata')
      .eq('id', priceId)
      .eq('active', true)
      .single();

    if (priceError || !priceData) {
      console.error('[CREATE-CHECKOUT] Price lookup error:', priceError?.message || 'No data returned');
      return new Response(`Invalid price ID: ${priceId}`, { status: 400 });
    }

    if (!priceData.stripe_price_id) {
      console.error(`[CREATE-CHECKOUT] Price ${priceId} has no stripe_price_id configured`);
      return new Response('Price not configured for Stripe', { status: 400 });
    }

    console.log(`[CREATE-CHECKOUT] Found Stripe price ID: ${priceData.stripe_price_id}`);

    // Get origin for redirect URLs
    const origin = req.headers.get('origin') || 'http://localhost:1420';
    console.log(`[CREATE-CHECKOUT] Using origin for redirects: ${origin}`);

    // Create Stripe checkout session with timeout
    console.log('[CREATE-CHECKOUT] Creating Stripe checkout session...');
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceData.stripe_price_id,
          quantity: 1,
        },
      ],
      success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment-cancel`,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        price_id: priceId,
      },
    });

    console.log(`[CREATE-CHECKOUT] ✅ Successfully created session ${session.id} for user ${user.id}`);

    // Validate that we received a URL from Stripe
    if (!session.url) {
      console.error('[CREATE-CHECKOUT] No URL returned from Stripe session');
      return new Response('Failed to create checkout session - no URL returned', { status: 500 });
    }

    console.log(`[CREATE-CHECKOUT] ✅ Returning checkout URL to client`);
    return new Response(
      JSON.stringify({ url: session.url }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error) {
    // Enhanced error logging
    console.error('[CREATE-CHECKOUT] ❌ Unexpected error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    // Don't expose sensitive error details to client
    const errorMessage = error.message || 'Unknown error occurred';
    const safeErrorMessage = errorMessage.includes('stripe') 
      ? 'Payment service error - please try again' 
      : errorMessage;

    return new Response(
      JSON.stringify({ 
        error: safeErrorMessage,
        timestamp: new Date().toISOString() 
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});