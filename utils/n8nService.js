/**
 * n8n Integration Service for Buyora Backend
 *
 * Requirements & Security Standards:
 * 1. Reads n8n Webhook Production URL from N8N_ORDER_WEBHOOK_URL environment variable.
 * 2. Formats and sends only minimal, sanitized order details (no passwords, tokens, or card numbers).
 * 3. Asynchronous & Non-blocking: failures never disrupt customer checkout or DB transactions.
 * 4. Safe logging that protects sensitive customer and payment secrets.
 */

/**
 * Extracts only safe, minimal order details required for workflow automation.
 * Strips all sensitive database internals, auth tokens, passwords, and raw Stripe details.
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

  return {
    orderId,
    orderStatus: order.orderStatus || 'pending',
    paymentStatus: order.paymentStatus || 'pending',
    totalAmount: Number(order.totalAmount || 0),
    currency: String(order.currency || 'inr').toUpperCase(),
    itemsCount: items.length,
    items,
    customer: {
      fullName: order.customer?.fullName || 'Customer',
      email: order.customer?.email || '',
    },
    delivery: {
      zoneName: order.deliveryZone?.name || 'Standard Delivery',
      deliveryCharge: Number(order.deliveryCharge || 0),
      estimatedDeliveryTime: order.deliveryZone?.estimatedDeliveryTime || '30-45 mins',
    },
    createdAt: order.createdAt || new Date().toISOString(),
  };
}

/**
 * Sends a sanitized order event to the configured n8n Webhook URL.
 *
 * @param {string} eventType - Event identifier, e.g., 'order.created' or 'order.paid'
 * @param {object} order - Mongoose Order document
 * @returns {Promise<{ success: boolean, status?: number, error?: string }>}
 */
async function sendOrderEventToN8n(eventType, order) {
  try {
    // 1. Read URL from N8N_ORDER_WEBHOOK_URL (with fallback to BUYORA_N8N_WEBHOOK_URL)
    const webhookUrl =
      process.env.N8N_ORDER_WEBHOOK_URL ||
      process.env.BUYORA_N8N_WEBHOOK_URL;

    // Check if integration is explicitly enabled or disabled
    const isEnabled =
      process.env.N8N_ENABLED !== 'false' &&
      process.env.BUYORA_N8N_ENABLED !== 'false';

    if (!isEnabled || !webhookUrl) {
      // Integration is not configured or disabled; skip quietly without error
      return { success: false, reason: 'N8N_NOT_CONFIGURED_OR_DISABLED' };
    }

    // 2. Prepare sanitized payload (Never includes secrets, tokens, or raw card data)
    const sanitizedOrder = sanitizeOrderData(order);
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      source: 'buyora-ecommerce',
      data: sanitizedOrder,
    };

    // 3. Dispatch with retry loop (up to 2 retries on transient network errors)
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-buyora-source': 'buyora-backend',
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
            `[n8n Integration] Webhook returned HTTP ${response.status} for order ${sanitizedOrder.orderId}`
          );
          return { success: false, status: response.status };
        }

        // Safe log: logs only order ID and status, no private customer data
        console.log(
          `✔ [n8n Integration] Dispatched '${eventType}' for Order #${sanitizedOrder.orderId} (Status: ${response.status})`
        );
        return { success: true, status: response.status };
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          // Wait briefly before retrying (exponential backoff: 500ms, 1000ms)
          await new Promise((res) => setTimeout(res, attempt * 500));
        }
      }
    }

    // Safe error handling after retries: never crashes server, never interrupts checkout
    const orderRef = order?._id ? String(order._id) : 'unknown';
    if (lastError?.name === 'AbortError') {
      console.warn(`[n8n Integration] Timeout sending '${eventType}' for order ${orderRef} (exceeded 5000ms)`);
    } else {
      console.warn(`[n8n Integration] Notice: Could not reach n8n webhook for order ${orderRef}: ${lastError?.message || 'Unknown error'}`);
    }
    return { success: false, error: lastError?.message || 'Network error' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Triggers n8n workflow for newly created order (called after MongoDB save).
 */
const sendOrderCreatedToN8n = async (order) => {
  return sendOrderEventToN8n('order.created', order);
};

/**
 * Triggers n8n workflow for paid order (called after payment confirmed & stock deducted).
 */
const sendOrderPaidToN8n = async (order) => {
  return sendOrderEventToN8n('order.paid', order);
};

/**
 * Generic helper for custom events.
 */
const triggerN8nEvent = async (eventName, payload = {}) => {
  return sendOrderEventToN8n(eventName, payload);
};

module.exports = {
  sanitizeOrderData,
  sendOrderEventToN8n,
  sendOrderCreatedToN8n,
  sendOrderPaidToN8n,
  triggerN8nEvent,
};
