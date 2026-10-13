import { loadStripe } from '@stripe/stripe-js';

/**
 * Stripe.js Client Loader
 *
 * Uses the Stripe Publishable Key only.
 * The Secret Key is NEVER exposed or used on the frontend.
 */
let stripePromise = null;

export const getStripe = (customPublishableKey) => {
  const key =
    customPublishableKey ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    '';

  if (!key || key.includes('placeholder')) {
    return null;
  }

  if (!stripePromise) {
    stripePromise = loadStripe(key);
  }

  return stripePromise;
};
