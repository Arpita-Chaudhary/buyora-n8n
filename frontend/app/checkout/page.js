'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './checkout.module.css';
import { useCart, getCart } from '../../utils/cart';
import { getStripe } from '../../utils/stripe';
import StripePaymentForm from './StripePaymentForm';
import CustomerNavbar from '../../components/CustomerNavbar';
import { getStoredAuth } from '../../utils/auth';
import { useDeliveryLocation } from '../../utils/deliveryLocation';
import CustomerLocationModal from '../../components/CustomerLocationModal';

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, isLoaded, totalCount, totalAmount, clear } = useCart();

  // Multi-step Checkout Flow: 'info' -> 'payment' -> 'success'
  const [checkoutStep, setCheckoutStep] = useState('info');

  // Authenticated customer state
  const [currentUser, setCurrentUser] = useState(null);

  // Customer delivery location & zone state
  const { address, zone, loading: zoneLoading } = useDeliveryLocation();
  const [isLocModalOpen, setIsLocModalOpen] = useState(false);

  // Stripe Client configuration state
  const [publishableKey, setPublishableKey] = useState(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  );
  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [serverOrderSummary, setServerOrderSummary] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    city: 'Mohali',
    state: 'Punjab',
    postalCode: '',
    country: 'India',
  });

  // Touched state & validation errors
  const [touched, setTouched] = useState({});
  const [formErrors, setFormErrors] = useState({});

  // Inventory & product validation state
  const [isValidatingInventory, setIsValidatingInventory] = useState(false);
  const [inventoryWarnings, setInventoryWarnings] = useState({});

  // PaymentIntent creation loading state & errors
  const [isCreatingPaymentIntent, setIsCreatingPaymentIntent] = useState(false);
  const [backendError, setBackendError] = useState(null);

  // Completed Payment details
  const [completedPayment, setCompletedPayment] = useState(null);

  // ---------------------------------------------------------------------------
  // 1. Load user profile and fetch public Stripe configuration on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    try {
      const auth = getStoredAuth();
      if (auth && auth.user) {
        const parsed = auth.user;
        setCurrentUser(parsed);
        setFormData((prev) => ({
          ...prev,
          fullName: prev.fullName || parsed.name || '',
          email: prev.email || parsed.email || '',
        }));
      }
    } catch (e) {
      // Ignore parse errors
    }

    // Safely query public backend configuration for publishableKey (never returns secret key)
    fetch('/api/payments/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.publishableKey) {
          setPublishableKey(data.publishableKey);
          const promise = getStripe(data.publishableKey);
          if (promise) setStripePromise(promise);
        } else {
          const promise = getStripe();
          if (promise) setStripePromise(promise);
        }
      })
      .catch(() => {
        const promise = getStripe();
        if (promise) setStripePromise(promise);
      });
  }, []);

  // Sync delivery address from location picker
  useEffect(() => {
    if (address) {
      setFormData((prev) => ({
        ...prev,
        address: prev.address || address.address || address.label || '',
        city: prev.city && prev.city !== 'Mohali' ? prev.city : (address.city || 'Mohali'),
        state: prev.state && prev.state !== 'Punjab' ? prev.state : (address.state || 'Punjab'),
        postalCode: prev.postalCode || address.postalCode || '',
        country: prev.country || 'India',
      }));
    }
  }, [address]);

  // Delivery fee calculation
  const deliveryCharge = useMemo(() => {
    if (zone?.serviceable && zone?.primaryZone) {
      return Number(zone.primaryZone.deliveryCharge) || 0;
    }
    return 0;
  }, [zone]);

  const grandTotal = useMemo(() => {
    return totalAmount + deliveryCharge;
  }, [totalAmount, deliveryCharge]);

  // ---------------------------------------------------------------------------
  // 2. Validate live products & inventory against backend Product API
  // ---------------------------------------------------------------------------
  const validateProductsAndStock = useCallback(async () => {
    const currentItems = getCart();
    if (!currentItems || currentItems.length === 0) return;

    setIsValidatingInventory(true);
    const warnings = {};

    try {
      const res = await fetch('/api/products?status=active');
      if (res.ok) {
        const data = await res.json();
        const activeProducts = Array.isArray(data.data) ? data.data : [];
        const activeProductMap = new Map(activeProducts.map((p) => [p._id, p]));

        currentItems.forEach((item) => {
          const liveProduct = activeProductMap.get(item._id);

          if (!liveProduct) {
            warnings[item._id] = 'This product is no longer available in store.';
          } else if (liveProduct.quantity <= 0) {
            warnings[item._id] = 'This item is currently out of stock.';
          } else if (item.quantity > liveProduct.quantity) {
            warnings[item._id] = `Requested ${item.quantity}, but only ${liveProduct.quantity} available in stock.`;
          }
        });
      }
    } catch (err) {
      console.error('Inventory verification error:', err);
    } finally {
      setInventoryWarnings(warnings);
      setIsValidatingInventory(false);
    }
  }, []);

  useEffect(() => {
    if (isLoaded && cart.length > 0 && checkoutStep === 'info') {
      validateProductsAndStock();
    }
  }, [isLoaded, cart.length, checkoutStep, validateProductsAndStock]);

  const hasInventoryIssues = useMemo(() => {
    if (Object.keys(inventoryWarnings).length > 0) return true;
    return cart.some(
      (item) =>
        item.isUnavailable ||
        (item.maxStock !== undefined && item.maxStock <= 0) ||
        (item.maxStock !== undefined && item.quantity > item.maxStock)
    );
  }, [inventoryWarnings, cart]);

  // ---------------------------------------------------------------------------
  // 3. Customer Form Validation
  // ---------------------------------------------------------------------------
  const validateField = (name, value) => {
    const val = (value || '').trim();
    switch (name) {
      case 'fullName':
        if (!val) return 'Full name is required';
        if (val.length < 2) return 'Full name must be at least 2 characters';
        return null;
      case 'email':
        if (!val) return 'Email address is required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return 'Please enter a valid email address';
        return null;
      case 'phone':
        if (!val) return 'Phone number is required';
        if (val.replace(/\D/g, '').length < 7) return 'Phone number must have at least 7 digits';
        return null;
      case 'address':
        if (!val) return 'Street address is required';
        if (val.length < 5) return 'Please enter a complete street address';
        return null;
      case 'city':
        if (!val) return 'City is required';
        return null;
      case 'state':
        if (!val) return 'State / Province is required';
        return null;
      case 'postalCode':
        if (!val) return 'Postal code is required';
        if (val.length < 3) return 'Please enter a valid postal code';
        return null;
      case 'country':
        if (!val) return 'Country is required';
        return null;
      default:
        return null;
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (touched[name]) {
      const error = validateField(name, value);
      setFormErrors((prev) => ({ ...prev, [name]: error }));
    }
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    const error = validateField(name, value);
    setFormErrors((prev) => ({ ...prev, [name]: error }));
  };

  const validateAllFields = () => {
    const errors = {};
    const fields = ['fullName', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country'];
    const markAllTouched = {};

    fields.forEach((field) => {
      markAllTouched[field] = true;
      const error = validateField(field, formData[field]);
      if (error) {
        errors[field] = error;
      }
    });

    setTouched(markAllTouched);
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ---------------------------------------------------------------------------
  // 4. Create PaymentIntent via Backend API
  // ---------------------------------------------------------------------------
  const handleProceedToPayment = async (e) => {
    e.preventDefault();
    setBackendError(null);

    // 1. Guard against empty cart
    if (cart.length === 0) {
      alert('Your cart is empty. Please add products before checking out.');
      return;
    }

    // 2. Guard against inventory issues
    if (hasInventoryIssues) {
      alert(
        'Cannot proceed: One or more products in your cart are currently out of stock, unavailable, or exceed stock limits. Please review your cart.'
      );
      return;
    }

    // 2b. Guard against unserviceable delivery zone
    if (zone && !zone.serviceable) {
      alert('Service Unreachable: Your selected delivery address is outside our delivery zones. Please select an address in Mohali, Chandigarh, or backend configured zones.');
      setIsLocModalOpen(true);
      return;
    }

    // 3. Validate customer information
    const isValid = validateAllFields();
    if (!isValid) {
      const firstErrorField = document.querySelector(`.${styles.inputError}`);
      if (firstErrorField) firstErrorField.focus();
      return;
    }

    setIsCreatingPaymentIntent(true);

    try {
      // Security: Backend receives product IDs & quantities, plus detected delivery zone & coordinates
      const payload = {
        items: cart.map((item) => ({
          productId: item._id,
          quantity: item.quantity,
        })),
        customer: {
          fullName: formData.fullName.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          shippingAddress: {
            address: formData.address.trim(),
            city: formData.city.trim(),
            state: formData.state.trim(),
            postalCode: formData.postalCode.trim(),
            country: formData.country.trim(),
          },
        },
        deliveryZone: zone?.primaryZone
          ? {
              zoneId: zone.primaryZone.id,
              name: zone.primaryZone.name,
              deliveryCharge,
              estimatedDeliveryTime: zone.primaryZone.estimatedDeliveryTime,
            }
          : null,
        latitude: address?.lat,
        longitude: address?.lng,
        currency: 'inr',
      };

      const auth = getStoredAuth();
      const headers = {
        'Content-Type': 'application/json',
      };
      if (auth && auth.token) {
        headers['Authorization'] = `Bearer ${auth.token}`;
      }

      const response = await fetch('/api/payments/create-payment-intent', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // Backend validation or Stripe error
        setBackendError(
          data.message || 'Failed to initialize payment session. Please check your cart items and try again.'
        );
        if (data.calculatedSummary) {
          setServerOrderSummary(data.calculatedSummary);
        }
        setIsCreatingPaymentIntent(false);
        return;
      }

      // Received clientSecret from backend
      setClientSecret(data.clientSecret);
      setServerOrderSummary(data.summary);

      // Advance to Stripe payment stage
      setCheckoutStep('payment');
    } catch (err) {
      console.error('Payment intent initialization error:', err);
      setBackendError(err.message || 'Unable to connect to the payment gateway. Please try again.');
    } finally {
      setIsCreatingPaymentIntent(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 5. Payment Success Handler
  // ---------------------------------------------------------------------------
  const handlePaymentSuccess = (paymentIntent, confirmedOrder) => {
    // 1. Record completed transaction reference
    // Build a customer object with nested shippingAddress to match the shape
    // expected by the success screen and StripePaymentForm
    const effectiveOrderId = confirmedOrder?.id || serverOrderSummary?.orderId || paymentIntent.id;
    setCompletedPayment({
      id: paymentIntent.id,
      orderId: effectiveOrderId,
      amount: (paymentIntent.amount / 100).toFixed(2),
      status: paymentIntent.status,
      customer: {
        fullName: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        shippingAddress: {
          address: formData.address,
          city: formData.city,
          state: formData.state,
          postalCode: formData.postalCode,
          country: formData.country,
        },
      },
      summary: serverOrderSummary || { total: totalAmount },
      timestamp: new Date().toLocaleString(),
    });

    // 2. Clear customer cart upon payment confirmation
    clear();

    // 3. Move to Payment Success State
    setCheckoutStep('success');
  };

  // ---------------------------------------------------------------------------
  // Render: Loading State
  // ---------------------------------------------------------------------------
  if (!isLoaded) {
    return (
      <div className={styles.pageContainer}>
        <div style={{ padding: '60px 24px', textAlign: 'center', color: '#64748b' }}>
          <p>Loading checkout...</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Payment Success State (Shown when payment is confirmed)
  // ---------------------------------------------------------------------------
  if (checkoutStep === 'success' && completedPayment) {
    return (
      <div className={styles.pageContainer}>
        <CustomerNavbar />

        <main className={styles.mainContainer}>
          <div className={styles.paymentSuccessCard}>
            <div className={styles.successIconLarge}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>

            <div>
              <h1 className={styles.successTitle}>Payment Successful!</h1>
              <p className={styles.successSubtitle}>
                Thank you, <strong>{completedPayment.customer.fullName}</strong>. Your payment of{' '}
                <strong>₹{completedPayment.amount} INR</strong> has been securely confirmed by Stripe.
              </p>
            </div>

            {/* Order Details & Reference Card */}
            <div className={styles.orderDetailsCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Payment Reference:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{completedPayment.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Date & Time:</span>
                <span>{completedPayment.timestamp}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Shipping Address:</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>
                  {completedPayment.customer.shippingAddress.address}, {completedPayment.customer.shippingAddress.city},{' '}
                  {completedPayment.customer.shippingAddress.state} {completedPayment.customer.shippingAddress.postalCode},{' '}
                  {completedPayment.customer.shippingAddress.country}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: '4px' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>Total Amount Paid:</span>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>
                  ₹{completedPayment.amount} INR
                </span>
              </div>
            </div>

            {/* Webhook Verification Notice */}
            <div className={styles.webhookNoticeCard}>
              <span className={styles.webhookBadge}>Architecture Note: Stripe Webhook Preparation</span>
              <p style={{ margin: 0 }}>
                <strong>Order Status: Authorized & Processing.</strong> In a production e-commerce architecture,
                the database order is officially fulfilled upon receiving the signed{' '}
                <code>payment_intent.succeeded</code> event from the Stripe Webhook listener on the backend. This
                guarantees order fulfillment occurs only when funds are fully settled.
              </p>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '14px', width: '100%', marginTop: '6px', flexWrap: 'wrap' }}>
              {completedPayment.orderId && (
                <Link
                  href={`/orders/${completedPayment.orderId}`}
                  className={styles.browseButton}
                  style={{ flex: '1 1 100%', justifyContent: 'center', background: '#059669', color: '#ffffff', fontWeight: 700 }}
                >
                  <span style={{ fontSize: '18px' }}>🛵</span>
                  <span>Track Live Delivery & Map</span>
                </Link>
              )}
              <Link href="/orders" className={styles.browseButton} style={{ flex: 1, justifyContent: 'center', background: '#2563eb' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
                <span>View My Orders</span>
              </Link>
              <Link href="/products" className={styles.browseButton} style={{ flex: 1, justifyContent: 'center', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>Continue Shopping</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Empty Cart State (If cart is empty and not on success screen)
  // ---------------------------------------------------------------------------
  if (cart.length === 0) {
    return (
      <div className={styles.pageContainer}>
        <CustomerNavbar />

        <main className={styles.mainContainer}>
          <div className={styles.emptyStateCard}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                color: '#64748b',
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
            </div>
            <h2 className={styles.emptyStateTitle}>Your Cart is Empty</h2>
            <p className={styles.emptyStateMessage}>
              You do not have any items in your cart. Add items to your cart before proceeding to checkout.
            </p>
            <Link href="/products" className={styles.browseButton}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Explore Products</span>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Protected Checkout - Authentication Required
  // ---------------------------------------------------------------------------
  if (!currentUser && !completedPayment) {
    return (
      <div className={styles.pageContainer}>
        <CustomerNavbar />
        <main className={styles.mainContainer}>
          <div className={styles.emptyStateCard} style={{ maxWidth: '520px', margin: '40px auto' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                color: '#64748b',
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h2 className={styles.emptyStateTitle}>Sign In to Checkout</h2>
            <p className={styles.emptyStateMessage}>
              Checkout is protected for authenticated customers to ensure order tracking and receipt security. Please
              sign in or register to complete your order.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
              <Link href="/login?redirect=/checkout" className={styles.browseButton} style={{ background: '#2563eb' }}>
                Sign In to Checkout
              </Link>
              <Link href="/cart" className={styles.browseButton} style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>
                Back to Cart
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Main Checkout Screen (Customer Info & Stripe Payment)
  // ---------------------------------------------------------------------------
  return (
    <div className={styles.pageContainer}>
      {/* ----------------------------------------------------------------------
          1. Storefront Navigation Bar
          ---------------------------------------------------------------------- */}
      <CustomerNavbar />

      {/* ----------------------------------------------------------------------
          2. Breadcrumbs & Multi-Step Progress
          ---------------------------------------------------------------------- */}
      <Link href="/cart" className={styles.backLink}></Link>
      {/* ----------------------------------------------------------------------
          3. Main Checkout Content
          ---------------------------------------------------------------------- */}
      <main className={styles.mainContainer}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>
            {checkoutStep === 'info' ? 'Customer Information & Shipping' : 'Secure Stripe Payment'}
          </h1>
          <p className={styles.pageSubtitle}>
            {checkoutStep === 'info'
              ? 'Please provide your shipping destination before proceeding to payment.'
              : 'Enter your payment details below to complete your order.'}
          </p>
        </div>

        {/* Global Inventory Alert Banner */}
        {hasInventoryIssues && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              color: '#991b1b',
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#dc2626"
              strokeWidth="2.2"
              style={{ flexShrink: 0, marginTop: '2px' }}
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Checkout Blocked: Inventory Issue Detected</div>
              <div style={{ fontSize: '13.5px', marginTop: '4px', lineHeight: 1.5 }}>
                One or more products in your cart are currently out of stock, unavailable, or exceed stock limits.
                Please{' '}
                <Link href="/cart" style={{ fontWeight: 700, textDecoration: 'underline', color: '#b91c1c' }}>
                  return to your cart
                </Link>{' '}
                to adjust your items.
              </div>
            </div>
          </div>
        )}

        {/* Backend / Stripe Error Alert */}
        {backendError && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              color: '#991b1b',
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#dc2626"
              strokeWidth="2.2"
              style={{ flexShrink: 0, marginTop: '2px' }}
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Payment Session Notice</div>
              <div style={{ fontSize: '13.5px', marginTop: '4px', lineHeight: 1.5 }}>{backendError}</div>
            </div>
          </div>
        )}

        <div className={styles.checkoutGrid}>
          {/* ================================================================
              LEFT COLUMN: Customer Form OR Stripe Payment Form
              ================================================================ */}
          <div>
            {checkoutStep === 'info' ? (
              <form className={styles.formCard} onSubmit={handleProceedToPayment} noValidate>
                {/* Contact Details Section */}
                <div>
                  <div className={styles.formSectionHeading}>
                    <svg
                      className={styles.sectionIcon}
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <span>Customer Information</span>
                  </div>

                  {currentUser && (
                    <div className={styles.autofillBanner} style={{ marginTop: '12px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                      <span>
                        Authenticated customer identified: <strong>{currentUser.name}</strong> ({currentUser.email})
                      </span>
                    </div>
                  )}

                  <div className={styles.formGridTwoCol} style={{ marginTop: '16px' }}>
                    <div className={styles.formGroup}>
                      <label className={styles.label} htmlFor="fullName">
                        <span>
                          Full Name <span className={styles.requiredAsterisk}>*</span>
                        </span>
                      </label>
                      <input
                        id="fullName"
                        name="fullName"
                        type="text"
                        placeholder="e.g. John Doe"
                        value={formData.fullName}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`${styles.input} ${touched.fullName && formErrors.fullName ? styles.inputError : ''
                          }`}
                        required
                      />
                      {touched.fullName && formErrors.fullName && (
                        <span className={styles.errorText}>{formErrors.fullName}</span>
                      )}
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label} htmlFor="email">
                        <span>
                          Email Address <span className={styles.requiredAsterisk}>*</span>
                        </span>
                      </label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="e.g. john@example.com"
                        value={formData.email}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`${styles.input} ${touched.email && formErrors.email ? styles.inputError : ''
                          }`}
                        required
                      />
                      {touched.email && formErrors.email && (
                        <span className={styles.errorText}>{formErrors.email}</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.formGroup} style={{ marginTop: '16px' }}>
                    <label className={styles.label} htmlFor="phone">
                      <span>
                        Phone Number <span className={styles.requiredAsterisk}>*</span>
                      </span>
                    </label>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      placeholder="e.g. +1 (555) 000-0000"
                      value={formData.phone}
                      onChange={handleInputChange}
                      onBlur={handleBlur}
                      className={`${styles.input} ${touched.phone && formErrors.phone ? styles.inputError : ''
                        }`}
                      required
                    />
                    {touched.phone && formErrors.phone && (
                      <span className={styles.errorText}>{formErrors.phone}</span>
                    )}
                  </div>
                </div>

                {/* Shipping Address Section */}
                <div>
                  <div className={styles.formSectionHeading}>
                    <svg
                      className={styles.sectionIcon}
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                    >
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span>Shipping Address</span>
                  </div>

                  <div className={styles.formGrid} style={{ marginTop: '16px' }}>
                    <div className={styles.formGroup}>
                      <label className={styles.label} htmlFor="address">
                        <span>
                          Street Address <span className={styles.requiredAsterisk}>*</span>
                        </span>
                      </label>
                      <input
                        id="address"
                        name="address"
                        type="text"
                        placeholder="e.g. 1234 Market Street, Apt 4B"
                        value={formData.address}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`${styles.input} ${touched.address && formErrors.address ? styles.inputError : ''
                          }`}
                        required
                      />
                      {touched.address && formErrors.address && (
                        <span className={styles.errorText}>{formErrors.address}</span>
                      )}
                    </div>

                    <div className={styles.formGridTwoCol}>
                      <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="city">
                          <span>
                            City <span className={styles.requiredAsterisk}>*</span>
                          </span>
                        </label>
                        <input
                          id="city"
                          name="city"
                          type="text"
                          placeholder="e.g. San Francisco"
                          value={formData.city}
                          onChange={handleInputChange}
                          onBlur={handleBlur}
                          className={`${styles.input} ${touched.city && formErrors.city ? styles.inputError : ''
                            }`}
                          required
                        />
                        {touched.city && formErrors.city && (
                          <span className={styles.errorText}>{formErrors.city}</span>
                        )}
                      </div>

                      <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="state">
                          <span>
                            State / Province <span className={styles.requiredAsterisk}>*</span>
                          </span>
                        </label>
                        <input
                          id="state"
                          name="state"
                          type="text"
                          placeholder="e.g. California"
                          value={formData.state}
                          onChange={handleInputChange}
                          onBlur={handleBlur}
                          className={`${styles.input} ${touched.state && formErrors.state ? styles.inputError : ''
                            }`}
                          required
                        />
                        {touched.state && formErrors.state && (
                          <span className={styles.errorText}>{formErrors.state}</span>
                        )}
                      </div>
                    </div>

                    <div className={styles.formGridTwoCol}>
                      <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="postalCode">
                          <span>
                            Postal / ZIP Code <span className={styles.requiredAsterisk}>*</span>
                          </span>
                        </label>
                        <input
                          id="postalCode"
                          name="postalCode"
                          type="text"
                          placeholder="e.g. 94103"
                          value={formData.postalCode}
                          onChange={handleInputChange}
                          onBlur={handleBlur}
                          className={`${styles.input} ${touched.postalCode && formErrors.postalCode ? styles.inputError : ''
                            }`}
                          required
                        />
                        {touched.postalCode && formErrors.postalCode && (
                          <span className={styles.errorText}>{formErrors.postalCode}</span>
                        )}
                      </div>

                      <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="country">
                          <span>
                            Country <span className={styles.requiredAsterisk}>*</span>
                          </span>
                        </label>
                        <select
                          id="country"
                          name="country"
                          value={formData.country}
                          onChange={handleInputChange}
                          onBlur={handleBlur}
                          className={`${styles.select} ${touched.country && formErrors.country ? styles.inputError : ''
                            }`}
                          required
                        >
                          <option value="United States">United States</option>
                          <option value="Canada">Canada</option>
                          <option value="United Kingdom">United Kingdom</option>
                          <option value="Australia">Australia</option>
                          <option value="Germany">Germany</option>
                          <option value="France">France</option>
                          <option value="India">India</option>
                          <option value="Other">Other</option>
                        </select>
                        {touched.country && formErrors.country && (
                          <span className={styles.errorText}>{formErrors.country}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  className={styles.proceedPaymentButton}
                  disabled={cart.length === 0 || hasInventoryIssues || isCreatingPaymentIntent}
                >
                  {isCreatingPaymentIntent ? (
                    <>
                      <div className={styles.spinner}></div>
                      <span>Initializing Secure Stripe Session...</span>
                    </>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                        <line x1="1" y1="10" x2="23" y2="10"></line>
                      </svg>
                      <span>Continue to Stripe Payment (₹{grandTotal.toFixed(2)})</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* Stripe Payment Form Stage */
              <StripePaymentForm
                stripePromise={stripePromise}
                clientSecret={clientSecret}
                amount={serverOrderSummary ? serverOrderSummary.total : totalAmount}
                customer={{
                  fullName: formData.fullName,
                  email: formData.email,
                  phone: formData.phone,
                  shippingAddress: {
                    address: formData.address,
                    city: formData.city,
                    state: formData.state,
                    postalCode: formData.postalCode,
                    country: formData.country,
                  },
                }}
                onPaymentSuccess={handlePaymentSuccess}
                onBackToCustomerInfo={() => setCheckoutStep('info')}
              />
            )}
          </div>

          {/* ================================================================
              RIGHT COLUMN: Order Review & Server-Calculated Summary
              ================================================================ */}
          <aside className={styles.summaryCard}>
            <div className={styles.summaryHeader}>
              <h2 className={styles.summaryTitle}>Order Summary</h2>
              {checkoutStep === 'info' && (
                <Link href="/cart" className={styles.editCartLink}>
                  Edit Cart ({totalCount})
                </Link>
              )}
            </div>

            {/* Cart Product Review List: Product Name × Quantity, Unit Price, Subtotal */}
            <div className={styles.itemsReviewList}>
              {cart.map((item) => {
                const itemSubtotal = (Number(item.price) * Number(item.quantity)).toFixed(2);
                const warningMsg = inventoryWarnings[item._id];

                return (
                  <div key={item._id} className={styles.reviewItem}>
                    <div className={styles.reviewItemMedia}>
                      {item.image || item.imageUrl ? (
                        <img
                          src={item.image || item.imageUrl}
                          alt={item.title}
                          className={styles.reviewItemImg}
                        />
                      ) : (
                        <div
                          className={styles.reviewItemImg}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#94a3b8',
                          }}
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                          </svg>
                        </div>
                      )}

                      <div className={styles.reviewItemDetails}>
                        <span className={styles.reviewItemName}>{item.title}</span>
                        <span className={styles.reviewItemQtyBadge}>
                          {item.title} × {item.quantity} (₹{Number(item.price).toFixed(2)} each)
                        </span>

                        {warningMsg && <div className={styles.itemWarningNotice}>{warningMsg}</div>}
                      </div>
                    </div>

                    <div className={styles.reviewItemSubtotal}>₹{itemSubtotal}</div>
                  </div>
                );
              })}
            </div>

            {/* Totals Breakdown */}
            <div className={styles.totalsBreakdown}>
              <div className={styles.totalsRow}>
                <span>Cart Subtotal : </span>
                <span>₹{(serverOrderSummary ? serverOrderSummary.subtotal : totalAmount).toFixed(2)}</span>
              </div>

              <div className={styles.totalsRow}>
                <span>Delivery Charge : </span>
                <span style={{ color: deliveryCharge === 0 ? '#16a34a' : '#0f172a', fontWeight: 600 }}>
                  {deliveryCharge === 0 ? 'FREE' : `₹${deliveryCharge.toFixed(2)}`}
                </span>
              </div>

              {zone?.primaryZone && (
                <div className={styles.totalsRow} style={{ fontSize: '12px', color: '#059669' }}>
                  <span>Estimated Delivery : </span>
                  <span style={{ fontWeight: 600 }}>⚡ {zone.primaryZone.estimatedDeliveryTime || '20-35 mins'}</span>
                </div>
              )}

              <div className={styles.totalsRow}>
                <span>Estimated Tax : </span>
                <span>₹0.00</span>
              </div>

              <div className={styles.grandTotalRow}>
                <span>Total Due : </span>
                <span className={styles.grandTotalValue}>
                  ₹{(serverOrderSummary ? serverOrderSummary.total : grandTotal).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Trust and Guarantee Footnote */}

          </aside>
        </div>
      </main>

    </div>
  );
}
