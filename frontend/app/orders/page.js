'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './orders.module.css';
import CustomerNavbar from '../../components/CustomerNavbar';
import { getStoredAuth } from '../../utils/auth';
import { useSocket } from '../../utils/socket';

export default function CustomerOrdersPage() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(null);
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // Refund Request State
  const [selectedOrderForRefund, setSelectedOrderForRefund] = useState(null);
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('Product is not correct / wrong item received');
  const [refundDetails, setRefundDetails] = useState('');
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);
  const [refundAlert, setRefundAlert] = useState(null); // { type: 'success' | 'error', message: '' }

  // 1. Check authentication status on mount (prioritizes customer credentials)
  useEffect(() => {
    try {
      const auth = getStoredAuth();

      if (auth.token && auth.user) {
        setToken(auth.token);
        setCurrentUser(auth.user);
        fetchOrders(auth.token);
      } else {
        // Customer is not authenticated
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Auth verification error:', err);
      setIsLoading(false);
    }
  }, []);

  // 1b. Real-time updates via Socket.IO for orders list
  const { socket, isConnected: isSocketConnected } = useSocket();

  useEffect(() => {
    if (!socket) return;

    const handleRealtimeUpdate = (payload) => {
      const updatedOrder = payload?.order || payload;
      if (!updatedOrder?._id) return;
      console.log('[CustomerOrdersPage] Real-time order update received:', updatedOrder);
      setOrders((prev) =>
        prev.map((o) => (o._id === updatedOrder._id ? { ...o, ...updatedOrder } : o))
      );
    };

    socket.on('orderUpdated', handleRealtimeUpdate);
    socket.on('orderStatusUpdated', handleRealtimeUpdate);

    return () => {
      socket.off('orderUpdated', handleRealtimeUpdate);
      socket.off('orderStatusUpdated', handleRealtimeUpdate);
    };
  }, [socket]);

  // 2. Fetch authenticated customer's orders from backend
  const fetchOrders = async (authToken) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/payments/orders', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 401 || res.status === 403) {
          setErrorMessage('Session expired or unauthorized. Please sign in again.');
        } else {
          setErrorMessage(data.message || 'Failed to load your orders. Please try again.');
        }
        setIsLoading(false);
        return;
      }

      setOrders(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      console.error('Error fetching customer orders:', err);
      setErrorMessage('Network error while retrieving orders. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper: check if order is eligible for refund request
  const canRequestRefund = (order) => {
    const isPaid = order?.paymentStatus === 'paid' || order?.orderStatus === 'processing';
    const notAlreadyRequested = !order?.refundRequest || order?.refundRequest?.status === 'none' || !order?.refundRequest?.status;
    const notRefunded = order?.paymentStatus !== 'refunded';
    const notCancelled = order?.orderStatus !== 'cancelled';
    return isPaid && notAlreadyRequested && notRefunded && notCancelled;
  };

  // Handler to open refund modal for a specific order
  const openRefundModal = (order) => {
    setSelectedOrderForRefund(order);
    setRefundReason('Product is not correct / wrong item received');
    setRefundDetails('');
    setIsRefundModalOpen(true);
  };

  // Handler for customer submitting refund request
  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    if (!selectedOrderForRefund?._id || !token) return;

    setIsSubmittingRefund(true);
    setRefundAlert(null);

    try {
      const res = await fetch(`/api/payments/orders/${selectedOrderForRefund._id}/refund-request`, {
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

      // Update order in local state
      setOrders((prev) =>
        prev.map((o) => (o._id === selectedOrderForRefund._id ? data.data : o))
      );

      setIsRefundModalOpen(false);
      setRefundAlert({
        type: 'success',
        message: `Refund request for Order #${selectedOrderForRefund._id.substring(selectedOrderForRefund._id.length - 8).toUpperCase()} submitted successfully! Our team will review your request and process the refund via Stripe.`,
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
  const renderSingleStatusBadge = (order) => {
    const paymentStatus = order?.paymentStatus?.toLowerCase();
    const orderStatus = String(order?.orderStatus || '').toUpperCase();
    const refundStatus = order?.refundRequest?.status?.toLowerCase();

    if (paymentStatus === 'refunded') {
      return <span className={`${styles.badge} ${styles.paymentRefunded}`}>↩ Refunded</span>;
    }
    if (refundStatus === 'requested') {
      return <span className={`${styles.badge} ${styles.paymentRefundRequested}`}>⏳ Refund Requested</span>;
    }
    if (paymentStatus === 'failed') {
      return <span className={`${styles.badge} ${styles.paymentFailed}`}>✕ Failed</span>;
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

  // ---------------------------------------------------------------------------
  // View: Unauthorized State (Customer not logged in)
  // ---------------------------------------------------------------------------
  if (!isLoading && !token) {
    return (
      <div className={styles.pageContainer}>
        <CustomerNavbar />

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
              Only authenticated customers can access their order history. Please sign in with your account to view your
              past orders.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <Link href="/login?redirect=/orders" className={styles.actionBtn}>
                Sign In to View Orders
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

  return (
    <div className={styles.pageContainer}>
      {/* ----------------------------------------------------------------------
          1. Storefront Navigation Bar
          ---------------------------------------------------------------------- */}
      <CustomerNavbar />

      {/* ----------------------------------------------------------------------
          2. Main Orders Content
          ---------------------------------------------------------------------- */}
      <main className={styles.mainContainer}>
        <div className={styles.pageHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 className={styles.pageTitle}>My Order History</h1>
            <p className={styles.pageSubtitle}>
              View and track your previous purchases, payment confirmations, and delivery updates.
            </p>
          </div>
          {isSocketConnected && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '20px',
                background: '#ecfdf5',
                color: '#059669',
                border: '1px solid #a7f3d0',
                marginTop: '4px',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.3)',
                }}
              />
              Live Sync
            </span>
          )}
        </div>

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
                {refundAlert.type === 'success' ? 'Request Submitted' : 'Notice'}
              </div>
              <div className={styles.refundBannerText}>{refundAlert.message}</div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && <div className={styles.loadingSpinner}></div>}

        {/* Error State */}
        {errorMessage && !isLoading && (
          <div className={styles.centerCard} style={{ borderColor: '#fecaca', background: '#fff5f5' }}>
            <div className={styles.iconCircle} style={{ background: '#fee2e2', color: '#dc2626' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h2 className={styles.stateTitle} style={{ color: '#991b1b' }}>
              Unable to Load Orders
            </h2>
            <p className={styles.stateDesc} style={{ color: '#b91c1c' }}>
              {errorMessage}
            </p>
            <button type="button" onClick={() => fetchOrders(token)} className={styles.actionBtn}>
              Try Again
            </button>
          </div>
        )}

        {/* Empty Orders State */}
        {!isLoading && !errorMessage && orders.length === 0 && (
          <div className={styles.centerCard}>
            <div className={styles.iconCircle}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              </svg>
            </div>
            <h2 className={styles.stateTitle}>No Orders Yet</h2>
            <p className={styles.stateDesc}>
              You haven&apos;t placed any orders yet. When you complete checkout, your orders will appear here.
            </p>
            <Link href="/products" className={styles.actionBtn} style={{ marginTop: '6px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Explore Products</span>
            </Link>
          </div>
        )}

        {/* Orders List */}
        {!isLoading && !errorMessage && orders.length > 0 && (
          <div className={styles.ordersList}>
            {orders.map((order) => {
              const formattedDate = order.createdAt
                ? new Date(order.createdAt).toLocaleString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'N/A';

              const totalItemsCount = order.orderItems.reduce((acc, it) => acc + it.quantity, 0);

              return (
                <div key={order._id} className={styles.orderCard}>
                  {/* Card Header: Order Reference ID, Date, Badges and Refund Option */}
                  <div className={styles.orderCardHeader}>
                    <div className={styles.orderHeaderLeft}>
                      <span className={styles.orderNumber}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
                          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                          <line x1="3" y1="6" x2="21" y2="6"></line>
                          <path d="M16 10a4 4 0 0 1-8 0"></path>
                        </svg>
                        Order #{order._id.substring(order._id.length - 8).toUpperCase()}
                      </span>
                      <span className={styles.orderDate}>Placed on {formattedDate}</span>
                    </div>

                    <div className={styles.orderStatusGroup}>
                      {renderSingleStatusBadge(order)}
                    </div>
                  </div>

                  {/* Card Body: Purchased Items Snapshot Preview */}
                  <div className={styles.orderItemsPreview}>
                    {order.orderItems.map((item, idx) => (
                      <div key={idx} className={styles.previewItem}>
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.title}
                            className={styles.previewThumb}
                          />
                        ) : (
                          <div
                            className={styles.previewThumb}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}
                          >
                            📦
                          </div>
                        )}

                        <div className={styles.previewInfo}>
                          <span className={styles.previewTitle}>{item.title}</span>
                          <span className={styles.previewQtyPrice}>
                            Qty: {item.quantity} × ₹{Number(item.price).toFixed(2)} (Snapshot Price)
                          </span>
                        </div>

                        <span style={{ fontWeight: 700, fontSize: '14.5px', color: '#0f172a' }}>
                          ₹{Number(item.subtotal).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Card Footer: Total Amount, Refund Button & View Details Link */}
                  <div className={styles.orderCardFooter}>
                    <div className={styles.orderTotalAmount}>
                      <span className={styles.orderTotalLabel}>
                        Total ({totalItemsCount} {totalItemsCount === 1 ? 'item' : 'items'}):
                      </span>
                      <span>₹{Number(order.totalAmount).toFixed(2)} INR</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {canRequestRefund(order) && (
                        <button
                          type="button"
                          onClick={() => openRefundModal(order)}
                          className={styles.cardRefundBtn}
                          title="Request Refund for this order"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          <span>Request Refund</span>
                        </button>
                      )}

                      <Link
                        href={`/orders/${order._id}`}
                        className={styles.viewDetailsButton}
                        style={{ color: '#ffffff' }}
                      >
                        <span style={{ color: '#ffffff' }}>View Order Details</span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal: Customer Refund Request */}
        {isRefundModalOpen && selectedOrderForRefund && (
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
                      Order Reference:{' '}
                      <strong>#{selectedOrderForRefund._id.substring(selectedOrderForRefund._id.length - 8).toUpperCase()}</strong>
                    </div>
                    <div style={{ marginTop: '3px' }}>
                      Refund Total:{' '}
                      <strong style={{ color: '#0f172a' }}>
                        ₹{Number(selectedOrderForRefund.totalAmount).toFixed(2)} INR
                      </strong>
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
                      <option value="Received wrong size, color, or variant">
                        Received wrong size, color, or variant
                      </option>
                      <option value="Quality significantly below expectations">
                        Quality significantly below expectations
                      </option>
                      <option value="Package arrived with missing items or accessories">
                        Package arrived with missing items or accessories
                      </option>
                      <option value="Other reason">Other reason</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Describe What Is Incorrect / Issue Details *</label>
                    <textarea
                      rows={4}
                      value={refundDetails}
                      onChange={(e) => setRefundDetails(e.target.value)}
                      placeholder="Please explain in detail why the product is not correct (e.g. wrong model sent, item defective on arrival, missing accessories)..."
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
                      your original payment method through Stripe.
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
