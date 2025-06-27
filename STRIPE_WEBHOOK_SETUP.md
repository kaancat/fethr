# Stripe Webhook Setup Guide

## Overview
This guide will help you set up the Stripe webhook to handle subscription updates in your Fethr app.

## Prerequisites
- Supabase CLI installed (`npm install -g supabase`)
- Access to your Stripe dashboard
- Access to your Supabase project

## Step 1: Deploy the Edge Function

1. First, login to Supabase CLI:
```bash
supabase login
```

2. Link your project:
```bash
supabase link --project-ref dttwcuqlnfpsbkketppf
```

3. Set the required environment variables in your Supabase dashboard:
   - Go to https://app.supabase.com/project/dttwcuqlnfpsbkketppf/settings/vault
   - Add these secrets:
     - `STRIPE_SECRET_KEY`: Your Stripe secret key (sk_live_51Rb563BuRI2wQm3r...)
     - `STRIPE_WEBHOOK_SECRET`: You'll get this from Stripe after creating the webhook

4. Deploy the edge function:
```bash
cd supabase/functions
supabase functions deploy stripe-webhook --no-verify-jwt
```

## Step 2: Create Webhook in Stripe

1. Go to your Stripe Dashboard: https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Set the endpoint URL to:
   ```
   https://dttwcuqlnfpsbkketppf.supabase.co/functions/v1/stripe-webhook
   ```
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click "Add endpoint"
6. Copy the "Signing secret" (starts with `whsec_`)
7. Add this as `STRIPE_WEBHOOK_SECRET` in Supabase Vault

## Step 3: Test the Webhook

1. In Stripe Dashboard, go to your webhook endpoint
2. Click "Send test webhook"
3. Select `checkout.session.completed`
4. Check the Supabase Function logs:
   ```bash
   supabase functions logs stripe-webhook
   ```

## Step 4: Update Frontend for Real-time Updates

The webhook is now set up to update your database when:
- A user completes checkout
- A subscription is created/updated
- A subscription is cancelled

## Troubleshooting

### Common Issues:

1. **Webhook signature verification failed**
   - Make sure the `STRIPE_WEBHOOK_SECRET` in Supabase matches the one from Stripe

2. **Function not found**
   - Ensure the function was deployed successfully
   - Check the function URL is correct

3. **Database updates not working**
   - Check that your database tables have the correct schema
   - Verify the service role key has proper permissions

### Useful Commands:

```bash
# View function logs
supabase functions logs stripe-webhook --tail

# Redeploy function
supabase functions deploy stripe-webhook --no-verify-jwt

# Test locally (optional)
supabase functions serve stripe-webhook --no-verify-jwt
```

## Next Steps

After the webhook is working:
1. Test a real subscription purchase
2. Implement real-time subscription updates in the frontend
3. Add subscription management UI for users to cancel/modify subscriptions