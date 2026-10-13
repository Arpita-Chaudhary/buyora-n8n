const Stripe = require('stripe');

/**
 * Stripe SDK Configuration
 *
 * Reads STRIPE_SECRET_KEY from environment variables.
 * Never expose STRIPE_SECRET_KEY to the client/frontend.
 */
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';

if (!stripeSecretKey) {
  console.warn('⚠️ [STRIPE CONFIG WARNING]: STRIPE_SECRET_KEY is not configured in .env.');
}

const stripe = new Stripe(stripeSecretKey || 'sk_test_placeholder', {
  apiVersion: '2026-08-26.dahlia',
});

module.exports = stripe;
