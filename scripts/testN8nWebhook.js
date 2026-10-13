/**
 * Standalone test script for Buyora -> n8n Order Webhook Dispatch
 *
 * Run with: node scripts/testN8nWebhook.js
 */
const dotenv = require('dotenv');
dotenv.config();

const { sendOrderCreatedToN8n, sendOrderPaidToN8n } = require('../utils/n8nService');

async function testDispatch() {
  console.log('==================================================');
  console.log('   Testing Buyora Order -> n8n Webhook Dispatch   ');
  console.log('==================================================');
  console.log('Target URL :', process.env.N8N_ORDER_WEBHOOK_URL || process.env.BUYORA_N8N_WEBHOOK_URL);
  console.log('==================================================');

  // Simulated Order Document as saved in MongoDB
  const mockOrder = {
    _id: '670aa' + Math.floor(1000000 + Math.random() * 9000000),
    orderStatus: 'PLACED',
    paymentStatus: 'pending',
    totalAmount: 2499,
    currency: 'inr',
    orderItems: [
      {
        productId: '66fa11223344556677889900',
        title: 'Premium Wireless Headphones',
        price: 2499,
        quantity: 1,
        subtotal: 2499,
      },
    ],
    deliveryZone: {
      name: 'Mohali All-Sectors Express Zone',
      deliveryCharge: 50,
      estimatedDeliveryTime: '30-45 mins',
    },
    deliveryCharge: 50,
    customer: {
      fullName: 'Demo Customer',
      email: 'customer@buyora.com',
    },
    createdAt: new Date(),
  };

  console.log(`[TEST] Dispatching simulated order #${mockOrder._id}...`);
  const result = await sendOrderCreatedToN8n(mockOrder);
  console.log('Dispatch Result:', result);
  console.log('==================================================');
}

testDispatch();
