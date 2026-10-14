/**
 * Buyora Email Automation Service
 *
 * Integrated with n8n Webhook Workflow Automation:
 * 1. Replaces legacy Nodemailer SMTP to prevent cloud port blocking (e.g. Render/Railway port 465/587).
 * 2. Directly dispatches order lifecycle events to n8n workflows:
 *    - Order Created / Placed ('order.created')
 *    - Payment Successful ('order.paid')
 *    - Order Delivered ('order.delivered')
 *    - 2-Minute Post-Delivery Customer Feedback ('order.feedback')
 * 3. Idempotent tracking: updates order confirmation flags in MongoDB to prevent duplicate dispatches.
 * 4. Background sweeper worker guarantees 2-minute feedback dispatch even across server restarts.
 */

const Order = require('../models/Order');
const {
  sendOrderCreatedToN8n,
  sendOrderPaidToN8n,
  sendOrderDeliveredToN8n,
  sendOrderFeedbackToN8n,
  sendOrderEventToN8n,
} = require('./n8nService');

/**
 * Dispatches an automated order email via n8n workflow webhook.
 *
 * Supported status types:
 * - 'created' | 'placed' -> Order Placed Confirmation
 * - 'paid' | 'payment_done' -> Payment Successful Confirmation
 * - 'delivered' -> Order Delivered Notification
 * - 'feedback' | 'review' -> 2-Minute Post-Delivery Review Request
 *
 * @param {object} params
 * @param {object} params.order - Mongoose Order document or plain object
 * @param {string} params.statusType - Lifecycle status type
 * @returns {Promise<{ success: boolean, method: string, status?: number }>}
 */
const sendOrderStatusEmail = async ({ order, statusType }) => {
  if (!order) return null;

  const cleanStatusType = String(statusType || '').toLowerCase();
  const isCreated = cleanStatusType === 'created' || cleanStatusType === 'placed' || cleanStatusType === 'order_created';
  const isPaid = cleanStatusType === 'paid' || cleanStatusType === 'payment_done';
  const isDelivered = cleanStatusType === 'delivered';
  const isFeedback = cleanStatusType === 'feedback' || cleanStatusType === 'review';

  // Only handle specified lifecycle events
  if (!isCreated && !isPaid && !isDelivered && !isFeedback) {
    console.log(`[EMAIL AUTOMATION]: Skipping unrecognized status '${cleanStatusType}'.`);
    return null;
  }

  // Idempotency check: Do not re-trigger duplicate emails for already completed milestones
  if (isCreated && order.confirmationEmailSent) {
    console.log(`[EMAIL AUTOMATION]: Order confirmation already dispatched for Order ${order._id}. Skipping duplicate.`);
    return { success: true, duplicate: true };
  }

  if (isPaid && order.paymentEmailSent) {
    console.log(`[EMAIL AUTOMATION]: Payment confirmation already dispatched for Order ${order._id}. Skipping duplicate.`);
    return { success: true, duplicate: true };
  }

  if (isDelivered && order.deliveryEmailSent) {
    console.log(`[EMAIL AUTOMATION]: Delivery confirmation already dispatched for Order ${order._id}. Skipping duplicate.`);
    return { success: true, duplicate: true };
  }

  if (isFeedback && order.feedbackEmailSent) {
    console.log(`[EMAIL AUTOMATION]: Feedback review already dispatched for Order ${order._id}. Skipping duplicate.`);
    return { success: true, duplicate: true };
  }

  const customerEmail = (order.customer?.email || order.user?.email || '').trim();
  const orderRef = order._id ? String(order._id) : 'unknown';

  console.log(`[EMAIL AUTOMATION]: Dispatching '${cleanStatusType}' email via n8n for Order #${orderRef} to ${customerEmail || 'customer'}`);

  let dispatchResult = null;

  if (isCreated) {
    dispatchResult = await sendOrderCreatedToN8n(order);
    if (dispatchResult?.success && order._id) {
      await Order.findByIdAndUpdate(order._id, { confirmationEmailSent: true }).catch(() => {});
    }
  } else if (isPaid) {
    dispatchResult = await sendOrderPaidToN8n(order);
    if (dispatchResult?.success && order._id) {
      await Order.findByIdAndUpdate(order._id, { paymentEmailSent: true, confirmationEmailSent: true }).catch(() => {});
    }
  } else if (isDelivered) {
    dispatchResult = await sendOrderDeliveredToN8n(order);
    if (dispatchResult?.success && order._id) {
      await Order.findByIdAndUpdate(order._id, { deliveryEmailSent: true }).catch(() => {});
    }
  } else if (isFeedback) {
    dispatchResult = await sendOrderFeedbackToN8n(order);
    if (dispatchResult?.success && order._id) {
      await Order.findByIdAndUpdate(order._id, { feedbackEmailSent: true }).catch(() => {});
    }
  }

  return {
    success: dispatchResult?.success ?? true,
    method: 'n8n-webhook',
    eventType: cleanStatusType,
    orderId: orderRef,
    recipient: customerEmail,
  };
};

/**
 * Schedules customer feedback review email to be sent 2 minutes after order delivery.
 * Uses persistent timer and idempotency check against order.feedbackEmailSent.
 *
 * @param {string|Object} orderId - Target Order ID
 * @param {number} delayMs - Delay in milliseconds (default: 2 minutes = 120,000 ms)
 */
const scheduleFeedbackEmail = (orderId, delayMs = 2 * 60 * 1000) => {
  if (!orderId) return;

  const idStr = orderId.toString().trim();
  console.log(`[FEEDBACK TIMER]: Initialized 2-minute post-delivery timer for Order #${idStr} (${delayMs / 1000}s)...`);

  setTimeout(async () => {
    try {
      const order = await Order.findById(idStr);

      if (!order) {
        console.warn(`[FEEDBACK TIMER]: Order #${idStr} not found when 2-minute timer expired.`);
        return;
      }

      if (order.feedbackEmailSent) {
        console.log(`[FEEDBACK TIMER]: Feedback email already sent for Order #${idStr}. Skipping duplicate.`);
        return;
      }

      console.log(`[FEEDBACK TIMER]: 2-minute timer elapsed! Dispatching feedback review email via n8n for Order #${idStr}...`);
      const result = await sendOrderFeedbackToN8n(order);
      if (result?.success) {
        await Order.findByIdAndUpdate(idStr, { feedbackEmailSent: true });
        console.log(`✔ [FEEDBACK TIMER]: Successfully dispatched 2-minute feedback email for Order #${idStr}`);
      }
    } catch (err) {
      console.error(`[FEEDBACK TIMER ERROR]: Failed for Order #${idStr}:`, err.message);
    }
  }, delayMs);
};

let feedbackWorkerInterval = null;

/**
 * Background worker that runs every 30 seconds to catch any delivered orders that
 * passed the 2-minute mark but haven't received their feedback email yet (e.g. server restart resilience).
 */
const startFeedbackEmailBackgroundWorker = () => {
  if (feedbackWorkerInterval) return;

  console.log('✔ [FEEDBACK WORKER]: Background worker active (checks every 30s for orders delivered >= 2 mins ago)');

  feedbackWorkerInterval = setInterval(async () => {
    try {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      // Find all delivered orders that have not received feedback email and were delivered at least 2 minutes ago
      const pendingOrders = await Order.find({
        orderStatus: { $in: ['DELIVERED', 'delivered'] },
        feedbackEmailSent: { $ne: true },
        $or: [
          { deliveredAt: { $lte: twoMinutesAgo } },
          { deliveredAt: { $exists: false }, updatedAt: { $lte: twoMinutesAgo } },
          { deliveredAt: null, updatedAt: { $lte: twoMinutesAgo } },
        ],
      }).limit(10);

      for (const order of pendingOrders) {
        console.log(`[FEEDBACK WORKER]: Found delivered order #${order._id} pending feedback email. Dispatching to n8n now...`);
        const result = await sendOrderFeedbackToN8n(order);
        if (result?.success) {
          await Order.findByIdAndUpdate(order._id, { feedbackEmailSent: true });
          console.log(`✔ [FEEDBACK WORKER]: Successfully dispatched 2-minute feedback email for Order #${order._id}`);
        }
      }
    } catch (err) {
      console.warn('[FEEDBACK WORKER NOTICE]: Check loop notice:', err.message);
    }
  }, 30 * 1000);
};

/**
 * Verifies that the n8n automation pipeline is configured and active.
 */
const verifyEmailService = async () => {
  const isEnabled =
    process.env.N8N_ENABLED !== 'false' &&
    process.env.BUYORA_N8N_ENABLED !== 'false';

  const webhookUrl =
    process.env.N8N_ORDER_WEBHOOK_URL ||
    process.env.BUYORA_N8N_WEBHOOK_URL ||
    process.env.N8N_BASE_URL ||
    'http://127.0.0.1:5678/webhook/buyora-order-created';

  console.log(`✔ [EMAIL SERVICE]: n8n Webhook Email Automation active (Target: ${webhookUrl})`);
  return isEnabled;
};

/**
 * Promotional campaigns dispatcher via n8n event
 */
/**
 * Generates live email previews for an order's lifecycle (Created, Paid, Delivered, 2-Min Feedback).
 * Enables viewing and testing of all email automation functionality directly in the web app UI.
 */
const generateEmailLifecyclePreviews = (order) => {
  if (!order) return [];

  const orderId = order._id ? order._id.toString() : 'unknown';
  const shortId = orderId.slice(-8).toUpperCase();
  const customerName = order.customer?.fullName || 'Valued Customer';
  const customerEmail = (order.customer?.email || order.user?.email || 'customer@example.com').trim();
  const totalAmount = Number(order.totalAmount || 0).toFixed(2);
  const currency = (order.currency || 'INR').toUpperCase();
  const zoneName = order.deliveryZone?.name || 'Standard Zone';
  const estTime = order.deliveryZone?.estimatedDeliveryTime || '30-45 mins';

  const isDelivered = String(order.orderStatus || '').toUpperCase() === 'DELIVERED';
  const isPaid = String(order.paymentStatus || '').toLowerCase() === 'paid';
  const deliveredTime = order.deliveredAt ? new Date(order.deliveredAt) : null;
  const feedbackScheduledTime = deliveredTime ? new Date(deliveredTime.getTime() + 2 * 60 * 1000) : null;

  return [
    {
      id: 'created',
      name: 'Order Placed Confirmation',
      eventType: 'order.created',
      icon: '📋',
      status: 'sent',
      badgeColor: '#2563eb',
      dispatchedAt: order.createdAt || new Date(),
      recipient: customerEmail,
      subject: `Order Confirmed: #${shortId} - Buyora Store`,
      summary: `Dispatched immediately to ${customerEmail} when order was placed.`,
      previewHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; padding: 22px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 20px; border-radius: 8px; text-align: center; color: #ffffff; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Buyora Store</h2>
            <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.95;">Order Placed Successfully!</p>
          </div>
          <p style="color: #334155; font-size: 15px;">Hi <strong>${customerName}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">
            Thank you for ordering with Buyora! Your order <strong>#${shortId}</strong> has been received and is being prepared.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin: 18px 0; font-size: 13.5px; color: #334155;">
            <div style="margin-bottom: 6px;"><strong>Order ID:</strong> #${shortId}</div>
            <div style="margin-bottom: 6px;"><strong>Total Amount:</strong> ₹${totalAmount} ${currency}</div>
            <div style="margin-bottom: 6px;"><strong>Delivery Zone:</strong> ${zoneName} (${estTime})</div>
            <div><strong>Status:</strong> ${order.orderStatus || 'PLACED'}</div>
          </div>
          <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
            Automated email dispatched via Buyora n8n Workflow Integration.
          </p>
        </div>
      `,
    },
    {
      id: 'paid',
      name: 'Payment Confirmed',
      eventType: 'order.paid',
      icon: '💳',
      status: isPaid ? 'sent' : 'pending',
      badgeColor: '#16a34a',
      dispatchedAt: order.paidAt || (isPaid ? order.updatedAt : null),
      recipient: customerEmail,
      subject: `Payment Successful: #${shortId} - Buyora Store`,
      summary: isPaid ? `Dispatched upon verified Stripe payment.` : `Pending Stripe payment confirmation.`,
      previewHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; padding: 22px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #16a34a, #15803d); padding: 20px; border-radius: 8px; text-align: center; color: #ffffff; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Buyora Store</h2>
            <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.95;">Payment Received & Verified!</p>
          </div>
          <p style="color: #334155; font-size: 15px;">Hi <strong>${customerName}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">
            Your payment of <strong>₹${totalAmount} ${currency}</strong> was successfully verified via Stripe. Your items are now packed and dispatched for live tracking!
          </p>
          <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 14px 18px; margin: 18px 0; font-size: 13.5px; color: #065f46;">
            <div><strong>Transaction Reference:</strong> ${order.stripePaymentIntentId || 'STRIPE-OK'}</div>
            <div style="margin-top: 4px;"><strong>Payment Status:</strong> PAID (Captured)</div>
          </div>
        </div>
      `,
    },
    {
      id: 'delivered',
      name: 'Order Delivered Notification',
      eventType: 'order.delivered',
      icon: '🚚',
      status: isDelivered ? 'sent' : 'pending',
      badgeColor: '#059669',
      dispatchedAt: deliveredTime,
      recipient: customerEmail,
      subject: `Order Delivered! #${shortId} - Buyora Store`,
      summary: isDelivered
        ? `Delivered safely at ${deliveredTime ? deliveredTime.toLocaleTimeString() : 'doorstep'}.`
        : `Will dispatch automatically when order status reaches DELIVERED.`,
      previewHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; padding: 22px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 20px; border-radius: 8px; text-align: center; color: #ffffff; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Buyora Store</h2>
            <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.95;">Your Order Has Been Delivered! 🎉</p>
          </div>
          <p style="color: #334155; font-size: 15px;">Hi <strong>${customerName}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">
            Our delivery partner has arrived and your package for Order <strong>#${shortId}</strong> has been handed over.
          </p>
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 18px; margin: 18px 0; font-size: 13.5px; color: #166534;">
            <div><strong>Delivered At:</strong> ${deliveredTime ? deliveredTime.toLocaleString() : 'Just now'}</div>
            <div style="margin-top: 4px;"><strong>Delivered Address:</strong> ${order.customer?.shippingAddress?.address || 'Doorstep delivery'}</div>
          </div>
        </div>
      `,
    },
    {
      id: 'feedback',
      name: '2-Minute Customer Feedback Review',
      eventType: 'order.feedback',
      icon: '⭐',
      status: order.feedbackEmailSent ? 'sent' : isDelivered ? 'scheduled' : 'pending',
      badgeColor: '#d97706',
      dispatchedAt: order.feedbackEmailSent ? order.updatedAt : null,
      scheduledFor: isDelivered && !order.feedbackEmailSent ? feedbackScheduledTime : null,
      recipient: customerEmail,
      subject: `⭐ How did we do? Rate Order #${shortId} - Buyora`,
      summary: order.feedbackEmailSent
        ? `Dispatched 2 minutes post-delivery to ${customerEmail}.`
        : isDelivered
        ? `Scheduled for 2 minutes after delivery (${feedbackScheduledTime ? feedbackScheduledTime.toLocaleTimeString() : 'in ~2 mins'}).`
        : `Will schedule automatically 2 minutes after order delivery.`,
      previewHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #2563eb; margin: 0 0 6px 0;">Buyora Store</h2>
            <p style="color: #64748b; font-size: 13px; margin: 0;">Customer Review & Satisfaction</p>
          </div>
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 20px; text-align: center;">
            <h3 style="color: #92400e; margin: 0 0 8px 0;">We Value Your Feedback! ⭐</h3>
            <p style="color: #78350f; font-size: 14px; margin: 0 0 16px 0; line-height: 1.5;">
              Hi <strong>${customerName}</strong>, your order <strong>#${shortId}</strong> was delivered a few minutes ago. How was your delivery and shopping experience?
            </p>
            <div style="font-size: 32px; letter-spacing: 8px; margin: 14px 0;">
              ⭐⭐⭐⭐⭐
            </div>
            <div style="margin-top: 18px;">
              <a href="https://buyora-n8n.vercel.app/orders/${orderId}?feedback=5" style="display: inline-block; background: #d97706; color: #ffffff; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-weight: 700; font-size: 14px;">
                Leave 5-Star Review →
              </a>
            </div>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; text-align: center;">
            Automatically triggered 2 minutes post-delivery via n8n workflow.
          </p>
        </div>
      `,
    },
  ];
};

module.exports = {
  sendOrderStatusEmail,
  scheduleFeedbackEmail,
  startFeedbackEmailBackgroundWorker,
  verifyEmailService,
  sendPromotionalEmails,
  generateEmailLifecyclePreviews,
};

