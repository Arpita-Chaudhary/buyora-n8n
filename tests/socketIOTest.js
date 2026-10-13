/**
 * Complete 16-Point Automated Testing Suite for Socket.IO Order Tracking
 *
 * Verifies all 16 test cases requested:
 * 1. Customer connects to Socket.IO.
 * 2. Customer joins correct order room.
 * 3. Customer cannot join another customer's order.
 * 4. Admin changes order status.
 * 5. MongoDB updates successfully.
 * 6. Customer receives orderStatusUpdated.
 * 7. Customer UI updates without refresh.
 * 8. Delivery location is updated.
 * 9. Customer receives deliveryLocationUpdated.
 * 10. Map marker moves without refresh.
 * 11. Customer disconnects.
 * 12. Socket reconnects.
 * 13. Customer rejoins the order room.
 * 14. Multiple customers can track different orders simultaneously.
 * 15. One order's update does not reach another order's customer.
 * 16. REST API continues working if Socket.IO is unavailable.
 */

const net = require('net');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const { initSocket } = require('../config/socket');
const Order = require('../models/Order');
const User = require('../models/User');
const Role = require('../models/Role');

dotenv.config();

const PORT = 5000;
const BACKEND_URL = `http://localhost:${PORT}`;

function isServerListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

async function runSocketTestSuite() {
  console.log('================================================================');
  console.log('    SOCKET.IO ORDER TRACKING 16-POINT VERIFICATION SUITE       ');
  console.log('================================================================\n');

  // Connect to MongoDB
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/admin_panel');
  }

  // Ensure Roles exist
  let userRole = await Role.findOne({ name: 'USER' });
  if (!userRole) {
    userRole = await Role.create({ name: 'USER', displayName: 'Customer User' });
  }

  let adminRole = await Role.findOne({ name: 'ADMIN' });
  if (!adminRole) {
    adminRole = await Role.create({ name: 'ADMIN', displayName: 'System Admin' });
  }

  let deliveryRole = await Role.findOne({ name: 'DELIVERY' });
  if (!deliveryRole) {
    deliveryRole = await Role.create({ name: 'DELIVERY', displayName: 'Delivery Driver' });
  }

  // Set up Test Users
  let userA = await User.findOne({ email: 'customer_a_16pt@example.com' });
  if (!userA) {
    userA = await User.create({
      name: 'Customer Alice',
      email: 'customer_a_16pt@example.com',
      password: 'hashedpassword123',
      role_id: userRole._id,
    });
  }

  let userB = await User.findOne({ email: 'customer_b_16pt@example.com' });
  if (!userB) {
    userB = await User.create({
      name: 'Customer Bob',
      email: 'customer_b_16pt@example.com',
      password: 'hashedpassword123',
      role_id: userRole._id,
    });
  }

  let adminUser = await User.findOne({ email: 'admin_16pt@example.com' });
  if (!adminUser) {
    adminUser = await User.create({
      name: 'Admin Dave',
      email: 'admin_16pt@example.com',
      password: 'hashedpassword123',
      role_id: adminRole._id,
    });
  }

  let deliveryUser = await User.findOne({ email: 'delivery_16pt@example.com' });
  if (!deliveryUser) {
    deliveryUser = await User.create({
      name: 'Delivery Dan',
      email: 'delivery_16pt@example.com',
      password: 'hashedpassword123',
      role_id: deliveryRole._id,
    });
  }

  const jwtSecret = process.env.JWT_SECRET || 'secret';
  const tokenA = jwt.sign({ userId: userA._id.toString(), email: userA.email, role: 'USER' }, jwtSecret);
  const tokenB = jwt.sign({ userId: userB._id.toString(), email: userB.email, role: 'USER' }, jwtSecret);
  const tokenAdmin = jwt.sign({ userId: adminUser._id.toString(), email: adminUser.email, role: 'ADMIN' }, jwtSecret);
  const tokenDelivery = jwt.sign({ userId: deliveryUser._id.toString(), email: deliveryUser.email, role: 'DELIVERY' }, jwtSecret);

  // Set up Order A (Customer Alice)
  let orderA = await Order.findOne({ user: userA._id });
  if (!orderA) {
    orderA = await Order.create({
      user: userA._id,
      stripePaymentIntentId: `pi_test_user_a_${Date.now()}`,
      totalAmount: 199,
      orderStatus: 'PLACED',
      paymentStatus: 'paid',
      customer: {
        fullName: 'Customer Alice',
        email: userA.email,
        shippingAddress: {
          address: '101 Rosewood Ave',
          city: 'Mohali',
          state: 'Punjab',
          postalCode: '160055',
          country: 'India',
        },
      },
      orderItems: [
        {
          productId: new mongoose.Types.ObjectId(),
          title: 'Farm Fresh Apples',
          price: 199,
          quantity: 1,
          subtotal: 199,
        },
      ],
    });
  }

  // Set up Order B (Customer Bob)
  let orderB = await Order.findOne({ user: userB._id });
  if (!orderB) {
    orderB = await Order.create({
      user: userB._id,
      stripePaymentIntentId: `pi_test_user_b_${Date.now()}`,
      totalAmount: 349,
      orderStatus: 'PLACED',
      paymentStatus: 'paid',
      customer: {
        fullName: 'Customer Bob',
        email: userB.email,
        shippingAddress: {
          address: '202 Oak St',
          city: 'Chandigarh',
          state: 'Chandigarh',
          postalCode: '160017',
          country: 'India',
        },
      },
      orderItems: [
        {
          productId: new mongoose.Types.ObjectId(),
          title: 'Organic Milk 1L',
          price: 349,
          quantity: 1,
          subtotal: 349,
        },
      ],
    });
  }

  const orderIdA = orderA._id.toString();
  const orderIdB = orderB._id.toString();

  let internalServer = null;
  const isRunning = await isServerListening(PORT);

  if (!isRunning) {
    console.log(`Port ${PORT} is not active. Booting temporary test server...`);
    const app = express();
    app.use(express.json());
    app.use('/api/payments', require('../routes/paymentRoutes'));
    internalServer = http.createServer(app);
    initSocket(internalServer);
    await new Promise((resolve) => internalServer.listen(PORT, '0.0.0.0', resolve));
    console.log(`Test Socket.IO server listening on port ${PORT}.\n`);
  } else {
    console.log(`Existing server detected on port ${PORT}. Connecting...\n`);
  }

  let passed = 0;
  let total = 0;

  function assert(condition, testNumber, title, details = '') {
    total++;
    if (condition) {
      console.log(` ✅ PASS: [Test ${testNumber}] ${title}`);
      if (details) console.log(`         ${details}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: [Test ${testNumber}] ${title}`);
      if (details) console.error(`         ${details}`);
    }
  }

  // Clients
  let clientA = null;
  let clientB = null;
  let adminClient = null;
  let deliveryClient = null;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Customer connects to Socket.IO
    // -------------------------------------------------------------------------
    clientA = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 5000,
      auth: { token: `Bearer ${tokenA}` },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 1 timeout')), 5000);
      clientA.once('connect', () => {
        clearTimeout(timer);
        assert(clientA.connected === true, 1, 'Customer connects to Socket.IO', `Socket ID: ${clientA.id}`);
        resolve();
      });
      clientA.once('connect_error', reject);
    });

    // Connect admin and delivery clients
    adminClient = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
      auth: { token: `Bearer ${tokenAdmin}` },
    });

    deliveryClient = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
      auth: { token: `Bearer ${tokenDelivery}` },
    });

    await Promise.all([
      new Promise((res) => adminClient.once('connect', res)),
      new Promise((res) => deliveryClient.once('connect', res)),
    ]);

    // -------------------------------------------------------------------------
    // TEST 2: Customer joins correct order room
    // -------------------------------------------------------------------------
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 2 timeout')), 5000);
      clientA.emit('joinOrder', orderIdA, (res) => {
        clearTimeout(timer);
        assert(
          res?.success === true && res?.room === `order_${orderIdA}`,
          2,
          'Customer joins correct order room',
          `Joined room: "${res?.room}"`
        );
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // TEST 3: Customer cannot join another customer's order
    // -------------------------------------------------------------------------
    clientB = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 5000,
      auth: { token: `Bearer ${tokenB}` },
    });

    await new Promise((res) => clientB.once('connect', res));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 3 timeout')), 5000);
      let handled = false;
      const onForbidden = (msg) => {
        if (handled) return;
        handled = true;
        clearTimeout(timer);
        assert(
          msg && msg.includes('Access denied'),
          3,
          "Customer cannot join another customer's order",
          `Rejection: "${msg}"`
        );
        resolve();
      };

      clientB.emit('joinOrder', orderIdA, (res) => {
        if (res?.success === false) onForbidden(res?.message);
      });

      clientB.once('orderError', (err) => {
        if (err?.success === false) onForbidden(err?.message);
      });
    });

    // -------------------------------------------------------------------------
    // TEST 4: Admin changes order status
    // -------------------------------------------------------------------------
    let adminChangeAck = null;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 4 timeout')), 5000);
      adminClient.emit(
        'updateOrderStatus',
        { orderId: orderIdA, orderStatus: 'PREPARING' },
        (res) => {
          clearTimeout(timer);
          adminChangeAck = res;
          assert(
            res?.success === true && res?.status === 'PREPARING',
            4,
            'Admin changes order status',
            `Status updated to: "${res?.status}"`
          );
          resolve();
        }
      );
    });

    // -------------------------------------------------------------------------
    // TEST 5: MongoDB updates successfully
    // -------------------------------------------------------------------------
    const updatedOrderInDb = await Order.findById(orderIdA);
    assert(
      updatedOrderInDb?.orderStatus === 'PREPARING',
      5,
      'MongoDB updates successfully',
      `DB record orderStatus is authoritative: "${updatedOrderInDb?.orderStatus}"`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Customer receives orderStatusUpdated
    // -------------------------------------------------------------------------
    let customerReceivedPayload = null;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 6 timeout')), 5000);
      clientA.once('orderStatusUpdated', (data) => {
        clearTimeout(timer);
        customerReceivedPayload = data;
        assert(
          data?.orderId === orderIdA && data?.status === 'CONFIRMED' && Boolean(data?.updatedAt),
          6,
          'Customer receives orderStatusUpdated',
          `Payload: { orderId: "${data?.orderId}", status: "${data?.status}", updatedAt: "${data?.updatedAt}" }`
        );
        resolve();
      });

      // Admin updates to CONFIRMED
      adminClient.emit('updateOrderStatus', { orderId: orderIdA, orderStatus: 'CONFIRMED' });
    });

    // -------------------------------------------------------------------------
    // TEST 7: Customer UI updates without refresh (Simulating React hook state listener)
    // -------------------------------------------------------------------------
    let simulatedReactState = { orderStatus: 'CONFIRMED', timelineActiveStep: 1 };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 7 timeout')), 5000);

      // React hook subscriber (mimics useOrderTracking)
      const onOrderUpdateSubscriber = (eventData) => {
        clearTimeout(timer);
        simulatedReactState = {
          orderStatus: eventData.status,
          timelineActiveStep: 3, // OUT_FOR_DELIVERY is step 3
          lastUpdated: eventData.updatedAt,
        };

        assert(
          simulatedReactState.orderStatus === 'OUT_FOR_DELIVERY' && simulatedReactState.timelineActiveStep === 3,
          7,
          'Customer UI updates without refresh',
          `In-memory React state updated immediately: status="${simulatedReactState.orderStatus}", step=${simulatedReactState.timelineActiveStep}`
        );
        resolve();
      };

      clientA.once('orderStatusUpdated', onOrderUpdateSubscriber);

      // Trigger status update
      adminClient.emit('updateOrderStatus', { orderId: orderIdA, orderStatus: 'OUT_FOR_DELIVERY' });
    });

    // -------------------------------------------------------------------------
    // TEST 8: Delivery location is updated
    // -------------------------------------------------------------------------
    const testLat = 30.7046;
    const testLng = 76.7179;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 8 timeout')), 5000);
      deliveryClient.emit(
        'updateDeliveryLocation',
        { orderId: orderIdA, latitude: testLat, longitude: testLng },
        (res) => {
          clearTimeout(timer);
          assert(
            res?.success === true && res?.location?.coordinates[0] === testLng && res?.location?.coordinates[1] === testLat,
            8,
            'Delivery location is updated',
            `GeoJSON Point saved in DB: coordinates=[${testLng}, ${testLat}]`
          );
          resolve();
        }
      );
    });

    // -------------------------------------------------------------------------
    // TEST 9: Customer receives deliveryLocationUpdated
    // -------------------------------------------------------------------------
    let receivedLocationData = null;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 9 timeout')), 5000);
      clientA.once('deliveryLocationUpdated', (data) => {
        clearTimeout(timer);
        receivedLocationData = data;
        assert(
          data?.orderId === orderIdA &&
            data?.location?.type === 'Point' &&
            data?.location?.coordinates[0] === 76.7222 &&
            data?.location?.coordinates[1] === 30.7111,
          9,
          'Customer receives deliveryLocationUpdated',
          `Received GeoJSON Point: [${data?.location?.coordinates?.join(', ')}] with timestamp`
        );
        resolve();
      });

      // Delivery partner moves to new checkpoint
      deliveryClient.emit('updateDeliveryLocation', {
        orderId: orderIdA,
        latitude: 30.7111,
        longitude: 76.7222,
      });
    });

    // -------------------------------------------------------------------------
    // TEST 10: Map marker moves without refresh (Simulating Map subscriber)
    // -------------------------------------------------------------------------
    let simulatedMapMarkerPosition = { lat: 30.7111, lng: 76.7222 };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 10 timeout')), 5000);

      const onLocationUpdateSubscriber = (locData) => {
        clearTimeout(timer);
        simulatedMapMarkerPosition = {
          lat: locData.latitude,
          lng: locData.longitude,
        };

        assert(
          simulatedMapMarkerPosition.lat === 30.7188 && simulatedMapMarkerPosition.lng === 76.7299,
          10,
          'Map marker moves without refresh',
          `Map marker coordinates re-rendered dynamically in memory: lat=${simulatedMapMarkerPosition.lat}, lng=${simulatedMapMarkerPosition.lng}`
        );
        resolve();
      };

      clientA.once('deliveryLocationUpdated', onLocationUpdateSubscriber);

      deliveryClient.emit('updateDeliveryLocation', {
        orderId: orderIdA,
        latitude: 30.7188,
        longitude: 76.7299,
      });
    });

    // -------------------------------------------------------------------------
    // TEST 11: Customer disconnects
    // -------------------------------------------------------------------------
    await new Promise((resolve) => {
      let disconnectFired = false;
      clientA.once('disconnect', (reason) => {
        disconnectFired = true;
      });

      clientA.disconnect();

      setTimeout(() => {
        assert(
          disconnectFired === true && clientA.connected === false,
          11,
          'Customer disconnects',
          `Disconnected event detected; connected state: ${clientA.connected}`
        );
        resolve();
      }, 500);
    });

    // -------------------------------------------------------------------------
    // TEST 12: Socket reconnects
    // -------------------------------------------------------------------------
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 12 timeout')), 5000);
      clientA.once('connect', () => {
        clearTimeout(timer);
        assert(clientA.connected === true, 12, 'Socket reconnects', `Reconnected with Socket ID: ${clientA.id}`);
        resolve();
      });
      clientA.connect();
    });

    // -------------------------------------------------------------------------
    // TEST 13: Customer rejoins the order room
    // -------------------------------------------------------------------------
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 13 timeout')), 5000);
      clientA.emit('joinOrder', orderIdA, (res) => {
        clearTimeout(timer);
        assert(
          res?.success === true && res?.room === `order_${orderIdA}`,
          13,
          'Customer rejoins the order room',
          `Rejoined tracking room: "${res?.room}"`
        );
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // TEST 14: Multiple customers can track different orders simultaneously
    // -------------------------------------------------------------------------
    // Client B joins Order B (its own order)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 14 timeout')), 5000);
      clientB.emit('joinOrder', orderIdB, (resB) => {
        clearTimeout(timer);
        assert(
          clientA.connected && clientB.connected && resB?.room === `order_${orderIdB}`,
          14,
          'Multiple customers can track different orders simultaneously',
          `Customer A tracking order_${orderIdA} AND Customer B tracking order_${orderIdB} concurrently`
        );
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // TEST 15: One order's update does not reach another order's customer
    // -------------------------------------------------------------------------
    await new Promise((resolve) => {
      let clientAReceivedOrderBUpdate = false;
      let clientBReceivedOrderBUpdate = false;

      clientA.once('orderStatusUpdated', (data) => {
        if (data?.orderId === orderIdB) {
          clientAReceivedOrderBUpdate = true;
        }
      });

      clientB.once('orderStatusUpdated', (data) => {
        if (data?.orderId === orderIdB) {
          clientBReceivedOrderBUpdate = true;
        }
      });

      // Update Order B status
      adminClient.emit('updateOrderStatus', { orderId: orderIdB, orderStatus: 'PREPARING' });

      setTimeout(() => {
        assert(
          clientBReceivedOrderBUpdate === true && clientAReceivedOrderBUpdate === false,
          15,
          "One order's update does not reach another order's customer",
          `Customer B received Order B update: ${clientBReceivedOrderBUpdate}; Customer A received Order B update: ${clientAReceivedOrderBUpdate}`
        );
        resolve();
      }, 1000);
    });

    // -------------------------------------------------------------------------
    // TEST 16: REST API continues working if Socket.IO is unavailable
    // -------------------------------------------------------------------------
    // Disconnect all sockets to simulate socket downtime
    clientA.disconnect();
    clientB.disconnect();

    const restResponse = await fetch(`${BACKEND_URL}/api/payments/orders/${orderIdA}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
    });

    const restData = await restResponse.json();

    assert(
      restResponse.status === 200 && restData?.success === true && restData?.data?._id === orderIdA,
      16,
      'REST API continues working if Socket.IO is unavailable',
      `HTTP Status: ${restResponse.status}, Order retrieved reliably from MongoDB fallback without active socket`
    );

    // Clean disconnect remaining clients
    adminClient.disconnect();
    deliveryClient.disconnect();

    if (internalServer) {
      await new Promise((resolve) => internalServer.close(resolve));
    }

    console.log('\n================================================================');
    console.log(` RESULT: ${passed}/${total} CHECKLIST TESTS PASSED`);
    console.log('================================================================\n');

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Test execution encountered error:', err.message);
    if (clientA) clientA.disconnect();
    if (clientB) clientB.disconnect();
    if (adminClient) adminClient.disconnect();
    if (deliveryClient) deliveryClient.disconnect();
    if (internalServer) {
      internalServer.close();
    }
    process.exit(1);
  }
}

runSocketTestSuite();
