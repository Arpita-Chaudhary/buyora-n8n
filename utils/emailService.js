const nodemailer = require('nodemailer');

let cachedTransporter = null;

const getTransporter = async () => {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const user = (process.env.EMAIL_USER || process.env.SMTP_USER || 'choudharyarpita504@gmail.com').trim();
  const pass = (process.env.EMAIL_PASS || process.env.SMTP_PASS || 'yjuhamviwosensyb').trim();

  // If GMAIL or generic service credentials provided
  if (user && pass) {
    if (host) {
      cachedTransporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user, pass },
      });
    } else {
      // Default to Gmail service
      cachedTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      });
    }
    return cachedTransporter;
  }
  // Fallback: Simulation / Dev Mode
  return null;
};

const verifyEmailService = async () => {
  try {
    const transporter = await getTransporter();
    if (!transporter) {
      console.log('⚠️ [EMAIL SERVICE]: Running in simulation mode (set EMAIL_USER & EMAIL_PASS in .env).');
      return false;
    }
    await transporter.verify();
    console.log(`✔ [EMAIL SERVICE]: Nodemailer SMTP ready for ${(process.env.EMAIL_USER || '').trim()}`);
    return true;
  } catch (err) {
    console.warn(`⚠️ [EMAIL SERVICE]: SMTP verification warning: ${err.message}`);
    return false;
  }
};
const sendPromotionalEmails = async ({ recipients, subject, htmlContent }) => {
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('No recipient email addresses provided');
  }
  if (!subject || typeof subject !== 'string') {
    throw new Error('Email subject is required');
  }
  if (!htmlContent || typeof htmlContent !== 'string') {
    throw new Error('Email HTML content is required');
  }
  const transporter = await getTransporter();
  const senderEmail = (process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER || 'promotions@adminpanel.com').trim();
  const adminCopyEmail = (process.env.EMAIL_USER || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  // Ensure unique list of recipients and ensure admin's own email is included so they receive a copy every time
  const targetList = [...new Set(recipients.map((e) => e.trim().toLowerCase()))];
  if (adminCopyEmail && !targetList.includes(adminCopyEmail)) {
    targetList.push(adminCopyEmail);
  }
  if (!transporter) {
    // Simulation / Dev Mode: Log each email to console
    console.log('\n========================================');
    console.log('       [EMAIL PROMOTION SIMULATION]     ');
    console.log('========================================');
    console.log(`Sender:  ${senderEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Targets: ${targetList.length} recipient(s) (including admin copy)`);
    console.log('----------------------------------------');
    const simResults = targetList.map((email) => {
      console.log(`✔ Simulated delivery to: ${email}`);
      return { email, status: 'sent', simulated: true };
    });
    console.log('========================================\n');
    return {
      success: true,
      totalSent: simResults.length,
      failedCount: 0,
      mode: 'simulation',
      message: `Simulated sending to ${simResults.length} recipient(s) (including your email). Add EMAIL_USER & EMAIL_PASS in .env to send real emails.`,
      details: simResults,
    };
  }
  // Live SMTP Mode: Send all emails concurrently in parallel via Promise.all (no blocking for loop)
  const sendOperations = targetList.map(async (email) => {
    try {
      await transporter.sendMail({
        from: `"Admin Promotions" <${senderEmail}>`,
        to: email,
        subject,
        html: htmlContent,
      });
      return { email, status: 'sent' };
    } catch (err) {
      console.error(`Failed to send promotion to ${email}:`, err.message);
      return { email, status: 'failed', error: err.message };
    }
  });
  const results = await Promise.all(sendOperations);
  const totalSent = results.filter((r) => r.status === 'sent').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  return {
    success: true,
    totalSent,
    failedCount,
    mode: 'live',
    message: `Promotional email sent successfully to ${totalSent} recipient(s) (including your inbox)!`,
    details: results,
  };
};

/**
 * Send an automated transactional email based on order status change.
 * Supported process types: 'paid', 'refunded', 'cancelled', 'failed', 'shipped', 'delivered'
 */
const sendOrderStatusEmail = async ({ order, statusType }) => {
  if (!order) return null;

  const cleanStatusType = String(statusType || '').toLowerCase();
  const isCreated = cleanStatusType === 'created' || cleanStatusType === 'placed' || cleanStatusType === 'order_created';
  const isPaid = cleanStatusType === 'paid' || cleanStatusType === 'payment_done';
  const isDelivered = cleanStatusType === 'delivered';
  const isFeedback = cleanStatusType === 'feedback' || cleanStatusType === 'review';

  // Only send emails for created, payment done, product delivered, and 5-min post-delivery feedback
  if (!isCreated && !isPaid && !isDelivered && !isFeedback) {
    console.log(`[ORDER EMAIL]: Skipping status '${cleanStatusType}'. Only 'created', 'paid', 'delivered', and 'feedback' emails are sent.`);
    return null;
  }

  // Idempotency check: Do not send multiple emails for the same milestone
  if (isCreated && order.confirmationEmailSent) {
    console.log(`[ORDER EMAIL]: Order confirmation email already sent for Order ${order._id}. Skipping duplicate.`);
    return null;
  }

  if (isPaid && order.paymentEmailSent) {
    console.log(`[ORDER EMAIL]: Payment confirmation email already sent for Order ${order._id}. Skipping duplicate.`);
    return null;
  }

  if (isDelivered && order.deliveryEmailSent) {
    console.log(`[ORDER EMAIL]: Delivery confirmation email already sent for Order ${order._id}. Skipping duplicate.`);
    return null;
  }

  if (isFeedback && order.feedbackEmailSent) {
    console.log(`[ORDER EMAIL]: Feedback email already sent for Order ${order._id}. Skipping duplicate.`);
    return null;
  }

  // Target exactly ONE email: the customer's email address (no duplicate copies or extra recipients)
  let targetEmail = (order.customer?.email || '').trim().toLowerCase();

  if (!targetEmail || !targetEmail.includes('@')) {
    if (order.user?.email && order.user.email.includes('@')) {
      targetEmail = order.user.email.trim().toLowerCase();
    }
  }

  if (!targetEmail || !targetEmail.includes('@')) {
    console.warn(`[ORDER EMAIL]: No valid customer email address found for Order ${order._id}. Skipping email.`);
    return null;
  }

  const recipients = [targetEmail];
  console.log(`[EMAIL]: Dispatching single ${cleanStatusType} email to customer: ${targetEmail}`);

  const orderShortId = (order._id ? order._id.toString() : '').slice(-8).toUpperCase();
  const customerName = order.customer?.fullName || 'Valued Customer';
  const currency = (order.currency || 'USD').toUpperCase();
  const totalAmount = Number(order.totalAmount || 0).toFixed(2);
  const items = order.orderItems || [];
  const storeUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://buyora-n8n.vercel.app';

  // Generate HTML table rows for order items
  const itemsHtml = items.map((it) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 0; font-size: 14px; color: #0f172a;">
        <strong>${it.title || 'Product'}</strong><br />
        <span style="font-size: 12px; color: #64748b;">Qty: ${it.quantity} × $${Number(it.price || 0).toFixed(2)}</span>
      </td>
      <td style="padding: 10px 0; text-align: right; font-weight: 700; color: #0f172a; font-size: 14px;">
        $${Number(it.subtotal || (it.price * it.quantity)).toFixed(2)}
      </td>
    </tr>
  `).join('');

  const shippingAddr = order.customer?.shippingAddress || {};
  const formattedAddress = [shippingAddr.address, shippingAddr.city, shippingAddr.state, shippingAddr.postalCode, shippingAddr.country]
    .filter(Boolean)
    .join(', ');

  let subject = '';
  let statusBannerColor = '#2563eb';
  let statusTitle = '';
  let statusDescription = '';

  switch (statusType?.toLowerCase()) {
    case 'created':
    case 'placed':
    case 'order_created':
      subject = `Order Confirmed: #${orderShortId} - Buyora Store`;
      statusBannerColor = '#2563eb';
      statusTitle = 'Order Placed Successfully!';
      statusDescription = `Thank you for your order, ${customerName}! Your order #${orderShortId} for <strong>$${totalAmount} ${currency}</strong> has been placed and is currently being processed.`;
      break;

    case 'paid':
    case 'payment_done':
      subject = `Payment Confirmed: Order #${orderShortId} - Buyora Store`;
      statusBannerColor = '#16a34a';
      statusTitle = 'Payment Done & Order Confirmed!';
      statusDescription = `Thank you for your purchase, ${customerName}! Your payment of <strong>$${totalAmount} ${currency}</strong> has been successfully processed. Your order is confirmed and is now being prepared for shipment.`;
      break;

    case 'refund_requested':
      subject = `Refund Request Received: Order #${orderShortId} - Buyora Store`;
      statusBannerColor = '#f59e0b';
      statusTitle = 'Refund Request Under Review';
      statusDescription = `Hello ${customerName}, we have received your refund request for order #${orderShortId}.<br/><br/>
        <strong>Reason:</strong> ${order.refundRequest?.reason || 'Product is not correct'}<br/>
        ${order.refundRequest?.details ? `<strong>Details:</strong> "${order.refundRequest.details}"<br/>` : ''}
        <br/>Our administration team is reviewing your request. Once approved, your payment will be refunded directly to your card via Stripe.`;
      break;

    case 'refunded':
      subject = `Refund Processed: Order #${orderShortId} - Buyora Store`;
      statusBannerColor = '#ea580c';
      statusTitle = 'Refund Completed via Stripe';
      statusDescription = `Hello ${customerName}, your refund request for order #${orderShortId} has been <strong>approved</strong> and successfully processed through Stripe.<br/><br/>
        <strong>Amount Refunded:</strong> $${totalAmount} ${currency}<br/>
        ${order.refundRequest?.stripeRefundId ? `<strong>Stripe Refund ID:</strong> <code>${order.refundRequest.stripeRefundId}</code><br/>` : ''}
        ${order.refundRequest?.reason ? `<strong>Reason:</strong> ${order.refundRequest.reason}<br/>` : ''}
        ${order.refundRequest?.adminNotes ? `<strong>Admin Notes:</strong> ${order.refundRequest.adminNotes}<br/>` : ''}
        <br/>The funds will be credited back to your original payment method (typically within 5-10 business days depending on your bank).`;
      break;

    case 'refund_rejected':
      subject = `Update on Refund Request: Order #${orderShortId} - Buyora Store`;
      statusBannerColor = '#64748b';
      statusTitle = 'Refund Request Not Approved';
      statusDescription = `Hello ${customerName}, your refund request for order #${orderShortId} could not be approved at this time.<br/><br/>
        ${order.refundRequest?.adminNotes ? `<strong>Admin Notes:</strong> "${order.refundRequest.adminNotes}"<br/><br/>` : ''}
        If you have questions or require further assistance, please contact customer support.`;
      break;

    case 'cancelled':
      subject = `Order Cancelled: Order #${orderShortId} - Buyora Store`;
      statusBannerColor = '#dc2626';
      statusTitle = 'Order Cancelled';
      statusDescription = `Hello ${customerName}, your order #${orderShortId} has been cancelled. If any payment was collected, a refund will be processed back to your original card.`;
      break;

    case 'failed':
      subject = `Payment Failed: Order #${orderShortId} - Buyora Store`;
      statusBannerColor = '#dc2626';
      statusTitle = 'Payment Attempt Failed';
      statusDescription = `Hello ${customerName}, we were unable to process the payment for your order #${orderShortId}. Please verify your payment details and retry checkout.`;
      break;

    case 'shipped':
      subject = `🚚 Your Order #${orderShortId} Has Shipped!`;
      statusBannerColor = '#7c3aed';
      statusTitle = 'Order on the Way!';
      statusDescription = `Exciting news, ${customerName}! Your package for order #${orderShortId} has been dispatched and is currently on its way to your destination.`;
      break;

    case 'delivered':
      subject = `🎉 Your Order Has Been Delivered! Order #${orderShortId} - Buyora Store`;
      statusBannerColor = '#059669';
      statusTitle = 'Order Delivered Successfully! 🎉';
      statusDescription = `Great news, ${customerName}! Your order <strong>#${orderShortId}</strong> has been safely delivered to your doorstep. We hope you love your purchase!<br/><br/>
        <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 12px 16px; margin: 12px 0; color: #065f46; font-size: 13.5px;">
          <strong>🛵 Delivery Status:</strong> Successfully Handed Over<br/>
          <strong>📍 Delivered To:</strong> ${formattedAddress || 'Your shipping address'}<br/>
          <strong>🕒 Delivered At:</strong> ${order.deliveredAt ? new Date(order.deliveredAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
        If you have any feedback or if anything was not right with your order, you can request a return or reach customer care anytime from your account.`;
      break;

    case 'feedback':
      subject = `⭐ How did we do? Rate Order #${orderShortId} - Buyora`;
      statusBannerColor = '#f59e0b';
      statusTitle = 'We Value Your Feedback! ⭐';
      statusDescription = `Hi ${customerName},<br/><br/>
        Your order <strong>#${orderShortId}</strong> was delivered a few minutes ago. We hope your items arrived in great condition and you're loving your purchase!<br/><br/>
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 18px; text-align: center; margin: 16px 0;">
          <p style="margin: 0 0 10px 0; font-weight: 700; color: #92400e; font-size: 15px;">
            How was your shopping and delivery experience?
          </p>
          <div style="font-size: 32px; letter-spacing: 8px; margin: 12px 0;">
            ⭐⭐⭐⭐⭐
          </div>
          <div style="margin-top: 14px;">
            <a href="${storeUrl}/orders/${order._id}?feedback=5" style="display: inline-block; background: #d97706; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 6px; font-weight: 700; font-size: 14px; box-shadow: 0 2px 8px rgba(217, 119, 6, 0.3);">
              Leave 5-Star Review →
            </a>
          </div>
        </div>
        Your feedback takes just 30 seconds and helps us keep improving your experience!`;
      break;

    default:
      subject = `Order Update - Order #${orderShortId}`;
      statusBannerColor = '#2563eb';
      statusTitle = `Order Status: ${statusType}`;
      statusDescription = `Hello ${customerName}, there is an update regarding your order #${orderShortId}.`;
      break;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${subject}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">
        <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          
          <!-- Header Banner -->
          <div style="background-color: ${statusBannerColor}; padding: 24px 30px; text-align: center; color: #ffffff;">
            <div style="font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 4px;">Buyora</div>
            <div style="font-size: 16px; font-weight: 600;">${statusTitle}</div>
          </div>

          <!-- Body Content -->
          <div style="padding: 28px 30px; color: #334155; line-height: 1.6;">
            <p style="font-size: 15px; margin-top: 0; color: #0f172a;">${statusDescription}</p>

            <!-- Order Details Box -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <div style="font-size: 13px; color: #64748b; margin-bottom: 6px;">
                <strong>Order ID:</strong> #${orderShortId}
              </div>
              <div style="font-size: 13px; color: #64748b; margin-bottom: 6px;">
                <strong>Status:</strong> ${statusType.toUpperCase()}
              </div>
              <div style="font-size: 13px; color: #64748b;">
                <strong>Shipping to:</strong> ${formattedAddress || 'Standard Shipping'}
              </div>
            </div>

            <!-- Items Table -->
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
              <thead>
                <tr style="border-bottom: 2px solid #e2e8f0;">
                  <th style="text-align: left; padding: 8px 0; font-size: 12px; color: #64748b; text-transform: uppercase;">Item</th>
                  <th style="text-align: right; padding: 8px 0; font-size: 12px; color: #64748b; text-transform: uppercase;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <!-- Total Amount -->
            <div style="border-top: 2px solid #0f172a; margin-top: 16px; padding-top: 12px; display: flex; justify-content: space-between; align-items: baseline;">
              <span style="font-size: 16px; font-weight: 700; color: #0f172a;">Total:</span>
              <span style="font-size: 20px; font-weight: 800; color: #16a34a;">$${totalAmount} ${currency}</span>
            </div>

            <div style="margin-top: 24px; padding: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align: center; color: #475569; font-size: 13px;">
              You can review your order and request returns or support anytime from your Buyora account.
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f1f5f9; padding: 16px 30px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
            Thank you for choosing <strong>Buyora</strong>. If you have questions about your order, reply to this email.
          </div>
        </div>
      </body>
    </html>
  `;

  const transporter = await getTransporter();
  const senderEmail = (process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER || 'choudharyarpita504@gmail.com').trim();

  if (!transporter) {
    console.log('\n========================================');
    console.log(`  [AUTOMATED ORDER EMAIL - ${statusType.toUpperCase()}]`);
    console.log('========================================');
    console.log(`Recipients: ${recipients.join(', ')}`);
    console.log(`Subject:    ${subject}`);
    console.log(`Order:      #${orderShortId} ($${totalAmount} ${currency})`);
    console.log(`Status:     ${statusType}`);
    console.log('----------------------------------------');
    recipients.forEach((email) => {
      console.log(`✔ Simulated delivery → ${email}`);
    });
    console.log('========================================\n');
    return { success: true, simulated: true, recipients };
  }

  // Plain text fallback (essential to prevent Gmail spam classification)
  const plainText = `${statusTitle}\n\n${statusDescription.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')}\n\nOrder #${orderShortId}\nTotal: $${totalAmount} ${currency}\nCustomer: ${customerName}\n\nThank you for choosing Buyora Store.`;

  // Send separate, direct emails to each recipient individually (NO CC, NO BCC)
  const results = [];
  for (const targetEmail of recipients) {
    try {
      const mailOptions = {
        from: `"Buyora Store" <${senderEmail}>`,
        to: targetEmail,
        replyTo: senderEmail,
        subject,
        text: plainText,
        html: htmlContent,
      };
      const info = await transporter.sendMail(mailOptions);
      console.log(`[ORDER EMAIL SENT]: Delivered ${statusType} individually to ${targetEmail} (MsgID: ${info.messageId})`);
      results.push({ email: targetEmail, success: true, messageId: info.messageId });
    } catch (err) {
      console.error(`[ORDER EMAIL ERROR]: Failed sending ${statusType} to ${targetEmail}:`, err.message);
      results.push({ email: targetEmail, success: false, error: err.message });
    }
  }

  const Order = require('../models/Order');
  if (results.some((r) => r.success)) {
    try {
      if (isCreated) {
        await Order.findByIdAndUpdate(order._id, { confirmationEmailSent: true });
        order.confirmationEmailSent = true;
      } else if (isPaid) {
        await Order.findByIdAndUpdate(order._id, { paymentEmailSent: true });
        order.paymentEmailSent = true;
      } else if (isDelivered) {
        await Order.findByIdAndUpdate(order._id, { deliveryEmailSent: true });
        order.deliveryEmailSent = true;
      } else if (isFeedback) {
        await Order.findByIdAndUpdate(order._id, { feedbackEmailSent: true });
        order.feedbackEmailSent = true;
      }
    } catch (_) {}
  }

  return {
    success: results.some((r) => r.success),
    simulated: false,
    details: results,
  };
};

/**
 * Schedules a customer feedback email to be sent 5 minutes after order delivery.
 * Uses persistent timer and idempotency check against order.feedbackEmailSent.
 *
 * @param {string|Object} orderId - Target Order ID
 * @param {number} delayMs - Delay in milliseconds (default: 5 minutes = 300,000 ms)
 */
const scheduleFeedbackEmail = (orderId, delayMs = 5 * 60 * 1000) => {
  if (!orderId) return;

  const idStr = orderId.toString().trim();
  const delayMinutes = Math.round(delayMs / 60000);
  console.log(`[FEEDBACK EMAIL]: Scheduled to send in ${delayMinutes} minutes for Order #${idStr}`);

  setTimeout(async () => {
    try {
      const Order = require('../models/Order');
      const order = await Order.findById(idStr);

      if (!order) {
        console.warn(`[FEEDBACK EMAIL]: Order #${idStr} not found when 5-min timer expired.`);
        return;
      }

      if (order.feedbackEmailSent) {
        console.log(`[FEEDBACK EMAIL]: Feedback email already sent for Order #${idStr}. Skipping.`);
        return;
      }

      console.log(`[FEEDBACK EMAIL]: 5-minute post-delivery timer elapsed! Dispatching feedback review email for Order #${idStr}...`);
      const result = await sendOrderStatusEmail({ order, statusType: 'feedback' });
      if (result?.success) {
        await Order.findByIdAndUpdate(idStr, { feedbackEmailSent: true });
        console.log(`[FEEDBACK EMAIL]: Successfully delivered 5-minute feedback email to customer for Order #${idStr}`);
      }
    } catch (err) {
      console.error(`[FEEDBACK EMAIL ERROR]: Failed to send 5-minute feedback email for Order #${idStr}:`, err.message);
    }
  }, delayMs);
};

module.exports = {
  sendPromotionalEmails,
  sendOrderStatusEmail,
  scheduleFeedbackEmail,
  verifyEmailService,
};

