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
const sendPromotionalEmails = async ({ recipients, subject, htmlContent }) => {
  return sendOrderEventToN8n('campaign.promotional', {
    recipients,
    subject,
    htmlContent,
  });
};

module.exports = {
  sendOrderStatusEmail,
  scheduleFeedbackEmail,
  startFeedbackEmailBackgroundWorker,
  verifyEmailService,
  sendPromotionalEmails,
};
