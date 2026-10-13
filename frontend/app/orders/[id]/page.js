'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import styles from '../orders.module.css';
import CustomerNavbar from '../../../components/CustomerNavbar';
import { getStoredAuth } from '../../../utils/auth';
import { useOrderTracking } from '../../../utils/socket';
import dynamic from 'next/dynamic';

const OrderTrackingMap = dynamic(() => import('../../../components/OrderTrackingMap'), {
  ssr: false,
});

export default function OrderDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params?.id;

  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(null);
  const [order, setOrder] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState(null); // 401, 403, 404, or 500
  const [errorMessage, setErrorMessage] = useState(null);

  // Refund Request State
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('Product is not correct / wrong item received');
  const [refundDetails, setRefundDetails] = useState('');
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);
  const [refundAlert, setRefundAlert] = useState(null); // { type: 'success' | 'error', message: '' }

  // Real-time Delivery Completion Toaster State
  const [deliveryToaster, setDeliveryToaster] = useState(null);

  // Auto-dismiss delivery toaster after 12 seconds
  useEffect(() => {
    if (deliveryToaster?.show) {
      const timer = setTimeout(() => {
        setDeliveryToaster(null);
      }, 12000);
      return () => clearTimeout(timer);
    }
  }, [deliveryToaster]);

  // 1. Fetch order details from backend (declared first to avoid TDZ ReferenceError)
  const fetchOrderDetails = useCallback(async (authToken, id) => {
    if (!id) return;
    setIsLoading(true);
    setErrorMessage(null);
    setErrorStatus(null);

    try {
      const res = await fetch(`/api/payments/orders/${id}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorStatus(res.status);
        if (res.status === 401) {
          setErrorMessage('Your session has expired. Please sign in to view this order.');
        } else if (res.status === 403) {
          setErrorMessage('Access Denied: You do not have permission to view this order. Customer orders are strictly private.');
        } else if (res.status === 404) {
          setErrorMessage('Order Not Found: The requested order could not be located.');
        } else {
          setErrorMessage(data.message || 'Failed to retrieve order details.');
        }
        setIsLoading(false);
        return;
      }

      setOrder(data.data);
    } catch (err) {
      console.error('Error fetching order details:', err);
      setErrorStatus(500);
      setErrorMessage('Network connection error. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 2. Authenticate customer and fetch order on mount / route update
  useEffect(() => {
    try {
      const auth = getStoredAuth();
      const storedToken = auth.token;
      const storedUser = auth.user;

      if (storedToken) {
        setToken(storedToken);
        if (storedUser) {
          setCurrentUser(storedUser);
        }
        if (orderId) {
          fetchOrderDetails(storedToken, orderId);
        }
      } else {
        // Customer is not logged in
        setIsLoading(false);
        setErrorStatus(401);
      }
    } catch (err) {
      console.error('Session verification error:', err);
      setIsLoading(false);
      setErrorStatus(500);
      setErrorMessage('Failed to verify session credentials.');
    }
  }, [orderId, fetchOrderDetails]);

  // Real-Time Tracking Timeline Configuration:
  // Order Placed ↓ Confirmed ↓ Preparing ↓ Out for Delivery ↓ Delivered
  const TRACKING_TIMELINE_STEPS = [
    { key: 'PLACED', label: 'Order Placed', subLabel: 'Order received and recorded', icon: '📋' },
    { key: 'CONFIRMED', label: 'Confirmed', subLabel: 'Payment verified & order accepted', icon: '✅' },
    { key: 'PREPARING', label: 'Preparing', subLabel: 'Items are being packed', icon: '👨‍🍳' },
    { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', subLabel: 'Delivery partner on the way', icon: '🚚' },
    { key: 'DELIVERED', label: 'Delivered', subLabel: 'Delivered to your doorstep', icon: '🎉' },
  ];

  const getTimelineStepIndex = (rawStatus) => {
    if (!rawStatus) return 0;
    const s = String(rawStatus).toUpperCase().trim();
    switch (s) {
      case 'PLACED':
      case 'PENDING':
        return 0;
      case 'CONFIRMED':
      case 'PAID':
        return 1;
      case 'PREPARING':
      case 'PROCESSING':
        return 2;
      case 'OUT_FOR_DELIVERY':
      case 'SHIPPED':
        return 3;
      case 'DELIVERED':
        return 4;
      case 'CANCELLED':
        return -1;
      default:
        return 0;
    }
  };

  // 3. Real-time Order Tracking via Socket.IO
  // Joins room order_<orderId>, listens for orderStatusUpdated, updates React state without reload
  const handleRealtimeOrderUpdate = useCallback((payload) => {
    console.log('[OrderDetailsPage] Live Socket.IO update received:', payload);
    const newStatus = payload?.status || payload?.orderStatus || payload?.order?.orderStatus;
    const newUpdatedAt = payload?.updatedAt || payload?.order?.updatedAt || new Date().toISOString();
    const orderObj = payload?.order || (payload?._id ? payload : null);

    // Generate celebratory Delivery Completion Toaster when order reaches DELIVERED
    if (newStatus === 'DELIVERED') {
      setDeliveryToaster({
        show: true,
        title: '🎉 Order Delivered Successfully!',
        message: 'Your order has been safely delivered to your doorstep. Thank you for shopping with us!',
        deliveredAt: newUpdatedAt,
      });
    }

    setOrder((prev) => {
      if (!prev) return orderObj || payload;
      return {
        ...prev,
        ...(orderObj || {}),
        orderStatus: newStatus || prev.orderStatus,
        updatedAt: newUpdatedAt,
        customer: orderObj?.customer || prev.customer,
        orderItems: orderObj?.orderItems || prev.orderItems,
      };
    });
  }, []);

  // Real-time Delivery Partner Location via Socket.IO: deliveryLocationUpdated
  const [liveDeliveryLocation, setLiveDeliveryLocation] = useState(null);

  // Sync initial deliveryLocation from order data if available in DB
  useEffect(() => {
    if (
      order?.deliveryLocation?.type === 'Point' &&
      Array.isArray(order.deliveryLocation.coordinates) &&
      order.deliveryLocation.coordinates.length >= 2 &&
      Math.abs(order.deliveryLocation.coordinates[0]) > 1 &&
      Math.abs(order.deliveryLocation.coordinates[1]) > 1
    ) {
      setLiveDeliveryLocation(order.deliveryLocation);
    } else if (order?.orderStatus === 'DELIVERED' && order?.deliveryCoordinates?.latitude && order?.deliveryCoordinates?.longitude) {
      setLiveDeliveryLocation({
        type: 'Point',
        coordinates: [Number(order.deliveryCoordinates.longitude), Number(order.deliveryCoordinates.latitude)],
      });
    }
  }, [order?.deliveryLocation, order?.deliveryCoordinates, order?.orderStatus]);

  // Handler invoked when Socket.IO emits deliveryLocationUpdated to room order_<orderId>
  const handleRealtimeLocationUpdate = useCallback((payload) => {
    console.log('[OrderDetailsPage] Live delivery partner location update received:', payload);
    if (payload?.location) {
      setLiveDeliveryLocation(payload.location);
    } else if (payload?.latitude !== undefined && payload?.longitude !== undefined) {
      setLiveDeliveryLocation({
        type: 'Point',
        coordinates: [Number(payload.longitude), Number(payload.latitude)],
      });
    }
  }, []);

  const { isConnected: isSocketConnected } = useOrderTracking(
    order?._id || orderId,
    handleRealtimeOrderUpdate,
    handleRealtimeLocationUpdate
  );

  // Automatic Order Delivered handler when tracking arrives at doorstep
  // Automatically transitions status to DELIVERED without requiring admin confirmation!
  const handleAutoDelivered = useCallback(
    async (deliveringOrderId) => {
      const targetId = deliveringOrderId || order?._id || orderId;
      if (!targetId) return;

      const currentStatus = String(order?.orderStatus || '').toUpperCase();
      if (currentStatus === 'DELIVERED') return;

      console.log(`[OrderDetailsPage] Auto-delivering order ${targetId}...`);

      const nowIso = new Date().toISOString();

      // 1. Immediately reflect DELIVERED in UI and trigger celebratory toaster
      setDeliveryToaster({
        show: true,
        title: '🎉 Order Delivered Successfully!',
        message: 'Your order has been safely delivered to your doorstep. Thank you for shopping with us!',
        deliveredAt: nowIso,
      });

      setOrder((prev) => (prev ? { ...prev, orderStatus: 'DELIVERED', deliveredAt: nowIso } : prev));

      // 2. Persist to MongoDB backend via API
      try {
        const auth = getStoredAuth();
        const authToken = auth?.token || token;

        const res = await fetch(`/api/payments/orders/${targetId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ status: 'DELIVERED' }),
        });

        const data = await res.json();
        if (data?.success && data?.data) {
          setOrder(data.data);
          console.log(`[OrderDetailsPage] Order ${targetId} successfully updated to DELIVERED in MongoDB!`);
        }
      } catch (err) {
        console.error('[OrderDetailsPage] Error syncing auto-delivered status to database:', err);
      }
    },
    [order?._id, order?.orderStatus, orderId, token]
  );

  // Handler for customer raising a refund request
  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    if (!order?._id || !token) return;
    setIsSubmittingRefund(true);
    setRefundAlert(null);

    try {
      const res = await fetch(`/api/payments/orders/${order._id}/refund-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: refundReason,
          details: refundDetails,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to submit refund request.');
      }

      setOrder(data.data);
      setIsRefundModalOpen(false);
      setRefundAlert({
        type: 'success',
        message: 'Refund request submitted successfully! Our administration team has received your request and will review it to issue your refund through Stripe.',
      });
    } catch (err) {
      setRefundAlert({
        type: 'error',
        message: err.message,
      });
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  // Helper for Unified Order Status badge (single status indicator)
  // Supports PLACED, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED
  const renderSingleStatusBadge = (order) => {
    const paymentStatus = order?.paymentStatus?.toLowerCase();
    const orderStatus = String(order?.orderStatus || '').toUpperCase();
    const refundStatus = order?.refundRequest?.status?.toLowerCase();

    if (paymentStatus === 'refunded') {
      return <span className={`${styles.badge} ${styles.paymentRefunded}`}>↩ Refunded via Stripe</span>;
    }
    if (refundStatus === 'requested') {
      return <span className={`${styles.badge} ${styles.paymentRefundRequested}`}>⏳ Refund Requested</span>;
    }
    if (paymentStatus === 'failed') {
      return <span className={`${styles.badge} ${styles.paymentFailed}`}>✕ Payment Failed</span>;
    }
    if (orderStatus === 'CANCELLED') {
      return <span className={`${styles.badge} ${styles.orderCancelled}`}>✕ Cancelled</span>;
    }
    if (orderStatus === 'DELIVERED') {
      return <span className={`${styles.badge} ${styles.orderDelivered}`}>✓ Delivered</span>;
    }
    if (orderStatus === 'OUT_FOR_DELIVERY' || orderStatus === 'SHIPPED') {
      return <span className={`${styles.badge} ${styles.orderShipped}`}>🚚 Out for Delivery</span>;
    }
    if (orderStatus === 'PREPARING' || orderStatus === 'PROCESSING') {
      return <span className={`${styles.badge} ${styles.paymentPaid}`}>👨‍🍳 Preparing</span>;
    }
    if (orderStatus === 'CONFIRMED') {
      return <span className={`${styles.badge} ${styles.paymentPaid}`}>✓ Confirmed</span>;
    }
    if (orderStatus === 'PLACED' || orderStatus === 'PENDING') {
      return <span className={`${styles.badge} ${styles.paymentPending}`}>📋 Order Placed</span>;
    }
    return <span className={`${styles.badge} ${styles.paymentPending}`}>📋 {orderStatus}</span>;
  };

  // Helper for Payment Status badge in Payment Summary box
  const renderPaymentBadge = (order) => {
    const status = order?.paymentStatus?.toLowerCase();
    const refundStatus = order?.refundRequest?.status?.toLowerCase();

    if (status === 'refunded') {
      return <span className={`${styles.badge} ${styles.paymentRefunded}`}>↩ Refunded via Stripe</span>;
    }
    if (refundStatus === 'requested') {
      return <span className={`${styles.badge} ${styles.paymentRefundRequested}`}>⏳ Refund Requested</span>;
    }
    switch (status) {
      case 'paid':
        return <span className={`${styles.badge} ${styles.paymentPaid}`}>● Payment Done</span>;
      case 'failed':
        return <span className={`${styles.badge} ${styles.paymentFailed}`}>✕ Payment Failed</span>;
      default:
        return <span className={`${styles.badge} ${styles.paymentPending}`}>⏳ Payment Pending</span>;
    }
  };

  // ---------------------------------------------------------------------------
  // View: Navigation Bar Header
  // ---------------------------------------------------------------------------
  const renderHeader = () => <CustomerNavbar />;

  // ---------------------------------------------------------------------------
  // View: Unauthorized State (401 - Not signed in)
  // ---------------------------------------------------------------------------
  if (!isLoading && errorStatus === 401) {
    return (
      <div className={styles.pageContainer}>
        {renderHeader()}
        <main className={styles.mainContainer}>
          <div className={styles.centerCard}>
            <div className={styles.iconCircle}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h2 className={styles.stateTitle}>Sign In Required</h2>
            <p className={styles.stateDesc}>
              Only authenticated customers can access their order details. Please log in with the account that placed
              this order.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link href={`/login?redirect=/orders/${orderId}`} className={styles.actionBtn}>
                Sign In to View Order
              </Link>
              <Link
                href="/products"
                className={styles.actionBtn}
                style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}
              >
                Browse Products
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // View: Forbidden / Cross-Customer Access Denied (403)
  // ---------------------------------------------------------------------------
  if (!isLoading && errorStatus === 403) {
    return (
      <div className={styles.pageContainer}>
        {renderHeader()}
        <main className={styles.mainContainer}>
          <div className={styles.centerCard} style={{ borderColor: '#fed7aa', background: '#fffaf5' }}>
            <div className={styles.iconCircle} style={{ background: '#ffedd5', color: '#c2410c' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              </svg>
            </div>
            <h2 className={styles.stateTitle} style={{ color: '#9a3412' }}>
              Access Denied
            </h2>
            <p className={styles.stateDesc} style={{ color: '#c2410c' }}>
              You do not have permission to access this order. Each customer can only view their own purchase records.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <Link href="/orders" className={styles.actionBtn}>
                View My Orders
              </Link>
              <Link
                href="/products"
                className={styles.actionBtn}
                style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}
              >
                Browse Products
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // View: Order Not Found (404)
  // ---------------------------------------------------------------------------
  if (!isLoading && errorStatus === 404) {
    return (
      <div className={styles.pageContainer}>
        {renderHeader()}
        <main className={styles.mainContainer}>
          <div className={styles.centerCard}>
            <div className={styles.iconCircle}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
            </div>
            <h2 className={styles.stateTitle}>Order Not Found</h2>
            <p className={styles.stateDesc}>
              We couldn&apos;t find an order matching identifier <code style={{ fontWeight: 700 }}>{orderId}</code>.
              It may have been cancelled or the link might be incorrect.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <Link href="/orders" className={styles.actionBtn}>
                Back to My Orders
              </Link>
              <Link
                href="/products"
                className={styles.actionBtn}
                style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}
              >
                Browse Products
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // View: General Error (500 or Network error)
  // ---------------------------------------------------------------------------
  if (!isLoading && errorMessage && !order) {
    return (
      <div className={styles.pageContainer}>
        {renderHeader()}
        <main className={styles.mainContainer}>
          <div className={styles.centerCard} style={{ borderColor: '#fecaca', background: '#fff5f5' }}>
            <div className={styles.iconCircle} style={{ background: '#fee2e2', color: '#dc2626' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h2 className={styles.stateTitle} style={{ color: '#991b1b' }}>
              Unable to Load Order
            </h2>
            <p className={styles.stateDesc} style={{ color: '#b91c1c' }}>
              {errorMessage}
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => fetchOrderDetails(token, orderId)}
                className={styles.actionBtn}
              >
                Try Again
              </button>
              <Link
                href="/orders"
                className={styles.actionBtn}
                style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}
              >
                Back to Orders
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // View: Loading State
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        {renderHeader()}
        <main className={styles.mainContainer}>
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div className={styles.loadingSpinner}></div>
            <p style={{ marginTop: '16px', color: '#64748b', fontSize: '15px', fontWeight: 600 }}>
              Loading your order details...
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // View: Loaded Order Details
  // ---------------------------------------------------------------------------
  const formattedDate = order?.createdAt
    ? new Date(order.createdAt).toLocaleString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'N/A';

  const orderItems = order?.orderItems || [];
  const itemsSubtotal = orderItems.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0);
  const shippingAmount = 0.0; // Free standard shipping
  const grandTotal = Number(order?.totalAmount) || itemsSubtotal;
  const currencyCode = (order?.currency || 'INR').toUpperCase();
  const customer = order?.customer || {};
  const shippingAddr = customer.shippingAddress || {};

  return (
    <div className={styles.pageContainer}>
      {renderHeader()}

      {/* Real-time Order Delivered Toaster */}
      {deliveryToaster?.show && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 99999,
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            color: '#ffffff',
            borderRadius: '16px',
            padding: '18px 22px',
            boxShadow: '0 20px 40px -10px rgba(5, 150, 105, 0.5), 0 0 20px rgba(16, 185, 129, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            maxWidth: '460px',
            border: '2px solid rgba(255, 255, 255, 0.35)',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.3s ease',
          }}
        >
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '26px',
              flexShrink: 0,
              boxShadow: '0 0 12px rgba(255, 255, 255, 0.3)',
            }}
          >
            🎉
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15.5px', fontWeight: 800, letterSpacing: '-0.01em', marginBottom: '4px' }}>
              {deliveryToaster.title}
            </div>
            <div style={{ fontSize: '13px', opacity: 0.95, lineHeight: 1.4 }}>
              {deliveryToaster.message}
            </div>
            {deliveryToaster.deliveredAt && (
              <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '5px', fontWeight: 600 }}>
                Delivered at {new Date(deliveryToaster.deliveredAt).toLocaleTimeString()}
              </div>
            )}
          </div>
          <button
            onClick={() => setDeliveryToaster(null)}
            aria-label="Close notification"
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
          >
            ✕
          </button>
        </div>
      )}

      <main className={styles.mainContainer}>
        {/* Back Link */}
        <Link href="/orders" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Back to All Orders</span>
        </Link>

        {/* Page Title & Status Header */}
        <div className={styles.pageHeader} style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h1 className={styles.pageTitle} style={{ fontSize: '26px' }}>
                Order #{order._id.substring(order._id.length - 8).toUpperCase()}
              </h1>
              <p className={styles.pageSubtitle} style={{ marginTop: '4px' }}>
                Placed on {formattedDate} • Reference ID: <code style={{ fontSize: '12.5px', color: '#475569' }}>{order._id}</code>
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Real-time Socket.IO Tracking Indicator */}
              <span
                title={
                  isSocketConnected
                    ? 'Socket.IO live connection active'
                    : 'Socket.IO disconnected. Attempting auto-reconnection in background...'
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '5px 12px',
                  borderRadius: '20px',
                  background: isSocketConnected ? '#ecfdf5' : '#fff1f2',
                  color: isSocketConnected ? '#059669' : '#e11d48',
                  border: isSocketConnected ? '1px solid #a7f3d0' : '1px solid #fecdd3',
                  transition: 'all 0.3s ease',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: isSocketConnected ? '#10b981' : '#f43f5e',
                    boxShadow: isSocketConnected
                      ? '0 0 0 2px rgba(16, 185, 129, 0.3)'
                      : '0 0 0 2px rgba(244, 63, 94, 0.3)',
                  }}
                />
                {isSocketConnected ? 'Live tracking connected' : 'Live tracking disconnected'}
              </span>

              {renderSingleStatusBadge(order)}

              {String(order?.orderStatus || '').toUpperCase() !== 'DELIVERED' &&
                String(order?.orderStatus || '').toUpperCase() !== 'CANCELLED' && (
                  <button
                    type="button"
                    onClick={() => handleAutoDelivered(order._id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '12px',
                      fontWeight: 700,
                      padding: '5px 12px',
                      borderRadius: '8px',
                      background: '#059669',
                      color: '#ffffff',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(5, 150, 105, 0.25)',
                      transition: 'all 0.2s ease',
                    }}
                    title="Click if order is already received"
                  >
                    ✓ Mark as Delivered
                  </button>
                )}
            </div>
          </div>
        </div>

        {/* Real-Time Order Tracking Timeline Component */}
        {/* Order Placed ↓ Confirmed ↓ Preparing ↓ Out for Delivery ↓ Delivered */}
        <div className={styles.timelineCard}>
          <div className={styles.timelineHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className={isSocketConnected ? styles.pulseLiveDot : styles.pulseOfflineDot} />
              <div>
                <h2 className={styles.timelineTitle}>Real-Time Order Tracking</h2>
                <p className={styles.timelineSubtitle}>
                  {isSocketConnected
                    ? `Live tracking connected • Room: order_${order._id}`
                    : 'Live tracking disconnected • Attempting auto-reconnect... Displaying last known order details.'}
                </p>
              </div>
            </div>
            {order?.updatedAt && (
              <div className={styles.timelineLastUpdated}>
                Updated: {new Date(order.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            )}
          </div>

          {/* Connection Status Fallback Notice */}
          {!isSocketConnected && (
            <div
              style={{
                margin: '12px 18px 0',
                padding: '8px 14px',
                borderRadius: '8px',
                background: '#fff1f2',
                border: '1px solid #fecdd3',
                fontSize: '12.5px',
                color: '#9f1239',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>⚠️</span>
              <span>
                <strong>Live tracking disconnected:</strong> Reconnection is being attempted in the background. Your order details and last known status are fully active below.
              </span>
            </div>
          )}

          {String(order?.orderStatus || '').toUpperCase() === 'CANCELLED' ? (
            <div className={styles.timelineCancelledNotice}>
              <div style={{ fontSize: '26px' }}>✕</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#991b1b' }}>Order Cancelled</h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#b91c1c' }}>
                  This order has been cancelled and is no longer being processed.
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.timelineFlow}>
              {TRACKING_TIMELINE_STEPS.map((step, idx) => {
                const currentIdx = getTimelineStepIndex(order?.orderStatus);
                const isCompleted = idx < currentIdx;
                const isCurrent = idx === currentIdx;
                const isUpcoming = idx > currentIdx;

                return (
                  <React.Fragment key={step.key}>
                    <div
                      className={`${styles.timelineStep} ${
                        isCurrent
                          ? styles.timelineStepCurrent
                          : isCompleted
                          ? styles.timelineStepCompleted
                          : styles.timelineStepUpcoming
                      }`}
                    >
                      <div className={styles.stepIndicator}>
                        {isCompleted ? (
                          <span className={styles.stepCheck}>✓</span>
                        ) : isCurrent ? (
                          <span className={styles.stepCheck} style={{ color: '#2563eb', fontSize: '18px' }}>●</span>
                        ) : (
                          <span className={styles.stepCheck} style={{ color: '#94a3b8', fontSize: '18px' }}>○</span>
                        )}
                      </div>
                      <div className={styles.stepContent}>
                        <div className={styles.stepHeaderRow}>
                          <h4 className={styles.stepLabel}>{step.label}</h4>
                          {isCurrent && (
                            <span className={styles.currentBadge}>Current Status</span>
                          )}
                          {isCompleted && (
                            <span className={styles.completedBadge}>Completed</span>
                          )}
                        </div>
                        <p className={styles.stepDesc}>{step.subLabel}</p>
                      </div>
                    </div>

                    {idx < TRACKING_TIMELINE_STEPS.length - 1 && (
                      <div
                        className={`${styles.timelineConnector} ${
                          idx < currentIdx ? styles.timelineConnectorCompleted : ''
                        }`}
                      >
                        <span className={styles.timelineArrowSymbol}>↓</span>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Delivery-Partner Location Tracking Map */}
        {/* Real-time OpenStreetMap / Leaflet with dynamic marker movement on deliveryLocationUpdated */}
        {order && String(order?.orderStatus || '').toUpperCase() !== 'CANCELLED' && (
          <OrderTrackingMap
            orderId={order._id || orderId}
            deliveryLocation={liveDeliveryLocation || order.deliveryLocation}
            destinationCoords={order.deliveryCoordinates}
            destinationAddress={
              [
                shippingAddr?.address,
                shippingAddr?.city,
                shippingAddr?.state,
                shippingAddr?.postalCode,
              ]
                .filter(Boolean)
                .join(', ') || null
            }
            orderStatus={order.orderStatus}
            isLiveConnected={isSocketConnected}
            onDelivered={handleAutoDelivered}
          />
        )}

        {/* Feedback Alert for Refund Actions */}
        {refundAlert && (
          <div
            className={`${styles.refundBanner} ${
              refundAlert.type === 'success' ? styles.refundBannerApproved : styles.refundBannerPending
            }`}
            style={{ marginBottom: '20px' }}
          >
            <span style={{ fontSize: '20px' }}>{refundAlert.type === 'success' ? '✅' : '⚠️'}</span>
            <div>
              <div className={styles.refundBannerTitle}>
                {refundAlert.type === 'success' ? 'Request Update' : 'Notice'}
              </div>
              <div className={styles.refundBannerText}>{refundAlert.message}</div>
            </div>
          </div>
        )}

        {/* Refund Status Banner */}
        {order.paymentStatus === 'refunded' ? (
          <div className={`${styles.refundBanner} ${styles.refundBannerApproved}`}>
            <span style={{ fontSize: '24px' }}>↩</span>
            <div>
              <div className={styles.refundBannerTitle}>Payment Refunded via Stripe</div>
              <div className={styles.refundBannerText}>
                A refund of <strong>₹{grandTotal.toFixed(2)} {currencyCode}</strong> was successfully issued through Stripe.
                {order.refundRequest?.stripeRefundId && (
                  <div style={{ marginTop: '4px' }}>
                    <strong>Stripe Transaction ID:</strong>{' '}
                    <code style={{ fontSize: '12.5px', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>
                      {order.refundRequest.stripeRefundId}
                    </code>
                  </div>
                )}
                {order.refundRequest?.reason && (
                  <div style={{ marginTop: '4px' }}>
                    <strong>Reason:</strong> {order.refundRequest.reason}
                  </div>
                )}
                {order.refundRequest?.adminNotes && (
                  <div style={{ marginTop: '4px' }}>
                    <strong>Admin Note:</strong> &ldquo;{order.refundRequest.adminNotes}&rdquo;
                  </div>
                )}
                <div style={{ marginTop: '6px', fontSize: '12.5px', color: '#166534' }}>
                  Please allow 5 to 10 business days for the credit to appear on your bank statement.
                </div>
              </div>
            </div>
          </div>
        ) : order.refundRequest?.status === 'requested' ? (
          <div className={`${styles.refundBanner} ${styles.refundBannerPending}`}>
            <span style={{ fontSize: '24px' }}>⏳</span>
            <div>
              <div className={styles.refundBannerTitle}>Refund Request Under Admin Review</div>
              <div className={styles.refundBannerText}>
                Your request to refund this order is currently being reviewed by our administration team.
                <div style={{ marginTop: '6px' }}>
                  <strong>Reason:</strong> {order.refundRequest.reason}
                </div>
                {order.refundRequest.details && (
                  <div style={{ marginTop: '4px' }}>
                    <strong>Your Description:</strong> &ldquo;{order.refundRequest.details}&rdquo;
                  </div>
                )}
                <div style={{ marginTop: '6px', fontSize: '12.5px', color: '#92400e' }}>
                  💳 Once verified by the administrator, the payment of <strong>₹{grandTotal.toFixed(2)} {currencyCode}</strong> will be refunded directly to your card via Stripe.
                </div>
              </div>
            </div>
          </div>
        ) : order.refundRequest?.status === 'rejected' ? (
          <div className={`${styles.refundBanner} ${styles.refundBannerRejected}`}>
            <span style={{ fontSize: '24px' }}>ℹ️</span>
            <div>
              <div className={styles.refundBannerTitle}>Refund Request Not Approved</div>
              <div className={styles.refundBannerText}>
                Your previous refund request was reviewed by our team and could not be approved.
                {order.refundRequest.adminNotes && (
                  <div style={{ marginTop: '4px' }}>
                    <strong>Admin Feedback:</strong> &ldquo;{order.refundRequest.adminNotes}&rdquo;
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Grid: Order Items & Shipping / Summary */}
        <div className={styles.detailsGrid}>
          {/* Left Column: Purchased Products Snapshot */}
          <div className={styles.detailsCard}>
            <div className={styles.sectionHeading}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
              <span>Purchased Products ({orderItems.length} {orderItems.length === 1 ? 'item' : 'items'})</span>
            </div>

            {/* Price Snapshot Guarantee Notice */}
            <div className={styles.priceSnapshotNotice}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              <span>
                <strong>Purchase Price Snapshot Protected:</strong> Prices and line subtotals shown below reflect the
                guaranteed price at the time this order was placed. Any subsequent catalog updates or price changes do not
                alter past orders.
              </span>
            </div>

            {/* Products List */}
            <div className={styles.detailsItemsList}>
              {orderItems.map((item, index) => {
                const unitPrice = Number(item.price) || 0;
                const lineSubtotal = Number(item.subtotal) || unitPrice * (item.quantity || 1);

                return (
                  <div key={index} className={styles.detailItemRow}>
                    <div className={styles.detailItemMedia}>
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.title}
                          className={styles.detailItemThumb}
                        />
                      ) : (
                        <div
                          className={styles.detailItemThumb}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#94a3b8' }}
                        >
                          📦
                        </div>
                      )}

                      <div className={styles.detailItemDetails}>
                        <span className={styles.detailItemTitle}>{item.title}</span>
                        <span className={styles.detailItemSnapshotPrice}>
                          Quantity: <strong>{item.quantity}</strong> × ₹{unitPrice.toFixed(2)} {currencyCode}
                        </span>
                        <span style={{ fontSize: '11.5px', color: '#059669', fontWeight: 600 }}>
                          Snapshot price locked at checkout
                        </span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span className={styles.detailItemSubtotal}>
                        ₹{lineSubtotal.toFixed(2)}
                      </span>
                      <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>
                        {currencyCode}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Option to Raise a Refund Request if Product is not correct */}
            {order.paymentStatus === 'paid' &&
              order.paymentStatus !== 'refunded' &&
              (!order.refundRequest || order.refundRequest.status === 'none') && (
                <div className={styles.refundActionCard}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '14px',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>
                        Product Issue or Incorrect Item?
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b', maxWidth: '480px' }}>
                        If you received an incorrect product, defective item, or wrong order, you can submit a refund
                        request to our store administrators.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsRefundModalOpen(true)}
                      className={styles.refundBtn}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                      >
                        <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      <span>Request Refund</span>
                    </button>
                  </div>
                </div>
              )}
          </div>

          {/* Right Column: Order Summary & Shipping Info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Order Payment Summary Card */}
            <div className={styles.detailsCard}>
              <div className={styles.sectionHeading}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
                  <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                  <line x1="6" y1="8" x2="6" y2="8"></line>
                  <line x1="10" y1="8" x2="18" y2="8"></line>
                  <line x1="6" y1="12" x2="18" y2="12"></line>
                  <line x1="6" y1="16" x2="14" y2="16"></line>
                </svg>
                <span>Payment Summary</span>
              </div>

              <div className={styles.infoBox}>
                <div className={styles.infoRow}>
                  <span>Items Subtotal:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>
                    ₹{itemsSubtotal.toFixed(2)}
                  </span>
                </div>

                <div className={styles.infoRow}>
                  <span>Delivery Fee ({order.deliveryZone?.name || 'Standard Delivery'}):</span>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>
                    {shippingAmount === 0 ? 'Free' : `₹${shippingAmount.toFixed(2)}`}
                  </span>
                </div>

                <div className={styles.infoRow}>
                  <span>Payment Method:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                      <line x1="1" y1="10" x2="23" y2="10"></line>
                    </svg>
                    Credit / Debit Card (Stripe)
                  </span>
                </div>

                <div className={styles.infoRow}>
                  <span>Payment Status:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {renderPaymentBadge(order)}
                    {(order.paymentStatus === 'paid' || order.orderStatus === 'processing') &&
                      (!order.refundRequest || order.refundRequest.status === 'none' || !order.refundRequest.status) &&
                      order.paymentStatus !== 'refunded' &&
                      order.orderStatus !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => setIsRefundModalOpen(true)}
                          className={styles.headerRefundBtn}
                          style={{ padding: '2px 8px', fontSize: '12px' }}
                          title="Request Refund for this order"
                        >
                          ↩ Refund
                        </button>
                      )}
                  </div>
                </div>

                {order.paymentStatus === 'refunded' && (
                  <div className={styles.infoRow}>
                    <span>Refund:</span>
                    <span style={{ color: '#ea580c', fontWeight: 700, fontSize: '12.5px' }}>
                      ↩ Refunded via Stripe
                    </span>
                  </div>
                )}

                <div className={styles.infoRowBold}>
                  <span>Total Amount:</span>
                  <span style={{ color: '#2563eb' }}>
                    ₹{grandTotal.toFixed(2)} {currencyCode}
                  </span>
                </div>
              </div>
            </div>

            {/* Shipping Information Card */}
            <div className={styles.detailsCard}>
              <div className={styles.sectionHeading}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
                <span>Shipping Destination</span>
              </div>

              <div className={styles.shippingDetailsBlock}>
                <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', marginBottom: '6px' }}>
                  {customer.fullName || 'Valued Customer'}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#475569' }}>
                  {shippingAddr.address && <div>{shippingAddr.address}</div>}
                  {(shippingAddr.city || shippingAddr.state || shippingAddr.postalCode) && (
                    <div>
                      {[shippingAddr.city, shippingAddr.state, shippingAddr.postalCode]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  )}
                  {shippingAddr.country && (
                    <div style={{ fontWeight: 600, color: '#334155' }}>{shippingAddr.country}</div>
                  )}

                  <div style={{ borderTop: '1px solid #e2e8f0', marginTop: '8px', paddingTop: '8px', fontSize: '12.5px' }}>
                    {customer.email && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <span>✉</span>
                        <span>{customer.email}</span>
                      </div>
                    )}
                    {customer.phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>☎</span>
                        <span>{customer.phone}</span>
                      </div>
                    )}

                    {order.deliveryZone?.name && (
                      <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Assigned Delivery Zone
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '3px' }}>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{order.deliveryZone.name}</span>
                          {order.deliveryZone.estimatedDeliveryTime && (
                            <span style={{ fontSize: '11.5px', background: '#eff6ff', color: '#2563eb', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                              ⚡ {order.deliveryZone.estimatedDeliveryTime}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {order.deliveryCoordinates?.latitude !== undefined && order.deliveryCoordinates?.latitude !== null && (
                      <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>📍</span>
                        <span>
                          Coords: {Number(order.deliveryCoordinates.latitude).toFixed(4)}, {Number(order.deliveryCoordinates.longitude).toFixed(4)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Refund Request Modal */}
        {isRefundModalOpen && (
          <div className={styles.modalOverlay} onClick={() => !isSubmittingRefund && setIsRefundModalOpen(false)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>
                  <span style={{ color: '#dc2626' }}>↩</span>
                  <span>Raise Refund Request</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRefundModalOpen(false)}
                  className={styles.modalCloseBtn}
                  disabled={isSubmittingRefund}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleRefundSubmit}>
                <div className={styles.modalBody}>
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: '#475569',
                    }}
                  >
                    <div>
                      Order ID: <strong>#{order._id.substring(order._id.length - 8).toUpperCase()}</strong>
                    </div>
                    <div style={{ marginTop: '3px' }}>
                      Refund Total: <strong>₹{grandTotal.toFixed(2)} {currencyCode}</strong>
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Reason for Refund *</label>
                    <select
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      className={styles.formSelect}
                      required
                    >
                      <option value="Product is not correct / wrong item received">
                        Product is not correct / wrong item received
                      </option>
                      <option value="Product is defective or damaged">Product is defective or damaged</option>
                      <option value="Item does not match website description">
                        Item does not match website description
                      </option>
                      <option value="Wrong quantity or missing parts">Wrong quantity or missing parts</option>
                      <option value="Quality significantly below expectations">
                        Quality significantly below expectations
                      </option>
                      <option value="Other reason">Other reason</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Describe What Is Incorrect *</label>
                    <textarea
                      rows={4}
                      value={refundDetails}
                      onChange={(e) => setRefundDetails(e.target.value)}
                      placeholder="Please explain why the product is not correct (e.g. received wrong item, item arrived broken, etc.)..."
                      className={styles.formTextarea}
                      required
                    />
                  </div>

                  <div
                    style={{
                      fontSize: '12px',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      lineHeight: 1.4,
                    }}
                  >
                    <span>🔒</span>
                    <span>
                      Once verified and approved by the store administrator, your payment will be refunded directly to
                      your payment method through Stripe.
                    </span>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    onClick={() => setIsRefundModalOpen(false)}
                    className={styles.modalCancelBtn}
                    disabled={isSubmittingRefund}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.modalSubmitBtn}
                    disabled={isSubmittingRefund || !refundDetails.trim()}
                  >
                    {isSubmittingRefund ? (
                      <>
                        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                        <span>Submitting...</span>
                      </>
                    ) : (
                      'Submit Refund Request'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
