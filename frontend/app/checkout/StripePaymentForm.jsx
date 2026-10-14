'use client';

import React, { useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import styles from './checkout.module.css';
import { getStoredAuth } from '../../utils/auth';

/**
 * Inner Form that utilizes useStripe and useElements hooks
 */
function InnerStripeCheckoutForm({
  clientSecret,
  amount,
  customer,
  onPaymentSuccess,
  onBackToCustomerInfo,
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [isElementLoaded, setIsElementLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent submission if Stripe.js has not yet loaded, element isn't ready, or currently processing
    if (!stripe || !elements || !isElementLoaded || isProcessing) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // 1. Submit the Elements to validate customer inputs and prepare payment data
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setErrorMessage(submitError.message || 'Please check your payment information.');
        setIsProcessing(false);
        return;
      }

      // 2. Confirm the PaymentIntent with the entered payment details
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${typeof window !== 'undefined' ? window.location.origin : ''}/checkout`,
          payment_method_data: {
            billing_details: {
              name: customer?.fullName || 'Customer',
              email: customer?.email || undefined,
              phone: customer?.phone || undefined,
              address: {
                line1: customer?.shippingAddress?.address || undefined,
                city: customer?.shippingAddress?.city || undefined,
                state: customer?.shippingAddress?.state || undefined,
                postal_code: customer?.shippingAddress?.postalCode || undefined,
                country: 'US',
              },
            },
          },
        },
      });

      if (error) {
        // Show error from Stripe (e.g. card declined, expired card, insufficient funds)
        if (error.type === 'card_error' || error.type === 'validation_error') {
          setErrorMessage(error.message);
        } else {
          setErrorMessage(error.message || 'An unexpected payment error occurred. Please try again.');
        }
        setIsProcessing(false);
        return;
      }

      if (paymentIntent) {
        if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
          let confirmedOrder = null;
          // Server-side confirmation: verify with Stripe API, update order & deduct stock
          try {
            const token = typeof window !== 'undefined' ? getStoredAuth().token : null;
            const headers = { 'Content-Type': 'application/json' };
            if (token) {
              headers['Authorization'] = `Bearer ${token}`;
            }

            const confirmRes = await fetch('/api/payments/confirm-payment', {
              method: 'POST',
              headers,
              body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
            });
            const confirmData = await confirmRes.json();
            if (!confirmRes.ok || !confirmData.success) {
              console.warn('Server-side payment confirmation warning:', confirmData.message);
              // Payment succeeded on Stripe side, proceed even if backend confirm had issues
              // The webhook / auto-sync will handle it as a fallback
            } else {
              console.log('Server-side payment confirmed:', confirmData.message);
              confirmedOrder = confirmData.order;
            }
          } catch (confirmErr) {
            console.warn('Server-side confirm-payment call failed:', confirmErr.message);
            // Non-blocking: payment is already successful with Stripe
          }

          // Hand off to success state
          onPaymentSuccess(paymentIntent, confirmedOrder);
        } else {
          setErrorMessage(`Payment status: ${paymentIntent.status}. Please try again or check your payment method.`);
          setIsProcessing(false);
        }
      }
    } catch (err) {
      console.error('Stripe confirm payment error:', err);
      setErrorMessage(err.message || 'An error occurred while confirming payment.');
      setIsProcessing(false);
    }
  };

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (!isElementLoaded && !errorMessage) {
        setErrorMessage(
          'Stripe payment fields took too long to load. This occurs when the Publishable Key does not match the Secret Key account (e.g. Test vs Live mode mismatch). Please check that your Stripe keys belong to the same Stripe account in Test mode.'
        );
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [isElementLoaded, errorMessage]);

  return (
    <form onSubmit={handleSubmit} className={styles.stripeSection}>
      <div className={styles.stripeHeader}>
        <div className={styles.stripeHeaderTitle}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
            <line x1="1" y1="10" x2="23" y2="10"></line>
          </svg>
          <span>Payment Details</span>
        </div>

        <button
          type="button"
          onClick={onBackToCustomerInfo}
          className={styles.backToInfoBtn}
          disabled={isProcessing}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Edit Shipping Info</span>
        </button>
      </div>

      {/* Verified Order Summary Banner */}
      <div className={styles.stripeSummaryBanner}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#64748b' }}>Paying To:</span>
          <strong style={{ color: '#0f172a' }}>Buyora Inc.</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#64748b' }}>Recipient / Delivery:</span>
          <span style={{ color: '#334155', fontWeight: 600 }}>
            {customer?.fullName} ({customer?.shippingAddress?.city}, {customer?.shippingAddress?.state})
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            borderTop: '1px dashed #cbd5e1',
            paddingTop: '8px',
            marginTop: '4px',
          }}
        >
          <span style={{ fontWeight: 700, color: '#0f172a' }}>Server-Verified Amount:</span>
          <span style={{ fontSize: '20px', fontWeight: 800, color: '#2563eb' }}>
            ₹{Number(amount || 0).toFixed(2)} INR
          </span>
        </div>
      </div>

      {/* Stripe Payment Element (Official recommended UI) */}
      <div className={styles.elementsContainer}>
        {!isElementLoaded && !errorMessage && (
          <div style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontSize: '14px', fontWeight: 600 }}>
            <div className={styles.spinner} style={{ margin: '0 auto 12px auto' }}></div>
            <span>Loading secure payment fields...</span>
          </div>
        )}
        <PaymentElement
          options={{
            layout: 'tabs',
            paymentMethodOrder: ['card'],
            wallets: {
              link: 'never',
              applePay: 'never',
              googlePay: 'never',
            },
          }}
          onReady={() => setIsElementLoaded(true)}
          onLoadError={(event) => {
            console.error('Stripe PaymentElement onLoadError:', event);
            setIsElementLoaded(false);
            setErrorMessage(
              event?.error?.message ||
                'Unable to initialize Stripe payment fields. The Stripe Publishable Key and Secret Key must belong to the same Stripe account in Test mode.'
            );
          }}
          onChange={(event) => {
            if (event.complete) {
              setErrorMessage(null);
            }
          }}
        />
      </div>

      {/* Error Message Alert */}
      {errorMessage && (
        <div className={styles.paymentErrorBox}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#dc2626"
            strokeWidth="2.2"
            style={{ flexShrink: 0, marginTop: '1px' }}
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <strong>Payment Failed:</strong> {errorMessage}
          </div>
        </div>
      )}

      {/* Pay Now Submit Button */}
      <button
        type="submit"
        disabled={!stripe || !elements || !isElementLoaded || isProcessing}
        className={styles.payButton}
      >
        {isProcessing ? (
          <>
            <div className={styles.spinner}></div>
            <span>Authorizing Payment...</span>
          </>
        ) : !isElementLoaded ? (
          <span>Loading Payment Form...</span>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>Pay ₹{Number(amount || 0).toFixed(2)} INR</span>
          </>
        )}
      </button>

      {/* Security Assurance */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: '#64748b',
          fontSize: '12px',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        <span>End-to-end encrypted with Stripe Payment Elements (PCI-DSS Level 1)</span>
      </div>
    </form>
  );
}

/**
 * Stripe Elements Wrapper Component
 */
export default function StripePaymentForm({
  stripePromise,
  clientSecret,
  amount,
  customer,
  onPaymentSuccess,
  onBackToCustomerInfo,
}) {
  if (!stripePromise || !clientSecret) {
    return (
      <div className={styles.stripeSection}>
        <div className={styles.paymentErrorBox}>
          <div>
            <strong>Stripe Configuration Note:</strong>
            <p style={{ margin: '6px 0 0 0', fontSize: '13px' }}>
              Stripe Publishable Key or Client Secret was not provided. Please ensure{' '}
              <code>STRIPE_SECRET_KEY</code> is set in the backend <code>.env</code> and{' '}
              <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> is set in <code>frontend/.env.local</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const options = {
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#2563eb',
        colorBackground: '#ffffff',
        colorText: '#0f172a',
        colorDanger: '#ef4444',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        borderRadius: '8px',
      },
    },
  };

  return (
    <Elements key={clientSecret} stripe={stripePromise} options={options}>
      <InnerStripeCheckoutForm
        clientSecret={clientSecret}
        amount={amount}
        customer={customer}
        onPaymentSuccess={onPaymentSuccess}
        onBackToCustomerInfo={onBackToCustomerInfo}
      />
    </Elements>
  );
}
