const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const stripe = require('../config/stripe');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { optionalAuth, authenticateUser } = require('../middleware/authMiddleware');
const { sendOrderStatusEmail, scheduleFeedbackEmail } = require('../utils/emailService');
const { emitOrderUpdate } = require('../config/socket');
const { sendOrderCreatedToN8n, sendOrderPaidToN8n } = require('../utils/n8nService');

/**
 * Helper to validate MongoDB ObjectId
 */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * GET /api/payments/config
 * Public configuration endpoint for frontend Stripe setup
 * Never returns the secret key.
 */
router.get('/config', (req, res) => {
  res.status(200).json({
    success: true,
    currency: 'inr',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    isStripeConfigured: Boolean(
      process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_SECRET_KEY.startsWith('sk_') &&
      !process.env.STRIPE_SECRET_KEY.includes('placeholder')
    ),
  });
});

/**
 * POST /api/payments/create-payment-intent
 *
 * Requirements & Security:
 * 1. Do NOT trust client-submitted prices.
 * 2. Receive product IDs and quantities from cart/order payload.
 * 3. Fetch actual products from MongoDB.
 * 4. Verify products exist, are active, and have sufficient stock.
 * 5. Read actual prices directly from MongoDB.
 * 6. Calculate subtotal = database price × quantity.
 * 7. Calculate order total = sum of all product subtotals.
 * 8. Create Stripe PaymentIntent with server-calculated integer amount (in cents).
 * 9. Create pending Order record in MongoDB linked to Stripe PaymentIntent ID.
 * 10. Return only clientSecret and order verification details needed by frontend.
 * 11. Never return secret keys, database credentials, or server internals.
 */
router.post('/create-payment-intent', optionalAuth, async (req, res) => {
  try {
    const { items, customer, currency = 'inr' } = req.body;

    // 1. Validate customer object
    if (!customer || !customer.fullName || !customer.email || !customer.shippingAddress) {
      return res.status(400).json({
        success: false,
        message: 'Complete customer contact and shipping information is required.',
      });
    }

    // 2. Validate that items array is provided and not empty
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your cart is empty. Please provide at least one product item to proceed with payment.',
      });
    }

    // 3. Iterate through items and fetch actual products from MongoDB
    const validatedItems = [];
    let calculatedOrderTotal = 0;
    let totalQuantity = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const productId = item.productId || item._id || item.id;
      const rawQty = item.quantity;

      // 3a. Validate quantity
      const quantity = Number(rawQty);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for item index ${i}. Quantity must be a positive whole integer greater than zero.`,
        });
      }

      // 3b. Validate Product ID format
      if (!productId || !isValidObjectId(productId)) {
        return res.status(400).json({
          success: false,
          message: `Invalid product ID format provided: '${productId || 'undefined'}'.`,
        });
      }

      // 3c. Fetch real product from MongoDB database
      const dbProduct = await Product.findById(productId);

      // Verify product exists
      if (!dbProduct) {
        return res.status(404).json({
          success: false,
          message: `Product with ID '${productId}' was not found in our catalog.`,
        });
      }

      // Verify product is active
      if (dbProduct.status !== 'active') {
        return res.status(400).json({
          success: false,
          message: `Product '${dbProduct.title}' is currently unavailable for purchase (status: ${dbProduct.status}).`,
        });
      }

      // Verify product has sufficient stock
      if (dbProduct.quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Product '${dbProduct.title}' is currently out of stock.`,
        });
      }

      if (quantity > dbProduct.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for '${dbProduct.title}'. Requested: ${quantity}, Available: ${dbProduct.quantity}.`,
        });
      }

      // 3d. Read actual price from MongoDB (NEVER trust frontend price)
      const verifiedDbPrice = Number(dbProduct.price);
      if (isNaN(verifiedDbPrice) || verifiedDbPrice < 0) {
        return res.status(500).json({
          success: false,
          message: `Product '${dbProduct.title}' has an invalid database price.`,
        });
      }

      // Calculate product subtotal = database price × quantity
      const itemSubtotal = Number((verifiedDbPrice * quantity).toFixed(2));
      calculatedOrderTotal += itemSubtotal;
      totalQuantity += quantity;

      validatedItems.push({
        productId: dbProduct._id,
        title: dbProduct.title,
        price: verifiedDbPrice,
        quantity,
        subtotal: itemSubtotal,
        image: dbProduct.image || '',
        category: dbProduct.category || '',
      });
    }

    // 3e. Delivery Zone calculation and serviceability check
    let deliveryCharge = 0;
    let deliveryZoneSnapshot = null;
    const DeliveryZone = require('../models/DeliveryZone');

    const latVal =
      req.body.latitude !== undefined
        ? req.body.latitude
        : req.body.customer?.latitude !== undefined
        ? req.body.customer.latitude
        : req.body.customer?.shippingAddress?.latitude;
    const lngVal =
      req.body.longitude !== undefined
        ? req.body.longitude
        : req.body.customer?.longitude !== undefined
        ? req.body.customer.longitude
        : req.body.customer?.shippingAddress?.longitude;
    const city = (customer.shippingAddress?.city || req.body.customer?.shippingAddress?.city || '').trim();
    const street = (customer.shippingAddress?.address || req.body.customer?.shippingAddress?.address || '').trim();
    const zoneId = req.body.deliveryZone?.zoneId;

    let matchingZones = [];
    const hasValidCoords =
      latVal !== undefined &&
      lngVal !== undefined &&
      String(latVal).trim() !== '' &&
      String(lngVal).trim() !== '' &&
      !isNaN(Number(latVal)) &&
      !isNaN(Number(lngVal));

    if (hasValidCoords) {
      const lat = Number(latVal);
      const lng = Number(lngVal);

      // 1. Strict GeoJSON boundary intersection with active delivery zones
      matchingZones = await DeliveryZone.find({
        status: 'active',
        boundary: {
          $geoIntersects: {
            $geometry: {
              type: 'Point',
              coordinates: [lng, lat],
            },
          },
        },
      });

      // 2. Mohali & Chandigarh coverage boundary & text check
      if (matchingZones.length === 0) {
        const isMohaliOrChandigarhCoords =
          lat >= 30.60 && lat <= 30.82 && lng >= 76.60 && lng <= 76.88;
        const addressMentionsTricity =
          /mohali|chandigarh/i.test(city) || /mohali|chandigarh/i.test(street);

        if (isMohaliOrChandigarhCoords || addressMentionsTricity) {
          const tricityZones = await DeliveryZone.find({
            status: 'active',
            $or: [
              { name: { $regex: /mohali/i } },
              { name: { $regex: /chandigarh/i } },
            ],
          });
          if (tricityZones.length > 0) {
            matchingZones = tricityZones;
          }
        }
      }

      // 3. Stored backend zones / active zones bounding box check
      if (matchingZones.length === 0) {
        const allActiveZones = await DeliveryZone.find({ status: 'active' });
        for (const z of allActiveZones) {
          const ring = z.boundary?.coordinates?.[0] || [];
          if (ring.length > 0) {
            const lats = ring.map((p) => p[1]);
            const lngs = ring.map((p) => p[0]);
            const minLat = Math.min(...lats) - 0.12;
            const maxLat = Math.max(...lats) + 0.12;
            const minLng = Math.min(...lngs) - 0.12;
            const maxLng = Math.max(...lngs) + 0.12;
            if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
              matchingZones = [z];
              break;
            }
          }
        }
      }
    } else if (zoneId && isValidObjectId(zoneId)) {
      const zoneFromId = await DeliveryZone.findOne({ _id: zoneId, status: 'active' });
      if (zoneFromId) {
        matchingZones = [zoneFromId];
      }
    } else {
      // If no coordinates provided, check if city or address is in Mohali or Chandigarh
      const addressMentionsTricity =
        /mohali|chandigarh/i.test(city) || /mohali|chandigarh/i.test(street);
      if (addressMentionsTricity) {
        matchingZones = await DeliveryZone.find({
          status: 'active',
          $or: [
            { name: { $regex: /mohali/i } },
            { name: { $regex: /chandigarh/i } },
          ],
        });
      }
    }

    // SERVICEABILITY VALIDATION:
    // If no matching delivery zone is found, reject checkout immediately
    if (matchingZones.length === 0) {
      return res.status(400).json({
        success: false,
        serviceable: false,
        unreachable: true,
        status: 'service_unreachable',
        message:
          'Service Unreachable: Your delivery location is outside our delivery zones. Delivery is currently only available within Mohali, Chandigarh, and backend configured zones.',
      });
    }

    // Verify product eligibility for zones with restricted assignments
    const hasAllAccess = matchingZones.some((z) => z.assignmentType === 'all');
    if (!hasAllAccess) {
      const eligibleCategories = new Set(
        matchingZones
          .filter((z) => z.assignmentType === 'categories')
          .flatMap((z) => z.assignedCategories || [])
      );
      const eligibleProductIds = new Set(
        matchingZones
          .filter((z) => z.assignmentType === 'products')
          .flatMap((z) => (z.assignedProducts || []).map((id) => id.toString()))
      );

      for (const item of validatedItems) {
        const isCatEligible = item.category && eligibleCategories.has(item.category);
        const isProdEligible = eligibleProductIds.has(item.productId.toString());
        if (!isCatEligible && !isProdEligible && (eligibleCategories.size > 0 || eligibleProductIds.size > 0)) {
          return res.status(400).json({
            success: false,
            message: `Product "${item.title}" is not available for delivery in your selected zone.`,
          });
        }
      }
    }

    // Pick applicable zone (lowest delivery charge in case of overlapping zones)
    const detectedZone = matchingZones.reduce((prev, curr) =>
      curr.deliveryCharge < prev.deliveryCharge ? curr : prev
    );

    deliveryCharge = Number(detectedZone.deliveryCharge) || 0;
    deliveryZoneSnapshot = {
      zoneId: detectedZone._id,
      name: detectedZone.name,
      deliveryCharge,
      estimatedDeliveryTime: detectedZone.estimatedDeliveryTime || '30-45 mins',
    };

    // Minimum order amount validation for the zone
    if (detectedZone.minOrderAmount && calculatedOrderTotal < detectedZone.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount for ${detectedZone.name} is ₹${detectedZone.minOrderAmount.toFixed(
          2
        )}. Current cart subtotal is ₹${calculatedOrderTotal.toFixed(2)}.`,
      });
    }

    // 4. Verify total amount is valid (subtotal + deliveryCharge)
    const productSubtotal = Number(calculatedOrderTotal.toFixed(2));
    const finalOrderTotal = Number((productSubtotal + deliveryCharge).toFixed(2));
    if (finalOrderTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Calculated order total must be greater than ₹0.00.',
      });
    }

    // 5. Stripe currency handling: Convert to integer cents (or paise for INR)
    const amountInCents = Math.round(finalOrderTotal * 100);

    // 6. Check Stripe secret key configuration
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    if (!stripeKey || stripeKey.includes('placeholder')) {
      return res.status(503).json({
        success: false,
        message:
          'Stripe secret key is not configured on the backend server. Please configure a valid STRIPE_SECRET_KEY in the .env file.',
        calculatedSummary: {
          itemsCount: totalQuantity,
          subtotal: productSubtotal,
          shipping: deliveryCharge,
          deliveryCharge,
          deliveryZone: deliveryZoneSnapshot,
          total: finalOrderTotal,
          currency: 'inr',
          amountInCents,
        },
      });
    }

    // 7. Create Stripe PaymentIntent using server-calculated amount (Card payments only)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      payment_method_types: ['card'],
      description: `E-commerce Order for ${customer.email} (${validatedItems.length} items)`,
      metadata: {
        customerName: (customer.fullName || 'Customer').substring(0, 100),
        customerEmail: (customer.email || '').substring(0, 100),
        customerPhone: (customer.phone || '').substring(0, 50),
        shippingAddress: JSON.stringify(customer.shippingAddress || {}).substring(0, 450),
        totalItems: totalQuantity.toString(),
        userId: req.user?.userId || 'guest',
        zoneName: deliveryZoneSnapshot?.name || 'Standard Delivery',
      },
      receipt_email: customer.email && customer.email.includes('@') ? customer.email : undefined,
    });

    // 8. Create Order in MongoDB with paymentStatus: 'pending' and orderStatus: 'pending'
    let orderUserId = req.user?.userId || null;
    if (!orderUserId && customer.email) {
      try {
        const User = require('../models/User');
        const matchedUser = await User.findOne({ email: customer.email.trim().toLowerCase() }).select('_id').lean();
        if (matchedUser?._id) {
          orderUserId = matchedUser._id;
        }
      } catch (_) {}
    }

    const newOrder = await Order.create({
      user: orderUserId,
      orderItems: validatedItems,
      totalAmount: finalOrderTotal,
      currency: currency.toLowerCase(),
      deliveryZone: deliveryZoneSnapshot,
      deliveryCharge,
      deliveryCoordinates: hasValidCoords
        ? {
            latitude: Number(latVal),
            longitude: Number(lngVal),
          }
        : { latitude: null, longitude: null },
      deliveryLocation: hasValidCoords
        ? {
            type: 'Point',
            coordinates: [
              Number((Number(lngVal) - 0.0110).toFixed(6)),
              Number((Number(latVal) - 0.0120).toFixed(6)),
            ],
          }
        : undefined,
      paymentStatus: 'pending',
      orderStatus: 'pending',
      stripePaymentIntentId: paymentIntent.id,
      customer: {
        fullName: customer.fullName.trim(),
        email: customer.email.trim(),
        phone: (customer.phone || '').trim(),
        shippingAddress: {
          address: customer.shippingAddress.address.trim(),
          city: customer.shippingAddress.city.trim(),
          state: customer.shippingAddress.state.trim(),
          postalCode: customer.shippingAddress.postalCode.trim(),
          country: (customer.shippingAddress.country || 'India').trim(),
        },
      },
      stockDeducted: false,
    });

    // 9. Send order confirmation email immediately to customer
    sendOrderStatusEmail({ order: newOrder, statusType: 'created' })
      .then(async () => {
        newOrder.confirmationEmailSent = true;
        await newOrder.save();
        console.log(`[Email Service] Confirmation email dispatched immediately for Order #${newOrder._id}`);
      })
      .catch((err) => console.warn('[Email Service] Direct email notice:', err.message));

    // Also trigger n8n order.created workflow asynchronously in background
    sendOrderCreatedToN8n(newOrder).catch((err) => {
      console.warn(`[n8n Integration] Background dispatch:`, err.message);
    });

    // 10. Return ONLY what is needed by the frontend
    return res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      orderId: newOrder._id,
      amount: finalOrderTotal,
      amountInCents,
      currency: currency.toLowerCase(),
      items: validatedItems,
      summary: {
        itemsCount: totalQuantity,
        subtotal: productSubtotal,
        shipping: deliveryCharge,
        deliveryCharge,
        deliveryZone: deliveryZoneSnapshot,
        total: finalOrderTotal,
      },
    });
  } catch (error) {
    console.error('[STRIPE PAYMENT INTENT ERROR]:', error.message);

    if (error.type === 'StripeCardError' || error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        message: error.message || 'Invalid payment parameters.',
      });
    }

    if (error.type === 'StripeAuthenticationError') {
      return res.status(500).json({
        success: false,
        message: 'Stripe authentication failed. Please verify server API keys.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to create payment intent. Please try again later.',
    });
  }
});

/**
 * POST /api/payments/confirm-payment
 *
/**
 * Helper to process successful payment on an order idempotently.
 * Atomically deducts stock (if not already deducted), updates paymentStatus to 'paid',
 * updates orderStatus to 'processing', sets paidAt, saves order in DB, and sends confirmation email.
 */
async function fulfillOrderPayment(order, paymentIntent) {
  if (!order) return null;

  // 1. If already marked paid and stock already deducted, check email and return
  if (order.paymentStatus === 'paid' && order.stockDeducted === true) {
    if (!order.paymentEmailSent || !order.confirmationEmailSent) {
      console.log(`[ORDER FULFILLED]: Order #${order._id} was marked paid but confirmation email not yet sent. Dispatching now...`);
      try {
        await sendOrderStatusEmail({ order, statusType: 'paid' });
      } catch (err) {
        console.error('[EMAIL NOTIFICATION FAILED]:', err.message);
      }
    }
    return order;
  }

  // 2. Atomically deduct product stock if not already deducted
  if (!order.stockDeducted && Array.isArray(order.orderItems)) {
    for (const item of order.orderItems) {
      if (!item.productId) continue;
      const updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          quantity: { $gte: item.quantity },
        },
        {
          $inc: { quantity: -item.quantity },
        },
        { new: true }
      );

      if (updated) {
        console.log(
          `[STOCK UPDATED]: Product '${item.title}' (${item.productId}) stock reduced by ${item.quantity}. Remaining: ${updated.quantity}`
        );
      } else {
        // Safety fallback: clamp to 0 to prevent negative stock
        await Product.findByIdAndUpdate(item.productId, { quantity: 0 });
        console.warn(
          `[STOCK SHORTAGE]: Product '${item.title}' (${item.productId}) had insufficient stock. Stock clamped to 0.`
        );
      }
    }
    order.stockDeducted = true;
  }

  // 3. Mark payment status as paid, order status as processing
  order.paymentStatus = 'paid';
  if (!order.orderStatus || order.orderStatus === 'pending') {
    order.orderStatus = 'processing';
  }
  order.paidAt = order.paidAt || new Date();
  await order.save();

  console.log(`[ORDER FULFILLED]: Order ${order._id} successfully marked as PAID and saved in DB (Status: ${order.orderStatus}).`);

  // 4. Emit real-time tracking event via Socket.IO
  emitOrderUpdate(order._id.toString(), order);

  // 5. Send order confirmation & payment email notification (awaited to guarantee delivery before response returns)
  try {
    console.log(`[ORDER FULFILLED]: Sending order confirmation & payment email for Order #${order._id}...`);
    await sendOrderStatusEmail({ order, statusType: 'paid' });
  } catch (err) {
    console.error('[EMAIL NOTIFICATION FAILED]:', err.message);
  }

  // 6. Trigger n8n order.paid workflow asynchronously (non-blocking)
  sendOrderPaidToN8n(order).catch((err) => {
    console.warn(`[n8n Integration] Notice: Could not dispatch order.paid for #${order._id}:`, err.message);
  });

  return order;
}

/**
 * POST /api/payments/confirm-payment
 * POST /api/payments/verify-payment
 *
 * Server-side payment confirmation endpoint.
 * Called by the frontend immediately after stripe.confirmPayment() succeeds.
 *
 * Security:
 * 1. Does NOT trust client claims — retrieves PaymentIntent status directly from Stripe API.
 * 2. Only updates order if Stripe confirms payment_intent.status === 'succeeded'.
 * 3. Idempotent: If order is already marked 'paid' and stock deducted, returns success without re-processing.
 * 4. Atomically deducts stock and ensures order is saved to database.
 */
router.post('/confirm-payment', optionalAuth, async (req, res) => {
  try {
    const { paymentIntentId, orderId } = req.body;

    // 1. Validate input
    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'A valid paymentIntentId is required.',
      });
    }

    // 2. Verify payment status directly with Stripe API (NEVER trust client)
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (stripeErr) {
      console.error('[CONFIRM PAYMENT] Stripe retrieve error:', stripeErr.message);
      return res.status(400).json({
        success: false,
        message: 'Unable to verify payment with Stripe. Invalid PaymentIntent ID.',
      });
    }

    // 3. Only proceed if Stripe confirms payment succeeded
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        success: false,
        message: `Payment has not succeeded. Current Stripe status: ${paymentIntent.status}.`,
        status: paymentIntent.status,
      });
    }

    // 4. Find the associated order in MongoDB
    let order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
    if (!order && orderId && isValidObjectId(orderId)) {
      order = await Order.findById(orderId);
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found for this payment.',
      });
    }

    // 5. Fulfill order (deducts stock idempotently, updates status to 'paid', and saves to DB)
    const updatedOrder = await fulfillOrderPayment(order, paymentIntent);

    return res.status(200).json({
      success: true,
      message: 'Payment confirmed successfully. Order is now processing.',
      order: {
        id: updatedOrder._id,
        paymentStatus: updatedOrder.paymentStatus,
        orderStatus: updatedOrder.orderStatus,
        totalAmount: updatedOrder.totalAmount,
        paidAt: updatedOrder.paidAt,
      },
    });
  } catch (error) {
    console.error('[CONFIRM PAYMENT ERROR]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to confirm payment. Please try again.',
    });
  }
});

// Alias endpoint for verify-payment
router.post('/verify-payment', optionalAuth, async (req, res, next) => {
  req.url = '/confirm-payment';
  return router.handle(req, res, next);
});

/**
 * POST /api/payments/webhook
 *
 * Stripe Webhook Handler:
 * 1. Verifies the Stripe cryptographic webhook signature using raw body Buffer.
 * 2. Handles payment_intent.succeeded:
 *    - Finds the order linked to stripePaymentIntentId.
 *    - Idempotency check: if order is already paid, does not re-process or re-deduct stock.
 *    - Updates product stock in MongoDB (stock = stock - qty, never below 0).
 *    - Marks paymentStatus as 'paid', orderStatus as 'processing', stockDeducted as true.
 * 3. Handles payment_intent.payment_failed:
 *    - Marks paymentStatus as 'failed'.
 *    - Does NOT deduct product stock.
 *    - Does NOT mark order as paid.
 * 4. Returns 200 OK to acknowledge event receipt to Stripe.
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const rawBody = req.rawBody || req.body;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event;

  // 1. Verify Stripe Webhook Signature if webhookSecret is configured
  if (webhookSecret && !webhookSecret.includes('placeholder')) {
    try {
      if (!sig) {
        console.error('⚠️ [STRIPE WEBHOOK ERROR]: Missing stripe-signature header.');
        return res.status(400).json({ success: false, message: 'Missing stripe-signature header' });
      }

      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('⚠️ [STRIPE WEBHOOK SIGNATURE VERIFICATION FAILED]:', err.message);
      return res.status(400).send(`Webhook Signature Verification Error: ${err.message}`);
    }
  } else {
    // Development / test fallback when webhook secret is not yet configured with Stripe CLI
    console.warn('⚠️ [STRIPE WEBHOOK]: STRIPE_WEBHOOK_SECRET is not configured. Parsing raw event payload.');
    try {
      if (Buffer.isBuffer(rawBody)) {
        event = JSON.parse(rawBody.toString('utf8'));
      } else if (typeof rawBody === 'string') {
        event = JSON.parse(rawBody);
      } else if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        event = req.body;
      } else {
        event = rawBody;
      }
    } catch (parseErr) {
      console.error('⚠️ [STRIPE WEBHOOK PARSE ERROR]:', parseErr.message);
      return res.status(400).json({ success: false, message: 'Invalid payload format' });
    }
  }

  // 2. Handle Stripe Webhook Events
  try {
    const eventType = event.type;
    console.log(`[STRIPE WEBHOOK RECEIVED]: Event Type = ${eventType}`);

    switch (eventType) {
      // -----------------------------------------------------------------------
      // EVENT: Payment Succeeded
      // -----------------------------------------------------------------------
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const paymentIntentId = paymentIntent.id;

        console.log(`[STRIPE WEBHOOK]: Processing payment_intent.succeeded for ID: ${paymentIntentId}`);

        // Find the associated order in MongoDB
        const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });

        if (!order) {
          console.warn(`[STRIPE WEBHOOK]: Order not found for PaymentIntent ID: ${paymentIntentId}`);
          return res.status(200).json({ received: true, note: 'Order not found, acknowledged.' });
        }

        // Fulfill order idempotently: deduct stock, update status to 'paid', save to DB & email
        await fulfillOrderPayment(order, paymentIntent);
        break;
      }

      // -----------------------------------------------------------------------
      // EVENT: Payment Failed
      // -----------------------------------------------------------------------
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const paymentIntentId = paymentIntent.id;

        console.log(`[STRIPE WEBHOOK]: Payment failed for PaymentIntent ID: ${paymentIntentId}`);

        const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
        if (order) {
          // 10. If payment fails: Do NOT reduce stock, do NOT mark as paid
          order.paymentStatus = 'failed';
          order.orderStatus = 'cancelled';
          await order.save();
          console.log(`[ORDER UPDATED]: Order ${order._id} marked as FAILED. Stock untouched.`);

          // Automatically send payment failed email
          sendOrderStatusEmail({ order, statusType: 'failed' }).catch((err) => {
            console.error('[EMAIL NOTIFICATION FAILED]:', err.message);
          });
        }
        break;
      }

      // -----------------------------------------------------------------------
      // EVENT: Charge Refunded
      // -----------------------------------------------------------------------
      case 'charge.refunded': {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;
        console.log(`[STRIPE WEBHOOK]: Charge refunded for PaymentIntent ID: ${paymentIntentId}`);

        const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
        if (order) {
          order.paymentStatus = 'refunded';
          await order.save();
          console.log(`[ORDER UPDATED]: Order ${order._id} marked as REFUNDED.`);

          // Automatically send refund email
          sendOrderStatusEmail({ order, statusType: 'refunded' }).catch((err) => {
            console.error('[EMAIL NOTIFICATION FAILED]:', err.message);
          });
        }
        break;
      }

      default:
        console.log(`[STRIPE WEBHOOK]: Unhandled event type: ${eventType}`);
        break;
    }

    // Acknowledge receipt of the webhook event to Stripe
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('⚠️ [STRIPE WEBHOOK PROCESSING ERROR]:', err.message);
    return res.status(500).json({ success: false, message: 'Webhook processing error' });
  }
});

/**
 * GET /api/payments/orders/:id
 * Retrieve single order by Order ID or Stripe PaymentIntent ID
 * Strict Security: Never allow one customer to access another customer's order.
 */
router.get('/orders/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const User = require('../models/User');

    let order = null;
    if (isValidObjectId(id)) {
      order = await Order.findById(id);
    }

    if (!order) {
      order = await Order.findOne({ stripePaymentIntentId: id });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    // Auto-sync fallback with Stripe: if order is still 'pending' but has a Stripe PaymentIntent ID
    if (order.paymentStatus === 'pending' && order.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);
        if (pi && pi.status === 'succeeded') {
          order = await fulfillOrderPayment(order, pi);
        }
      } catch (stripeErr) {
        // Non-blocking sync error
        console.warn(`[ORDER SYNC WARNING] Could not verify PaymentIntent ${order.stripePaymentIntentId} with Stripe:`, stripeErr.message);
      }
    }

    // Security Check: Customer can only access their own orders. Admin can view all.
    const currentUser = await User.findById(req.user.userId);
    const userEmail = currentUser ? currentUser.email.toLowerCase().trim() : null;

    const isOwner =
      (order.user && order.user.toString() === req.user.userId.toString()) ||
      (userEmail && order.customer?.email && order.customer.email.toLowerCase().trim() === userEmail);
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this order.',
      });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve order.',
    });
  }
});

/**
 * GET /api/payments/orders
 * List orders for the authenticated customer
 * Strict Security: Non-admin customers only receive their own orders.
 */
router.get('/orders', authenticateUser, async (req, res) => {
  try {
    const User = require('../models/User');
    const filter = {};

    // Non-admin customer: restrict strictly to user's account ID or verified email
    if (req.user.role !== 'ADMIN') {
      const currentUser = await User.findById(req.user.userId);
      const userEmail = currentUser ? currentUser.email.toLowerCase() : null;

      const orConditions = [{ user: req.user.userId }];
      if (userEmail) {
        orConditions.push({ 'customer.email': userEmail });
      }
      filter.$or = orConditions;
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100);

    // Auto-sync fallback with Stripe: if any recent pending order has a Stripe PaymentIntent ID
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (o.paymentStatus === 'pending' && o.stripePaymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(o.stripePaymentIntentId);
          if (pi && pi.status === 'succeeded') {
            orders[i] = await fulfillOrderPayment(o, pi);
          }
        } catch (stripeErr) {
          // Non-blocking sync error
        }
      }
    }

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error('Error fetching orders list:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve orders list.',
    });
  }
});

/**
 * POST /api/payments/orders/:id/refund-request
 * Customer endpoint: Raise a refund request when a product is incorrect or defective.
 */
router.post('/orders/:id/refund-request', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, details } = req.body;
    const User = require('../models/User');

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please select or provide a reason for your refund request.',
      });
    }

    let order = null;
    if (isValidObjectId(id)) {
      order = await Order.findById(id);
    }
    if (!order) {
      order = await Order.findOne({ stripePaymentIntentId: id });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    // Security: Validate customer ownership (or admin)
    const currentUser = await User.findById(req.user.userId);
    const userEmail = currentUser ? currentUser.email.toLowerCase().trim() : null;
    const isOwner =
      (order.user && order.user.toString() === req.user.userId.toString()) ||
      (userEmail && order.customer?.email && order.customer.email.toLowerCase().trim() === userEmail);
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only request refunds for your own orders.',
      });
    }

    // Validate payment status
    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({
        success: false,
        message: `Cannot request a refund for an order with payment status '${order.paymentStatus}'. Only paid orders can be refunded.`,
      });
    }

    // Check if already requested or refunded
    if (order.refundRequest?.status === 'requested') {
      return res.status(400).json({
        success: false,
        message: 'A refund request is already pending review for this order.',
      });
    }

    if (order.paymentStatus === 'refunded' || order.refundRequest?.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'This order has already been refunded.',
      });
    }

    // Update refundRequest
    order.refundRequest = {
      status: 'requested',
      reason: reason.trim(),
      details: details ? details.trim() : '',
      requestedAt: new Date(),
      processedAt: null,
      adminNotes: '',
      stripeRefundId: '',
    };

    await order.save();

    // Broadcast refund request status update via Socket.IO
    emitOrderUpdate(order._id.toString(), order);

    console.log(
      `[REFUND REQUEST RAISED]: Customer ${order.customer?.email} requested refund for Order ${order._id}. Reason: "${reason.trim()}"`
    );

    // Send automated email to customer confirming request received
    sendOrderStatusEmail({ order, statusType: 'refund_requested' }).catch((err) => {
      console.error('[EMAIL NOTIFICATION FAILED]:', err.message);
    });

    return res.status(200).json({
      success: true,
      message: 'Refund request submitted successfully. The administration team will review it shortly.',
      data: order,
    });
  } catch (error) {
    console.error('Error submitting refund request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit refund request.',
    });
  }
});

/**
 * GET /api/payments/admin/refunds
 * Admin endpoint: List all refund requests and order metrics
 */
router.get('/admin/refunds', authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Administrator privileges required.',
      });
    }

    const { status = 'all' } = req.query;
    const filter = {};

    if (status === 'requested') {
      filter['refundRequest.status'] = 'requested';
    } else if (status === 'approved') {
      filter['refundRequest.status'] = 'approved';
    } else if (status === 'rejected') {
      filter['refundRequest.status'] = 'rejected';
    } else if (status === 'delivered') {
      filter.orderStatus = { $in: ['DELIVERED', 'delivered'] };
    } else if (status === 'all_requests') {
      filter['refundRequest.status'] = { $in: ['requested', 'approved', 'rejected'] };
    }

    const orders = await Order.find(filter)
      .sort({ updatedAt: -1, 'refundRequest.requestedAt': -1, createdAt: -1 })
      .limit(100);

    const pendingCount = await Order.countDocuments({ 'refundRequest.status': 'requested' });
    const approvedCount = await Order.countDocuments({ 'refundRequest.status': 'approved' });
    const rejectedCount = await Order.countDocuments({ 'refundRequest.status': 'rejected' });
    const deliveredCount = await Order.countDocuments({ orderStatus: { $in: ['DELIVERED', 'delivered'] } });
    const totalOrdersCount = await Order.countDocuments();

    return res.status(200).json({
      success: true,
      count: orders.length,
      metrics: {
        pendingRefunds: pendingCount,
        approvedRefunds: approvedCount,
        rejectedRefunds: rejectedCount,
        deliveredOrders: deliveredCount,
        totalOrders: totalOrdersCount,
      },
      data: orders,
    });
  } catch (error) {
    console.error('Error fetching admin refunds:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve refund requests.',
    });
  }
});

/**
 * POST /api/payments/admin/orders/:id/refund
 * Admin endpoint: Process refund through Stripe (approve or reject)
 */
router.post('/admin/orders/:id/refund', authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Administrator privileges required.',
      });
    }

    const { id } = req.params;
    const { action = 'approve', adminNotes = '' } = req.body;

    let order = null;
    if (isValidObjectId(id)) {
      order = await Order.findById(id);
    }
    if (!order) {
      order = await Order.findOne({ stripePaymentIntentId: id });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    if (action === 'approve') {
      if (order.paymentStatus === 'refunded' || order.refundRequest?.status === 'approved') {
        return res.status(400).json({
          success: false,
          message: 'This order is already refunded.',
        });
      }

      if (!order.stripePaymentIntentId) {
        return res.status(400).json({
          success: false,
          message: 'Order lacks a valid Stripe PaymentIntent ID to process refund.',
        });
      }

      console.log(
        `[STRIPE REFUND INITIATED]: Processing refund for Order ${order._id}, PaymentIntent: ${order.stripePaymentIntentId}`
      );

      // Call Stripe API to issue refund to customer card
      let stripeRefund;
      try {
        stripeRefund = await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
          reason: 'requested_by_customer',
          metadata: {
            orderId: order._id.toString(),
            customerEmail: order.customer?.email || '',
            refundReason: order.refundRequest?.reason || 'Product not correct',
          },
        });
      } catch (stripeErr) {
        console.error('⚠️ [STRIPE REFUND API ERROR]:', stripeErr.message);
        return res.status(500).json({
          success: false,
          message: `Stripe Refund Error: ${stripeErr.message}`,
        });
      }

      console.log(`[STRIPE REFUND SUCCESS]: Refund ID ${stripeRefund.id} created for Order ${order._id}`);

      // Update Order record
      order.paymentStatus = 'refunded';
      if (!order.refundRequest) {
        order.refundRequest = {};
      }
      order.refundRequest.status = 'approved';
      order.refundRequest.processedAt = new Date();
      order.refundRequest.stripeRefundId = stripeRefund.id;
      order.refundRequest.adminNotes = adminNotes ? adminNotes.trim() : 'Refund approved and issued via Stripe';

      // Restore inventory stock if previously deducted
      if (order.stockDeducted && Array.isArray(order.orderItems)) {
        for (const item of order.orderItems) {
          if (item.productId) {
            await Product.findByIdAndUpdate(item.productId, {
              $inc: { quantity: item.quantity },
            });
            console.log(`[STOCK RESTORED]: Restocked +${item.quantity} for product '${item.title}' (${item.productId})`);
          }
        }
      }

      await order.save();

      // Trigger automatic transactional email to customer
      sendOrderStatusEmail({ order, statusType: 'refunded' }).catch((err) => {
        console.error('[EMAIL NOTIFICATION FAILED]:', err.message);
      });

      return res.status(200).json({
        success: true,
        message: `Refund of $${Number(order.totalAmount).toFixed(2)} ${order.currency.toUpperCase()} successfully issued through Stripe.`,
        stripeRefundId: stripeRefund.id,
        data: order,
      });
    } else if (action === 'reject') {
      if (!order.refundRequest) {
        order.refundRequest = {};
      }
      order.refundRequest.status = 'rejected';
      order.refundRequest.processedAt = new Date();
      order.refundRequest.adminNotes = adminNotes ? adminNotes.trim() : 'Refund request declined by administrator';

      await order.save();

      // Broadcast refund rejection status update via Socket.IO
      emitOrderUpdate(order._id.toString(), order);

      // Trigger notification email to customer
      sendOrderStatusEmail({ order, statusType: 'refund_rejected' }).catch((err) => {
        console.error('[EMAIL NOTIFICATION FAILED]:', err.message);
      });

      return res.status(200).json({
        success: true,
        message: 'Refund request was declined.',
        data: order,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: `Invalid action '${action}'. Expected 'approve' or 'reject'.`,
      });
    }
  } catch (error) {
    console.error('Error processing admin refund:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process refund.',
    });
  }
});

/**
 * PATCH & PUT /api/payments/orders/:id/status
 * Update order tracking status:
 * Supported: PLACED, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED
 * (Also accepts legacy: pending, processing, shipped for backward compatibility)
 *
 * Requirements:
 * 1. Successfully updates MongoDB (source of truth).
 * 2. Emits Socket.IO event named: 'orderStatusUpdated'
 * 3. Emits only to room: order_<orderId>
 * 4. Sends { orderId, status, updatedAt }
 * 5. Does NOT emit the event if the database update fails.
 */
const handleOrderStatusUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Order status is required and must be a string.',
      });
    }

    const statusMap = {
      placed: 'PLACED',
      confirmed: 'CONFIRMED',
      preparing: 'PREPARING',
      out_for_delivery: 'OUT_FOR_DELIVERY',
      delivered: 'DELIVERED',
      cancelled: 'CANCELLED',
      pending: 'PLACED',
      processing: 'PREPARING',
      shipped: 'OUT_FOR_DELIVERY',
    };

    const cleanInput = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const targetStatus = statusMap[cleanInput] || statusMap[status.trim().toLowerCase()];

    if (!targetStatus) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: PLACED, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED',
      });
    }

    let order = null;
    if (isValidObjectId(id)) {
      order = await Order.findById(id);
    }
    if (!order) {
      order = await Order.findOne({ stripePaymentIntentId: id });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    // 1. Update order in MongoDB (source of truth)
    order.orderStatus = targetStatus;
    if (targetStatus === 'DELIVERED') {
      order.deliveredAt = order.deliveredAt || new Date();
    }

    // Await database write - if this throws, code jumps straight to catch and does NOT emit
    await order.save();

    console.log(`[ORDER STATUS UPDATED]: Order ${order._id} status updated in MongoDB to: ${order.orderStatus}`);

    // 2. Database update succeeded! Emit Socket.IO event named: orderStatusUpdated strictly to order_<orderId>
    emitOrderUpdate(order._id.toString(), order);

    // 3. Automated delivery confirmation email to customer
    if (targetStatus === 'DELIVERED') {
      sendOrderStatusEmail({ order, statusType: 'delivered' })
        .then((res) => {
          console.log(`[ORDER DELIVERED EMAIL]: Delivery confirmation email dispatched for order ${order._id}`);
        })
        .catch((err) => {
          console.error('[ORDER DELIVERED EMAIL ERROR]: Failed to send delivery email:', err.message);
        });

      // Schedule customer review & feedback email to be sent 5 minutes after delivery
      scheduleFeedbackEmail(order._id);
    }

    return res.status(200).json({
      success: true,
      message: `Order status successfully updated to '${order.orderStatus}'`,
      data: order,
    });
  } catch (error) {
    // Database update failed: Socket.IO event is NOT emitted!
    console.error('Error updating order status in MongoDB:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update order status in database.',
      error: error.message,
    });
  }
};

router.patch('/orders/:id/status', optionalAuth, handleOrderStatusUpdate);
router.put('/orders/:id/status', optionalAuth, handleOrderStatusUpdate);
router.post('/orders/:id/status', optionalAuth, handleOrderStatusUpdate);

module.exports = router;
