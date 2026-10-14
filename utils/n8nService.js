/**
 * n8n Integration Service for Buyora Backend
 *
 * Requirements & Standards:
 * 1. Dispatches automated order events to n8n Webhook workflows.
 * 2. Formats safe, sanitized order details (no passwords, tokens, or card numbers).
 * 3. Dynamic event routing: targets specific webhook endpoints for created, paid, delivered, and feedback.
 * 4. Asynchronous & Non-blocking: network issues never disrupt customer checkout or DB transactions.
 */

/**
 * Extracts clean, safe order details required for workflow automation and email templates.
 * Strips all internal database secrets, auth tokens, passwords, and raw Stripe keys.
 *
 * @param {object} order - Mongoose Order document or plain object
 * @returns {object} Sanitized order summary
 */
function sanitizeOrderData(order) {
  if (!order) return {};

  const orderId = order._id ? order._id.toString() : order.id || 'unknown';

  const items = Array.isArray(order.orderItems)
    ? order.orderItems.map((item) => ({
        productId: item.productId ? item.productId.toString() : undefined,
        title: item.title || 'Product',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 1),
        subtotal: Number(item.subtotal || item.price * item.quantity || 0),
      }))
    : [];

  const customerName = order.customer?.fullName || order.user?.name || 'Valued Customer';
  const customerEmail = order.customer?.email || order.user?.email || '';

  return {
    orderId,
    orderShortId: orderId.slice(-8).toUpperCase(),
    orderStatus: String(order.orderStatus || 'pending').toUpperCase(),
    paymentStatus: String(order.paymentStatus || 'pending').toLowerCase(),
    totalAmount: Number(order.totalAmount || 0),
    currency: String(order.currency || 'INR').toUpperCase(),
    itemsCount: items.length,
    items,
    customer: {
      fullName: customerName,
      email: customerEmail,
      phone: order.customer?.phone || '',
      shippingAddress: order.customer?.shippingAddress || {},
    },
    delivery: {
      zoneName: order.deliveryZone?.name || 'Standard Delivery',
      deliveryCharge: Number(order.deliveryCharge || 0),
      estimatedDeliveryTime: order.deliveryZone?.estimatedDeliveryTime || '30-45 mins',
    },
    createdAt: order.createdAt || new Date().toISOString(),
    paidAt: order.paidAt || null,
    deliveredAt: order.deliveredAt || null,
  };
}

/**
 * Resolves the appropriate n8n Webhook URL for each lifecycle event.
 * Allows fine-grained per-event endpoints with graceful fallbacks.
 *
 * @param {string} eventType - e.g. 'order.created', 'order.paid', 'order.delivered', 'order.feedback'
 * @returns {string} The webhook URL to call
 */
function getWebhookUrlForEvent(eventType) {
  // 1. Direct environment variable override for specific event
  if (eventType === 'order.created' && process.env.N8N_ORDER_CREATED_WEBHOOK_URL) {
    return process.env.N8N_ORDER_CREATED_WEBHOOK_URL;
  }
  if (eventType === 'order.paid' && process.env.N8N_ORDER_PAID_WEBHOOK_URL) {
    return process.env.N8N_ORDER_PAID_WEBHOOK_URL;
  }
  if (eventType === 'order.delivered' && process.env.N8N_ORDER_DELIVERED_WEBHOOK_URL) {
    return process.env.N8N_ORDER_DELIVERED_WEBHOOK_URL;
  }
  if (eventType === 'order.feedback' && process.env.N8N_ORDER_FEEDBACK_WEBHOOK_URL) {
    return process.env.N8N_ORDER_FEEDBACK_WEBHOOK_URL;
  }

  // 2. Base URL path routing if N8N_BASE_URL or N8N_HOST is configured
  const baseUrl = process.env.N8N_BASE_URL || process.env.N8N_HOST;
  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    if (eventType === 'order.delivered') {
      return `${cleanBase}/webhook/buyora-order-delivered`;
    }
    if (eventType === 'order.feedback') {
      return `${cleanBase}/webhook/buyora-order-delivered`;
    }
    return `${cleanBase}/webhook/buyora-order-created`;
  }

  // 3. Fallback to general N8N_ORDER_WEBHOOK_URL or BUYORA_N8N_WEBHOOK_URL
  const generalUrl = process.env.N8N_ORDER_WEBHOOK_URL || process.env.BUYORA_N8N_WEBHOOK_URL;
  if (generalUrl) {
    // If event is order.delivered or order.feedback and generalUrl ends with buyora-order-created, swap endpoint
    if ((eventType === 'order.delivered' || eventType === 'order.feedback') && generalUrl.includes('buyora-order-created')) {
      return generalUrl.replace('buyora-order-created', 'buyora-order-delivered');
    }
    return generalUrl;
  }

  // 4. Default local development webhook URL
  return eventType === 'order.delivered' || eventType === 'order.feedback'
    ? 'http://127.0.0.1:5678/webhook/buyora-order-delivered'
    : 'http://127.0.0.1:5678/webhook/buyora-order-created';
}

/**
 * Sends a sanitized order event to the configured n8n Webhook URL.
 *
 * @param {string} eventType - Event identifier: 'order.created', 'order.paid', 'order.delivered', 'order.feedback'
 * @param {object} order - Mongoose Order document or plain object
 * @returns {Promise<{ success: boolean, status?: number, error?: string }>}
 */
async function sendOrderEventToN8n(eventType, order) {
  try {
    const isEnabled =
      process.env.N8N_ENABLED !== 'false' &&
      process.env.BUYORA_N8N_ENABLED !== 'false';

    if (!isEnabled) {
      console.log(`[n8n Integration] Skipped '${eventType}' (N8N integration explicitly disabled).`);
      return { success: false, reason: 'N8N_DISABLED' };
    }

    const webhookUrl = getWebhookUrlForEvent(eventType);
    if (!webhookUrl) {
      return { success: false, reason: 'N8N_NO_URL_CONFIGURED' };
    }

    // Prepare sanitized payload: structure satisfies both `$json.body.data` and root `$json.body` expressions
    const sanitizedOrder = sanitizeOrderData(order);
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      source: 'buyora-ecommerce',
      // Top-level aliases for easy direct node mapping in n8n
      orderId: sanitizedOrder.orderId,
      orderShortId: sanitizedOrder.orderShortId,
      orderStatus: sanitizedOrder.orderStatus,
      paymentStatus: sanitizedOrder.paymentStatus,
      customerEmail: sanitizedOrder.customer.email,
      customerName: sanitizedOrder.customer.fullName,
      totalAmount: sanitizedOrder.totalAmount,
      currency: sanitizedOrder.currency,
      // Nested data payload expected by buyora-order-confirmation.json and buyora-feedback-email.json
      data: sanitizedOrder,
    };

    // Dispatch with retry loop (up to 2 retries on transient network errors)
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-buyora-source': 'buyora-backend',
            'x-buyora-event': eventType,
            ...((process.env.N8N_SECRET_KEY || process.env.BUYORA_N8N_SECRET_KEY) && {
              'x-buyora-secret': process.env.N8N_SECRET_KEY || process.env.BUYORA_N8N_SECRET_KEY,
            }),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.warn(
            `[n8n Integration] Webhook returned HTTP ${response.status} for event '${eventType}' on Order #${sanitizedOrder.orderId} (URL: ${webhookUrl})`
          );
          return { success: false, status: response.status };
        }

        console.log(
          `✔ [n8n Integration] Successfully dispatched '${eventType}' to n8n for Order #${sanitizedOrder.orderId} (Status: ${response.status})`
        );
        return { success: true, status: response.status };
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, attempt * 500));
        }
      }
    }

    const orderRef = order?._id ? String(order._id) : sanitizedOrder.orderId || 'unknown';
    if (lastError?.name === 'AbortError') {
      console.warn(`[n8n Integration] Timeout sending '${eventType}' for Order #${orderRef} to ${webhookUrl} (exceeded 6000ms)`);
    } else {
      console.warn(`[n8n Integration] Notice: Webhook endpoint (${webhookUrl}) unreachable for Order #${orderRef}: ${lastError?.message || 'Connection refused'}`);
    }
    return { success: false, error: lastError?.message || 'Network error' };
  } catch (err) {
    console.warn(`[n8n Integration] Handler error for '${eventType}':`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Triggers n8n workflow for order created / placed.
 */
const sendOrderCreatedToN8n = async (order) => {
  return sendOrderEventToN8n('order.created', order);
};

/**
 * Triggers n8n workflow for payment confirmed.
 */
const sendOrderPaidToN8n = async (order) => {
  return sendOrderEventToN8n('order.paid', order);
};

/**
 * Triggers n8n workflow for order delivered.
 */
const sendOrderDeliveredToN8n = async (order) => {
  return sendOrderEventToN8n('order.delivered', order);
};

/**
 * Triggers n8n workflow for customer feedback review request (2 minutes post-delivery).
 */
const sendOrderFeedbackToN8n = async (order) => {
  return sendOrderEventToN8n('order.feedback', order);
};

/**
 * Generic helper for custom events.
 */
const triggerN8nEvent = async (eventName, payload = {}) => {
  return sendOrderEventToN8n(eventName, payload);
};

module.exports = {
  sanitizeOrderData,
  getWebhookUrlForEvent,
  sendOrderEventToN8n,
  sendOrderCreatedToN8n,
  sendOrderPaidToN8n,
  sendOrderDeliveredToN8n,
  sendOrderFeedbackToN8n,
  triggerN8nEvent,
};
