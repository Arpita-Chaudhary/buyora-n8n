'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import styles from './RefundsManager.module.css';
import { useSocket } from '../../../../utils/socket';

export default function RefundsManager({ token, triggerToast, onPendingCountChange }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    pendingRefunds: 0,
    approvedRefunds: 0,
    rejectedRefunds: 0,
    totalOrders: 0,
  });

  // Filter: 'requested' (default) | 'approved' | 'rejected' | 'all'
  const [activeFilter, setActiveFilter] = useState('requested');
  const [searchQuery, setSearchQuery] = useState('');

  // Stripe Refund Modal State
  const [selectedOrderForRefund, setSelectedOrderForRefund] = useState(null);
  const [adminRefundNotes, setAdminRefundNotes] = useState('');
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);

  // Decline Modal State
  const [selectedOrderForDecline, setSelectedOrderForDecline] = useState(null);
  const [adminDeclineNotes, setAdminDeclineNotes] = useState('');
  const [isProcessingDecline, setIsProcessingDecline] = useState(false);

  // Real-time Order Status Update State (Admin Order Management)
  const [updatingOrderId, setUpdatingOrderId] = useState(null);

  // Delivery Location Update Modal State
  const [selectedOrderForLocation, setSelectedOrderForLocation] = useState(null);
  const [locLatitude, setLocLatitude] = useState('30.7046');
  const [locLongitude, setLocLongitude] = useState('76.7179');
  const [isSendingLocation, setIsSendingLocation] = useState(false);

  const normalizeStatus = (raw) => {
    if (!raw) return 'PLACED';
    const s = String(raw).toUpperCase().trim();
    if (s === 'PENDING') return 'PLACED';
    if (s === 'PROCESSING') return 'PREPARING';
    if (s === 'SHIPPED') return 'OUT_FOR_DELIVERY';
    return s;
  };

  /**
   * Handle admin changing order status via existing REST API.
   * Backend updates MongoDB and emits 'orderStatusUpdated' to room 'order_<orderId>'.
   * Customer tracking page receives update and moves timeline in real time.
   */
  const handleStatusChange = async (orderId, newStatus) => {
    if (!orderId || !newStatus || !token) return;

    setUpdatingOrderId(orderId);

    try {
      // 1. Call existing REST API: PATCH /api/payments/orders/:id/status
      const res = await fetch(`/api/payments/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to update order status');
      }

      // 2. Optimistically update local React state with the updated document from MongoDB
      setOrders((prev) =>
        prev.map((o) => (o._id === orderId ? { ...o, ...data.data, orderStatus: newStatus } : o))
      );

      if (triggerToast) {
        triggerToast(`Order status updated to '${newStatus}'! Customer tracking notified in real time.`, 'success');
      }
    } catch (err) {
      console.error('Error updating order status:', err);
      if (triggerToast) {
        triggerToast(err.message || 'Failed to update order status', 'error');
      }
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const renderOrderStatusBadge = (rawStatus) => {
    const status = normalizeStatus(rawStatus);
    switch (status) {
      case 'DELIVERED':
        return (
          <span
            style={{
              background: '#dcfce7',
              color: '#15803d',
              border: '1px solid #bbf7d0',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ✓ Delivered
          </span>
        );
      case 'OUT_FOR_DELIVERY':
        return (
          <span
            style={{
              background: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            🚚 Out for Delivery
          </span>
        );
      case 'PREPARING':
        return (
          <span
            style={{
              background: '#fef3c7',
              color: '#b45309',
              border: '1px solid #fde68a',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            👨‍🍳 Preparing
          </span>
        );
      case 'CONFIRMED':
        return (
          <span
            style={{
              background: '#f0fdf4',
              color: '#16a34a',
              border: '1px solid #bbf7d0',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ✅ Confirmed
          </span>
        );
      case 'CANCELLED':
        return (
          <span
            style={{
              background: '#fee2e2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ✕ Cancelled
          </span>
        );
      case 'PLACED':
      default:
        return (
          <span
            style={{
              background: '#f1f5f9',
              color: '#475569',
              border: '1px solid #cbd5e1',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            📋 Order Placed
          </span>
        );
    }
  };

  // Fetch orders with refund requests & metrics
  const fetchRefundOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/payments/admin/refunds?status=${activeFilter}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to fetch refund orders.');
      }

      setOrders(Array.isArray(data.data) ? data.data : []);
      if (data.metrics) {
        setMetrics(data.metrics);
        if (onPendingCountChange) {
          onPendingCountChange(data.metrics.pendingRefunds || 0);
        }
      }
    } catch (err) {
      console.error('Error fetching admin refund orders:', err);
      if (triggerToast) {
        triggerToast(err.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [token, activeFilter, onPendingCountChange, triggerToast]);

  useEffect(() => {
    fetchRefundOrders();
  }, [fetchRefundOrders]);

  // Real-time live update for admin orders
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return;
    const handleOrderEvent = () => {
      fetchRefundOrders();
    };
    socket.on('orderUpdated', handleOrderEvent);
    socket.on('orderStatusUpdated', handleOrderEvent);
    return () => {
      socket.off('orderUpdated', handleOrderEvent);
      socket.off('orderStatusUpdated', handleOrderEvent);
    };
  }, [socket, fetchRefundOrders]);

  // Filtered orders by client-side search query
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const query = searchQuery.toLowerCase().trim();

    return orders.filter((o) => {
      const orderId = (o._id || '').toLowerCase();
      const customerName = (o.customer?.fullName || '').toLowerCase();
      const customerEmail = (o.customer?.email || '').toLowerCase();
      const piId = (o.stripePaymentIntentId || '').toLowerCase();
      const reason = (o.refundRequest?.reason || '').toLowerCase();
      const itemsMatch = (o.orderItems || []).some((it) =>
        (it.title || '').toLowerCase().includes(query)
      );

      return (
        orderId.includes(query) ||
        customerName.includes(query) ||
        customerEmail.includes(query) ||
        piId.includes(query) ||
        reason.includes(query) ||
        itemsMatch
      );
    });
  }, [orders, searchQuery]);

  // Execute Stripe Refund (Approval)
  const confirmStripeRefund = async () => {
    if (!selectedOrderForRefund?._id || !token) return;
    setIsProcessingRefund(true);

    try {
      const res = await fetch(`/api/payments/admin/orders/${selectedOrderForRefund._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'approve',
          adminNotes: adminRefundNotes.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Stripe refund operation failed.');
      }

      if (triggerToast) {
        triggerToast(
          `Refund issued via Stripe! (Refund ID: ${data.stripeRefundId})`,
          'success'
        );
      }

      setSelectedOrderForRefund(null);
      setAdminRefundNotes('');
      // Refresh list
      fetchRefundOrders();
    } catch (err) {
      console.error('Stripe refund error:', err);
      if (triggerToast) {
        triggerToast(err.message, 'error');
      }
    } finally {
      setIsProcessingRefund(false);
    }
  };

  // Decline Refund Request
  const confirmDeclineRefund = async () => {
    if (!selectedOrderForDecline?._id || !token) return;
    setIsProcessingDecline(true);

    try {
      const res = await fetch(`/api/payments/admin/orders/${selectedOrderForDecline._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'reject',
          adminNotes: adminDeclineNotes.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to decline refund request.');
      }

      if (triggerToast) {
        triggerToast('Refund request declined. Customer notified by email.', 'success');
      }

      setSelectedOrderForDecline(null);
      setAdminDeclineNotes('');
      fetchRefundOrders();
    } catch (err) {
      console.error('Decline refund error:', err);
      if (triggerToast) {
        triggerToast(err.message, 'error');
      }
    } finally {
      setIsProcessingDecline(false);
    }
  };

  // Badge helpers
  const renderPaymentBadge = (status) => {
    switch (status?.toLowerCase()) {
      case 'paid':
        return (
          <span
            style={{
              background: '#dcfce7',
              color: '#15803d',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ● Paid
          </span>
        );
      case 'refunded':
        return (
          <span
            style={{
              background: '#ffedd5',
              color: '#c2410c',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ↩ Refunded via Stripe
          </span>
        );
      default:
        return (
          <span
            style={{
              background: '#fef9c3',
              color: '#a16207',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ⏳ {status || 'Pending'}
          </span>
        );
    }
  };

  const renderRefundStatusBadge = (refundReq) => {
    const status = refundReq?.status?.toLowerCase();
    switch (status) {
      case 'requested':
        return (
          <span
            style={{
              background: '#fef3c7',
              color: '#b45309',
              border: '1px solid #fcd34d',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ⏳ Refund Requested
          </span>
        );
      case 'approved':
        return (
          <span
            style={{
              background: '#dcfce7',
              color: '#166534',
              border: '1px solid #bbf7d0',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ✓ Refund Approved
          </span>
        );
      case 'rejected':
        return (
          <span
            style={{
              background: '#f1f5f9',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            ✕ Declined
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.container}>
      {/* 1. Metrics Cards Overview */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconPending}`}>⏳</div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Pending Requests</span>
            <span className={styles.statValue}>{metrics.pendingRefunds}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconApproved}`}>💳</div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Stripe Refunds Issued</span>
            <span className={styles.statValue}>{metrics.approvedRefunds}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconRejected}`}>✕</div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Requests Declined</span>
            <span className={styles.statValue}>{metrics.rejectedRefunds}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconTotal}`}>📦</div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Total Store Orders</span>
            <span className={styles.statValue}>{metrics.totalOrders}</span>
          </div>
        </div>
      </div>

      {/* 2. Controls Bar: Filter Tabs & Search */}
      <div className={styles.controlsBar}>
        <div className={styles.filterTabs}>
          <button
            type="button"
            onClick={() => setActiveFilter('requested')}
            className={`${styles.filterBtn} ${activeFilter === 'requested' ? styles.filterBtnActive : ''}`}
          >
            <span>⏳ Pending Review</span>
            <span className={styles.filterBadge}>{metrics.pendingRefunds}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('approved')}
            className={`${styles.filterBtn} ${activeFilter === 'approved' ? styles.filterBtnActive : ''}`}
          >
            <span>✓ Approved (Stripe)</span>
            <span className={styles.filterBadge}>{metrics.approvedRefunds}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('rejected')}
            className={`${styles.filterBtn} ${activeFilter === 'rejected' ? styles.filterBtnActive : ''}`}
          >
            <span>✕ Declined</span>
            <span className={styles.filterBadge}>{metrics.rejectedRefunds}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('all')}
            className={`${styles.filterBtn} ${activeFilter === 'all' ? styles.filterBtnActive : ''}`}
          >
            <span>All Store Orders</span>
            <span className={styles.filterBadge}>{metrics.totalOrders}</span>
          </button>
        </div>

        <div className={styles.searchGroup}>
          <div className={styles.searchInputWrapper}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              placeholder="Search by order ID, customer name, email, or product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <button
            type="button"
            onClick={fetchRefundOrders}
            className={styles.refreshBtn}
            title="Refresh Orders"
          >
            <span style={{ display: loading ? 'inline-block' : 'none', animation: 'spin 1s linear infinite' }}>
              🔄
            </span>
            <span style={{ display: loading ? 'none' : 'inline' }}>🔄</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 3. Orders & Refund Requests List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              border: '3.5px solid #e2e8f0',
              borderTopColor: '#2563eb',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px auto',
            }}
          />
          <p style={{ fontWeight: 600 }}>Loading refund requests and order details...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>↩</div>
          <div className={styles.emptyTitle}>No Orders Found in this View</div>
          <p style={{ fontSize: '13.5px', maxWidth: '420px', margin: '0 auto' }}>
            {activeFilter === 'requested'
              ? 'Great news! There are currently no pending refund requests awaiting administrative review.'
              : 'No orders matched your active filters or search terms.'}
          </p>
        </div>
      ) : (
        <div className={styles.ordersList}>
          {filteredOrders.map((order) => {
            const isRequested = order.refundRequest?.status === 'requested';
            const isRefunded = order.paymentStatus === 'refunded';
            const canRefundThroughStripe =
              order.paymentStatus === 'paid' && !isRefunded && Boolean(order.stripePaymentIntentId);

            const formattedDate = order.createdAt
              ? new Date(order.createdAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'N/A';

            const requestedDate = order.refundRequest?.requestedAt
              ? new Date(order.refundRequest.requestedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : null;

            return (
              <div
                key={order._id}
                className={`${styles.orderCard} ${
                  isRequested ? styles.orderCardRequested : isRefunded ? styles.orderCardRefunded : ''
                }`}
              >
                {/* Header */}
                <div className={styles.cardHeader}>
                  <div className={styles.cardHeaderLeft}>
                    <span className={styles.orderId}>
                      Order #{order._id.substring(order._id.length - 8).toUpperCase()}
                    </span>
                    <span className={styles.orderDate}>Placed on {formattedDate}</span>
                    <code style={{ fontSize: '11px', color: '#64748b' }}>{order._id}</code>
                  </div>

                  <div className={styles.cardHeaderRight}>
                    {renderOrderStatusBadge(order.orderStatus)}
                    {renderRefundStatusBadge(order.refundRequest)}
                    {renderPaymentBadge(order.paymentStatus)}
                  </div>
                </div>

                {/* Body */}
                <div className={styles.cardBody}>
                  {/* Customer Refund Request Highlight Box (if request exists) */}
                  {order.refundRequest && order.refundRequest.status !== 'none' && (
                    <div
                      className={`${styles.refundDetailBox} ${
                        isRequested
                          ? styles.refundBoxPending
                          : order.refundRequest.status === 'approved'
                          ? styles.refundBoxApproved
                          : styles.refundBoxRejected
                      }`}
                    >
                      <div className={styles.refundBoxHeader}>
                        <div className={styles.refundBoxTitle}>
                          <span>
                            {isRequested
                              ? '⚠️ Customer Refund Request - Action Required'
                              : order.refundRequest.status === 'approved'
                              ? '✓ Refund Processed via Stripe'
                              : '✕ Refund Request Declined'}
                          </span>
                        </div>
                        {requestedDate && (
                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                            Requested on: {requestedDate}
                          </span>
                        )}
                      </div>

                      <div className={styles.refundBoxReason}>
                        Reason: &ldquo;{order.refundRequest.reason}&rdquo;
                      </div>

                      {order.refundRequest.details && (
                        <div className={styles.refundBoxNotes}>
                          <strong>Customer Note:</strong> {order.refundRequest.details}
                        </div>
                      )}

                      {order.refundRequest.stripeRefundId && (
                        <div style={{ marginTop: '8px', fontSize: '12px' }}>
                          <strong>Stripe Transaction ID:</strong>{' '}
                          <code
                            style={{
                              background: '#e2e8f0',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 700,
                            }}
                          >
                            {order.refundRequest.stripeRefundId}
                          </code>
                        </div>
                      )}

                      {order.refundRequest.adminNotes && (
                        <div style={{ marginTop: '6px', fontSize: '12.5px', color: '#475569' }}>
                          <strong>Admin Feedback:</strong> {order.refundRequest.adminNotes}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Columns: Customer Info & Order Items */}
                  <div className={styles.cardColumns}>
                    {/* Left: Customer & Delivery Info */}
                    <div className={styles.customerBlock}>
                      <div className={styles.customerName}>
                        {order.customer?.fullName || 'Customer'}
                      </div>
                      <div style={{ marginBottom: '2px' }}>✉ {order.customer?.email}</div>
                      {order.customer?.phone && <div>☎ {order.customer.phone}</div>}
                      {order.customer?.shippingAddress && (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b' }}>
                          📍 {[
                            order.customer.shippingAddress.address,
                            order.customer.shippingAddress.city,
                            order.customer.shippingAddress.state,
                            order.customer.shippingAddress.postalCode,
                            order.customer.shippingAddress.country,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </div>
                      )}
                      <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>
                        Stripe PI: <code>{order.stripePaymentIntentId || 'N/A'}</code>
                      </div>
                    </div>

                    {/* Right: Ordered Products Preview */}
                    <div className={styles.itemsBlock}>
                      {(order.orderItems || []).map((it, idx) => (
                        <div key={idx} className={styles.itemRow}>
                          <div className={styles.itemMedia}>
                            {it.image ? (
                              <img src={it.image} alt={it.title} className={styles.itemThumb} />
                            ) : (
                              <div
                                className={styles.itemThumb}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '16px',
                                }}
                              >
                                📦
                              </div>
                            )}
                            <div>
                              <div className={styles.itemTitle}>{it.title}</div>
                              <div className={styles.itemQty}>
                                Qty: {it.quantity} × ₹{Number(it.price || 0).toFixed(2)}
                              </div>
                            </div>
                          </div>
                          <div className={styles.itemSubtotal}>
                            ₹{Number(it.subtotal || it.price * it.quantity).toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer with Actions */}
                <div className={styles.cardFooter}>
                  <div className={styles.totalGroup}>
                    <span className={styles.totalLabel}>Total Order Value:</span>
                    <span className={styles.totalAmount}>
                      ₹{Number(order.totalAmount || 0).toFixed(2)}{' '}
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                        {(order.currency || 'INR').toUpperCase()}
                      </span>
                    </span>
                  </div>

                  {/* Real-Time Order Status Dropdown for Admin */}
                  <div className={styles.statusControlGroup}>
                    <label className={styles.statusControlLabel}>Status:</label>
                    <div className={styles.statusSelectWrapper}>
                      <select
                        value={normalizeStatus(order.orderStatus)}
                        onChange={(e) => handleStatusChange(order._id, e.target.value)}
                        disabled={updatingOrderId === order._id}
                        className={styles.statusDropdown}
                        aria-label={`Update fulfillment status for order ${order._id}`}
                      >
                        <option value="PLACED">📋 PLACED</option>
                        <option value="CONFIRMED">✅ CONFIRMED</option>
                        <option value="PREPARING">👨‍🍳 PREPARING</option>
                        <option value="OUT_FOR_DELIVERY">🚚 OUT_FOR_DELIVERY</option>
                        <option value="DELIVERED">🎉 DELIVERED</option>
                        <option value="CANCELLED">✕ CANCELLED</option>
                      </select>
                      {updatingOrderId === order._id && (
                        <span className={styles.statusSpinner} title="Updating in database...">⏳</span>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOrderForLocation(order);
                          let destLat = order.deliveryCoordinates?.latitude;
                          let destLng = order.deliveryCoordinates?.longitude;
                          if (!destLat || !destLng || isNaN(Number(destLat)) || isNaN(Number(destLng)) || Math.abs(Number(destLat)) < 1) {
                            const addr = (order.customer?.shippingAddress?.address || '').toLowerCase();
                            if (addr.includes('phase 7') || addr.includes('sector 60')) {
                              destLat = 30.7094;
                              destLng = 76.7131;
                            } else {
                              destLat = 30.7188;
                              destLng = 76.7299;
                            }
                          }
                          const currentRiderLat = order.deliveryLocation?.coordinates?.[1];
                          const currentRiderLng = order.deliveryLocation?.coordinates?.[0];
                          if (currentRiderLat && currentRiderLng && Math.abs(currentRiderLat) > 1) {
                            setLocLatitude(String(currentRiderLat));
                            setLocLongitude(String(currentRiderLng));
                          } else {
                            // Start at Store Hub heading towards customer
                            setLocLatitude(String((Number(destLat) - 0.0120).toFixed(4)));
                            setLocLongitude(String((Number(destLng) - 0.0110).toFixed(4)));
                          }
                        }}
                        className={styles.statusDropdown}
                        style={{
                          cursor: 'pointer',
                          background: '#f0fdf4',
                          borderColor: '#86efac',
                          color: '#15803d',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '6px 10px',
                        }}
                        title="Broadcast live delivery partner coordinates via Socket.IO"
                      >
                        <span>🛵</span>
                        <span>Update GPS</span>
                      </button>
                    </div>
                  </div>

                  <div className={styles.actionBtnsGroup}>
                    {canRefundThroughStripe ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOrderForRefund(order);
                            setAdminRefundNotes(
                              order.refundRequest?.reason
                                ? `Refund approved for: ${order.refundRequest.reason}`
                                : 'Refund issued via Stripe'
                            );
                          }}
                          className={styles.stripeRefundBtn}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                          </svg>
                          <span>Refund Payment via Stripe</span>
                        </button>

                        {isRequested && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrderForDecline(order);
                              setAdminDeclineNotes('');
                            }}
                            className={styles.declineBtn}
                          >
                            ✕ Decline Request
                          </button>
                        )}
                      </>
                    ) : isRefunded ? (
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#15803d',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        ✓ Refund Complete in Stripe
                      </span>
                    ) : (
                      <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
                        Non-refundable ({order.paymentStatus})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Stripe Refund Confirmation Modal */}
      {selectedOrderForRefund && (
        <div
          className={styles.modalOverlay}
          onClick={() => !isProcessingRefund && setSelectedOrderForRefund(null)}
        >
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <span style={{ color: '#635bff' }}>💳</span>
                <span>Issue Stripe Refund</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderForRefund(null)}
                className={styles.modalClose}
                disabled={isProcessingRefund}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.stripeNotice}>
                <span style={{ fontSize: '18px' }}>⚡</span>
                <div>
                  <strong>Direct Stripe API Integration:</strong> This will trigger a live refund transaction
                  through Stripe back to customer card. Inventory quantities will be automatically restored, and
                  a notification email will be dispatched.
                </div>
              </div>

              <div className={styles.refundSummaryBox}>
                <div className={styles.refundSummaryRow}>
                  <span style={{ color: '#64748b' }}>Order ID:</span>
                  <strong>
                    #{selectedOrderForRefund._id.substring(selectedOrderForRefund._id.length - 8).toUpperCase()}
                  </strong>
                </div>

                <div className={styles.refundSummaryRow}>
                  <span style={{ color: '#64748b' }}>Customer:</span>
                  <strong>{selectedOrderForRefund.customer?.fullName}</strong>
                </div>

                <div className={styles.refundSummaryRow}>
                  <span style={{ color: '#64748b' }}>Customer Email:</span>
                  <span>{selectedOrderForRefund.customer?.email}</span>
                </div>

                <div className={styles.refundSummaryRow}>
                  <span style={{ color: '#64748b' }}>Stripe PaymentIntent:</span>
                  <code style={{ fontSize: '12px' }}>{selectedOrderForRefund.stripePaymentIntentId}</code>
                </div>

                <div
                  className={styles.refundSummaryRow}
                  style={{
                    borderTop: '1px dashed #cbd5e1',
                    paddingTop: '8px',
                    marginTop: '4px',
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>Amount to Refund:</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#635bff' }}>
                    ₹{Number(selectedOrderForRefund.totalAmount || 0).toFixed(2)}{' '}
                    {(selectedOrderForRefund.currency || 'INR').toUpperCase()}
                  </span>
                </div>
              </div>

              {selectedOrderForRefund.refundRequest?.reason && (
                <div style={{ fontSize: '13px', color: '#b45309', background: '#fffbeb', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fde68a' }}>
                  <strong>Customer Reason:</strong> {selectedOrderForRefund.refundRequest.reason}
                </div>
              )}

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '6px',
                  }}
                >
                  Admin Note / Resolution Message
                </label>
                <input
                  type="text"
                  placeholder="e.g. Refund approved for damaged product"
                  value={adminRefundNotes}
                  onChange={(e) => setAdminRefundNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '13.5px',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setSelectedOrderForRefund(null)}
                className={styles.cancelBtn}
                disabled={isProcessingRefund}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmStripeRefund}
                className={styles.confirmRefundBtn}
                disabled={isProcessingRefund}
              >
                {isProcessingRefund ? (
                  <>
                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                    <span>Processing with Stripe...</span>
                  </>
                ) : (
                  <>
                    <span>Confirm Stripe Refund</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Decline Request Modal */}
      {selectedOrderForDecline && (
        <div
          className={styles.modalOverlay}
          onClick={() => !isProcessingDecline && setSelectedOrderForDecline(null)}
        >
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <span style={{ color: '#dc2626' }}>✕</span>
                <span>Decline Refund Request</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderForDecline(null)}
                className={styles.modalClose}
                disabled={isProcessingDecline}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <p style={{ margin: 0, fontSize: '13.5px', color: '#475569', lineHeight: 1.5 }}>
                You are about to decline the refund request for Order #{selectedOrderForDecline._id.substring(selectedOrderForDecline._id.length - 8).toUpperCase()}.
                The customer will be notified via email.
              </p>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '6px',
                  }}
                >
                  Reason for Declining (Optional feedback for customer)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Return window expired, or item confirmed delivered in good condition..."
                  value={adminDeclineNotes}
                  onChange={(e) => setAdminDeclineNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '13.5px',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setSelectedOrderForDecline(null)}
                className={styles.cancelBtn}
                disabled={isProcessingDecline}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmDeclineRefund}
                className={styles.confirmDeclineBtn}
                disabled={isProcessingDecline}
              >
                {isProcessingDecline ? 'Declining...' : 'Decline Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Delivery Partner Location Update Modal */}
      {selectedOrderForLocation && (
        <div
          className={styles.modalOverlay}
          onClick={() => !isSendingLocation && setSelectedOrderForLocation(null)}
        >
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <span style={{ fontSize: '20px' }}>🛵</span>
                <span>Update Delivery Partner Location</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderForLocation(null)}
                className={styles.modalCloseBtn}
                disabled={isSendingLocation}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalAlertNotice} style={{ background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>
                <div style={{ fontWeight: 700, marginBottom: '2px' }}>
                  Live Order Room: <code>order_{selectedOrderForLocation._id}</code>
                </div>
                <div style={{ fontSize: '12px' }}>
                  Broadcasting coordinates converts them to GeoJSON <code>Point [lng, lat]</code>, updates MongoDB, and moves the delivery partner marker on the customer map in real time without page reload.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Latitude (-90 to 90)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={locLatitude}
                    onChange={(e) => setLocLatitude(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      fontSize: '13.5px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Longitude (-180 to 180)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={locLongitude}
                    onChange={(e) => setLocLongitude(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      fontSize: '13.5px',
                    }}
                  />
                </div>
              </div>

              {/* Quick simulation route steps towards customer destination */}
              <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Route Steps:</span>
                <button
                  type="button"
                  onClick={() => {
                    let dLat = Number(selectedOrderForLocation.deliveryCoordinates?.latitude);
                    let dLng = Number(selectedOrderForLocation.deliveryCoordinates?.longitude);
                    if (!dLat || !dLng || isNaN(dLat) || Math.abs(dLat) < 1) {
                      const addr = (selectedOrderForLocation.customer?.shippingAddress?.address || '').toLowerCase();
                      if (addr.includes('phase 7') || addr.includes('sector 60')) {
                        dLat = 30.7094;
                        dLng = 76.7131;
                      } else {
                        dLat = 30.7188;
                        dLng = 76.7299;
                      }
                    }
                    setLocLatitude((dLat - 0.0120).toFixed(4));
                    setLocLongitude((dLng - 0.0110).toFixed(4));
                  }}
                  style={{ fontSize: '11.5px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}
                >
                  🏪 1. Store Hub
                </button>
                <button
                  type="button"
                  onClick={() => {
                    let dLat = Number(selectedOrderForLocation.deliveryCoordinates?.latitude);
                    let dLng = Number(selectedOrderForLocation.deliveryCoordinates?.longitude);
                    if (!dLat || !dLng || isNaN(dLat) || Math.abs(dLat) < 1) {
                      const addr = (selectedOrderForLocation.customer?.shippingAddress?.address || '').toLowerCase();
                      if (addr.includes('phase 7') || addr.includes('sector 60')) {
                        dLat = 30.7094;
                        dLng = 76.7131;
                      } else {
                        dLat = 30.7188;
                        dLng = 76.7299;
                      }
                    }
                    setLocLatitude((dLat - 0.0060).toFixed(4));
                    setLocLongitude((dLng - 0.0055).toFixed(4));
                  }}
                  style={{ fontSize: '11.5px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}
                >
                  📍 2. Midway (50%)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    let dLat = Number(selectedOrderForLocation.deliveryCoordinates?.latitude);
                    let dLng = Number(selectedOrderForLocation.deliveryCoordinates?.longitude);
                    if (!dLat || !dLng || isNaN(dLat) || Math.abs(dLat) < 1) {
                      const addr = (selectedOrderForLocation.customer?.shippingAddress?.address || '').toLowerCase();
                      if (addr.includes('phase 7') || addr.includes('sector 60')) {
                        dLat = 30.7094;
                        dLng = 76.7131;
                      } else {
                        dLat = 30.7188;
                        dLng = 76.7299;
                      }
                    }
                    setLocLatitude(dLat.toFixed(4));
                    setLocLongitude(dLng.toFixed(4));
                  }}
                  style={{ fontSize: '11.5px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #86efac', background: '#f0fdf4', color: '#166534', cursor: 'pointer', fontWeight: 700 }}
                >
                  🏠 3. Doorstep (100%)
                </button>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setSelectedOrderForLocation(null)}
                className={styles.cancelBtn}
                disabled={isSendingLocation}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!socket) {
                    if (triggerToast) triggerToast('Socket connection not ready', 'error');
                    return;
                  }
                  setIsSendingLocation(true);
                  const lat = Number(locLatitude);
                  const lng = Number(locLongitude);
                  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    if (triggerToast) triggerToast('Invalid coordinates: Latitude [-90, 90], Longitude [-180, 180]', 'error');
                    setIsSendingLocation(false);
                    return;
                  }

                  socket.emit(
                    'updateDeliveryLocation',
                    {
                      orderId: selectedOrderForLocation._id,
                      latitude: lat,
                      longitude: lng,
                      isSimulator: true,
                    },
                    (ack) => {
                      setIsSendingLocation(false);
                      if (ack?.success) {
                        if (triggerToast) {
                          triggerToast(
                            `Live location broadcasted for #${selectedOrderForLocation._id.substring(selectedOrderForLocation._id.length - 6).toUpperCase()} (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
                            'success'
                          );
                        }
                        setSelectedOrderForLocation(null);
                        fetchRefundOrders();
                      } else {
                        if (triggerToast) triggerToast(ack?.message || 'Failed to update location', 'error');
                      }
                    }
                  );
                }}
                className={styles.confirmRefundBtn}
                disabled={isSendingLocation}
                style={{ background: '#16a34a', borderColor: '#15803d' }}
              >
                {isSendingLocation ? 'Broadcasting...' : '📡 Broadcast Location via Socket.IO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
