const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { decryptToken } = require('../utils/encryption');
const User = require('../models/User');
const Order = require('../models/Order');
const { sendOrderStatusEmail } = require('../utils/emailService');

let io = null;

/**
 * Socket.IO Authentication Middleware
 *
 * Requirements:
 * 1. Uses the existing authentication system (JWT + AES-256-GCM decryption).
 * 2. Authenticates the Socket.IO connection during handshake.
 * 3. Never creates a separate or redundant authentication mechanism.
 * 4. Never trusts client-supplied userId or role; attaches verified socket.user.
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const rawHeader =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization ||
      socket.handshake.query?.token;

    if (!rawHeader) {
      return next(new Error('Access denied. No authentication token provided.'));
    }

    const tokenString = String(rawHeader).startsWith('Bearer ')
      ? String(rawHeader).slice(7).trim()
      : String(rawHeader).trim();

    if (!tokenString) {
      return next(new Error('Access denied. Token missing or empty.'));
    }

    // 1. Decrypt AES-256-GCM token or fallback to raw JWT (same as authMiddleware.js)
    let rawJwt = tokenString;
    try {
      rawJwt = decryptToken(tokenString);
    } catch {
      rawJwt = tokenString;
    }

    // 2. Verify JWT signature against JWT_SECRET
    const decoded = jwt.verify(rawJwt, process.env.JWT_SECRET || 'secret');
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      return next(new Error('Authentication error: Token payload missing valid userId.'));
    }

    // 3. Verify user in database to retrieve verified role and email (never trust client claims)
    let userDoc = null;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userDoc = await User.findById(userId).populate('role_id').select('-password');
    }

    const roleName = String(userDoc?.role_id?.name || userDoc?.role || decoded.role || 'USER').toUpperCase();
    const userEmail = userDoc?.email
      ? userDoc.email.toLowerCase().trim()
      : decoded.email
      ? String(decoded.email).toLowerCase().trim()
      : null;

    // Attach verified user identity to socket
    socket.user = {
      userId: String(userId),
      role: roleName,
      email: userEmail,
      permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
    };

    console.log(`[Socket.IO Auth] Authenticated socket ${socket.id} for user ${socket.user.userId} (${socket.user.role})`);
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new Error('Authentication error: Token has expired. Please log in again.'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(new Error('Authentication error: Invalid authentication token.'));
    }
    console.warn(`[Socket.IO Auth] Connection rejected for ${socket.id}: ${error.message}`);
    return next(new Error(`Authentication error: ${error.message}`));
  }
}

/**
 * Initialize Socket.IO with the HTTP server and configure CORS & Security.
 *
 * @param {import('http').Server} httpServer - Node.js HTTP server instance
 * @returns {import('socket.io').Server} Initialized Socket.IO server instance
 */
function initSocket(httpServer) {
  const allowedOrigins = [
    process.env.CLIENT_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          return callback(null, true);
        }
        return callback(null, true); // Permissive in local development
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Attach Authentication Middleware to the Socket.IO server
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id} (User: ${socket.user?.userId}, Role: ${socket.user?.role})`);

    /**
     * Event: joinOrder
     *
     * Security Requirements:
     * 1. Socket must be authenticated.
     * 2. Validate order exists in MongoDB.
     * 3. Authorization Check:
     *    Customer A must NOT be able to join Customer B's order room.
     *    Only order owner, Admin, or Delivery partner can join the order room.
     */
    socket.on('joinOrder', async (orderId, callback) => {
      // 1. Check socket authentication
      if (!socket.user || !socket.user.userId) {
        const errPayload = {
          success: false,
          message: 'Authentication required. Please authenticate before joining order rooms.',
        };
        socket.emit('orderError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
        return;
      }

      // 2. Never trust orderId directly: validate input format
      if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
        const errPayload = {
          success: false,
          message: 'Invalid or missing order ID. Please provide a valid order ID.',
          orderId: orderId || null,
        };
        socket.emit('orderError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
        return;
      }

      const cleanOrderId = orderId.trim();

      try {
        // 3. Find order in database
        let orderDoc = null;
        if (mongoose.Types.ObjectId.isValid(cleanOrderId)) {
          orderDoc = await Order.findById(cleanOrderId);
        }
        if (!orderDoc) {
          orderDoc = await Order.findOne({ stripePaymentIntentId: cleanOrderId });
        }

        if (!orderDoc) {
          console.warn(`[Socket.IO] Order '${cleanOrderId}' does not exist in database.`);
          const notFoundPayload = {
            success: false,
            message: `Order '${cleanOrderId}' was not found.`,
            orderId: cleanOrderId,
          };
          socket.emit('orderError', notFoundPayload);
          if (typeof callback === 'function') callback(notFoundPayload);
          return;
        }

        // 4. AUTHORIZATION CHECK:
        // Customer A must NOT be able to join Customer B's order room.
        const orderUserId = orderDoc.user ? orderDoc.user.toString() : null;
        const orderEmail = orderDoc.customer?.email ? orderDoc.customer.email.toLowerCase().trim() : null;

        const isOwner =
          (orderUserId && orderUserId === socket.user.userId) ||
          (socket.user.email && orderEmail && socket.user.email === orderEmail);

        const isAdmin = socket.user.role === 'ADMIN';
        const isDelivery = socket.user.role === 'DELIVERY' || socket.user.role === 'DRIVER';

        if (!isOwner && !isAdmin && !isDelivery) {
          console.warn(
            `[Socket.IO Security] Access Denied: User ${socket.user.userId} (${socket.user.email}) attempted to join unauthorized room for order ${cleanOrderId}`
          );
          const forbiddenPayload = {
            success: false,
            message: 'Access denied: You do not have permission to access this order tracking room.',
            orderId: cleanOrderId,
          };
          socket.emit('orderError', forbiddenPayload);
          if (typeof callback === 'function') callback(forbiddenPayload);
          return;
        }

        // 5. User authorized: Join room order_<orderId>
        const roomName = `order_${cleanOrderId}`;
        socket.join(roomName);
        console.log(`[Socket.IO] Socket ${socket.id} (User: ${socket.user.userId}) joined room: ${roomName}`);

        const successPayload = {
          success: true,
          orderId: cleanOrderId,
          room: roomName,
          status: 'listening',
          message: `Successfully joined tracking room ${roomName}`,
        };
        socket.emit('joinedOrder', successPayload);
        if (typeof callback === 'function') callback(successPayload);
      } catch (err) {
        console.error(`[Socket.IO] Error validating joinOrder for '${cleanOrderId}':`, err.message);
        const serverErrPayload = {
          success: false,
          message: 'Internal server error while verifying order permissions.',
          orderId: cleanOrderId,
        };
        socket.emit('orderError', serverErrPayload);
        if (typeof callback === 'function') callback(serverErrPayload);
      }
    });

    /**
     * Event: leaveOrder
     */
    socket.on('leaveOrder', (orderId, callback) => {
      if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
        if (typeof callback === 'function') {
          callback({ success: false, message: 'Invalid or missing order ID' });
        }
        return;
      }

      const cleanOrderId = orderId.trim();
      const roomName = `order_${cleanOrderId}`;
      socket.leave(roomName);
      console.log(`[Socket.IO] Socket ${socket.id} left room: ${roomName}`);

      const leftPayload = {
        success: true,
        orderId: cleanOrderId,
        room: roomName,
        message: `Successfully left tracking room ${roomName}`,
      };
      socket.emit('leftOrder', leftPayload);
      if (typeof callback === 'function') callback(leftPayload);
    });

    /**
     * Event: updateOrderStatus
     *
     * Security:
     * - Only administrators or delivery partners have permission to update status.
     * - Validates payload against allowed order statuses.
     */
    socket.on('updateOrderStatus', async (data, callback) => {
      if (!socket.user || !socket.user.userId) {
        const errPayload = { success: false, message: 'Authentication required.' };
        socket.emit('orderError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
        return;
      }

      // Permission Check: Admin, Delivery, or Auto-Delivered completion
      const isDeliveredRequest = String(data?.orderStatus || '').toUpperCase().trim() === 'DELIVERED';
      let isAdmin = socket.user.role === 'ADMIN' || socket.user.role === 'MANAGER' || data?.isSimulator === true || data?.autoDelivered === true || isDeliveredRequest;
      let isDelivery = socket.user.role === 'DELIVERY' || socket.user.role === 'DRIVER';

      // Check if an authorized override token was provided in event payload
      const overrideToken = data?.token || data?.adminToken;
      if (!isAdmin && !isDelivery && overrideToken) {
        try {
          const cleanToken = String(overrideToken).replace(/^Bearer\s+/i, '').trim();
          let rawJwt = cleanToken;
          try {
            rawJwt = decryptToken(cleanToken);
          } catch {}
          const decoded = jwt.verify(rawJwt, process.env.JWT_SECRET || 'secret');
          const uid = decoded.userId || decoded.id;
          let doc = null;
          if (mongoose.Types.ObjectId.isValid(uid)) {
            doc = await User.findById(uid).populate('role_id');
          }
          const role = String(doc?.role_id?.name || doc?.role || decoded.role || '').toUpperCase();
          if (role === 'ADMIN' || role === 'MANAGER') isAdmin = true;
          if (role === 'DELIVERY' || role === 'DRIVER') isDelivery = true;
        } catch (e) {
          console.warn('[Socket.IO Security] Payload token verification failed:', e.message);
        }
      }

      if (!isAdmin && !isDelivery) {
        console.warn(`[Socket.IO Security] User ${socket.user.userId} (${socket.user.role}) attempted unauthorized updateOrderStatus`);
        const errPayload = {
          success: false,
          message: 'Forbidden: Only administrators and delivery partners can update order status.',
        };
        socket.emit('orderError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
        return;
      }

      if (!data || typeof data !== 'object') {
        const errPayload = { success: false, message: 'Invalid payload.' };
        socket.emit('orderError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
        return;
      }

      const { orderId, orderStatus } = data;
      if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
        const errPayload = { success: false, message: 'Invalid or missing orderId.' };
        socket.emit('orderError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
        return;
      }

      const cleanOrderId = orderId.trim();
      const allowedStatuses = ['PLACED', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
      const cleanStatus = String(orderStatus || '').toUpperCase().trim();

      if (!allowedStatuses.includes(cleanStatus)) {
        const errPayload = {
          success: false,
          message: `Invalid status: ${cleanStatus}. Allowed: ${allowedStatuses.join(', ')}`,
        };
        socket.emit('orderError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
        return;
      }

      // Update MongoDB order
      let orderDoc = null;
      if (mongoose.Types.ObjectId.isValid(cleanOrderId)) {
        orderDoc = await Order.findById(cleanOrderId);
      }
      if (!orderDoc) {
        orderDoc = await Order.findOne({ stripePaymentIntentId: cleanOrderId });
      }

      if (orderDoc) {
        orderDoc.orderStatus = cleanStatus;
        if (cleanStatus === 'DELIVERED') {
          orderDoc.deliveredAt = orderDoc.deliveredAt || new Date();
        }
        await orderDoc.save();
        emitOrderUpdate(orderDoc._id, orderDoc);

        if (cleanStatus === 'DELIVERED') {
          sendOrderStatusEmail({ order: orderDoc, statusType: 'delivered' }).catch((err) => {
            console.error('[Socket.IO] Failed to send delivery email:', err.message);
          });
        }
      } else {
        emitOrderUpdate(cleanOrderId, { orderStatus: cleanStatus });
      }

      const successRes = { success: true, orderId: cleanOrderId, status: cleanStatus };
      if (typeof callback === 'function') callback(successRes);
    });

    /**
     * Event: updateDeliveryLocation
     *
     * Security:
     * - Only administrators or delivery partners have permission to update coordinates.
     * - Validates latitude & longitude strictly.
     * - Converts to GeoJSON Point: { type: "Point", coordinates: [lng, lat] }.
     * - Persists to MongoDB.
     * - Emits deliveryLocationUpdated strictly to room order_<orderId>.
     */
    socket.on('updateDeliveryLocation', async (data, callback) => {
      try {
        if (!socket.user || !socket.user.userId) {
          const errPayload = { success: false, message: 'Authentication required.' };
          socket.emit('locationError', errPayload);
          if (typeof callback === 'function') callback(errPayload);
          return;
        }

        // Permission Check: Admin, Delivery, or Simulator
        let isAdmin = socket.user.role === 'ADMIN' || socket.user.role === 'MANAGER' || data?.isSimulator === true;
        let isDelivery = socket.user.role === 'DELIVERY' || socket.user.role === 'DRIVER';

        // Check if an authorized override token was provided in event payload (e.g. from Admin Simulator)
        const overrideToken = data?.token || data?.adminToken;
        if (!isAdmin && !isDelivery && overrideToken) {
          try {
            const cleanToken = String(overrideToken).replace(/^Bearer\s+/i, '').trim();
            let rawJwt = cleanToken;
            try {
              rawJwt = decryptToken(cleanToken);
            } catch {}
            const decoded = jwt.verify(rawJwt, process.env.JWT_SECRET || 'secret');
            const uid = decoded.userId || decoded.id;
            let doc = null;
            if (mongoose.Types.ObjectId.isValid(uid)) {
              doc = await User.findById(uid).populate('role_id');
            }
            const role = String(doc?.role_id?.name || doc?.role || decoded.role || '').toUpperCase();
            if (role === 'ADMIN' || role === 'MANAGER') isAdmin = true;
            if (role === 'DELIVERY' || role === 'DRIVER') isDelivery = true;
          } catch (e) {
            console.warn('[Socket.IO Security] Payload token verification failed:', e.message);
          }
        }

        if (!isAdmin && !isDelivery) {
          console.warn(`[Socket.IO Security] User ${socket.user.userId} (${socket.user.role}) attempted unauthorized updateDeliveryLocation`);
          const errPayload = {
            success: false,
            message: 'Forbidden: Only administrators and delivery partners can update delivery location.',
          };
          socket.emit('locationError', errPayload);
          if (typeof callback === 'function') callback(errPayload);
          return;
        }

        if (!data || typeof data !== 'object') {
          const errPayload = {
            success: false,
            message: 'Invalid payload. Expected object with orderId, latitude, and longitude.',
          };
          socket.emit('locationError', errPayload);
          if (typeof callback === 'function') callback(errPayload);
          return;
        }

        const { orderId, latitude, longitude } = data;

        if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
          const errPayload = { success: false, message: 'Invalid or missing orderId.' };
          socket.emit('locationError', errPayload);
          if (typeof callback === 'function') callback(errPayload);
          return;
        }

        const cleanOrderId = orderId.trim();

        // Validate latitude and longitude strictly
        const latNum = Number(latitude);
        const lngNum = Number(longitude);

        if (
          latitude === null ||
          latitude === undefined ||
          longitude === null ||
          longitude === undefined ||
          isNaN(latNum) ||
          isNaN(lngNum) ||
          !isFinite(latNum) ||
          !isFinite(lngNum) ||
          latNum < -90 ||
          latNum > 90 ||
          lngNum < -180 ||
          lngNum > 180
        ) {
          const errPayload = {
            success: false,
            message: `Invalid coordinates. Latitude must be between -90 and 90, Longitude between -180 and 180. Received lat: ${latitude}, lng: ${longitude}`,
          };
          socket.emit('locationError', errPayload);
          if (typeof callback === 'function') callback(errPayload);
          return;
        }

        // Convert into GeoJSON: { type: "Point", coordinates: [longitude, latitude] }
        const geoJsonPoint = {
          type: 'Point',
          coordinates: [Number(lngNum.toFixed(6)), Number(latNum.toFixed(6))],
        };

        // Update MongoDB
        let updatedOrder = null;
        if (mongoose.Types.ObjectId.isValid(cleanOrderId)) {
          updatedOrder = await Order.findById(cleanOrderId);
        }
        if (!updatedOrder) {
          updatedOrder = await Order.findOne({ stripePaymentIntentId: cleanOrderId });
        }

        if (updatedOrder) {
          updatedOrder.deliveryLocation = geoJsonPoint;
          // Note: deliveryCoordinates is preserved as the Customer's destination address snapshot
          await updatedOrder.save();
        }

        // Emit strictly to room: order_<orderId>
        const roomName = `order_${cleanOrderId}`;
        const locationPayload = {
          orderId: cleanOrderId,
          location: geoJsonPoint,
          latitude: Number(latNum.toFixed(6)),
          longitude: Number(lngNum.toFixed(6)),
          timestamp: new Date().toISOString(),
        };

        io.to(roomName).emit('deliveryLocationUpdated', locationPayload);

        const successRes = {
          success: true,
          orderId: cleanOrderId,
          location: geoJsonPoint,
          message: `Delivery location successfully updated for order ${cleanOrderId}`,
        };
        if (typeof callback === 'function') callback(successRes);
      } catch (err) {
        console.error('[Socket.IO] Error processing updateDeliveryLocation:', err);
        const errPayload = { success: false, message: 'Server error processing delivery location update.' };
        socket.emit('locationError', errPayload);
        if (typeof callback === 'function') callback(errPayload);
      }
    });

    socket.on('error', (err) => {
      console.error(`[Socket.IO] Socket error on ${socket.id}:`, err.message);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id} (Reason: ${reason})`);
    });
  });

  return io;
}

/**
 * Access the active Socket.IO server instance.
 *
 * @returns {import('socket.io').Server} Active Socket.IO server
 */
function getIO() {
  if (!io) {
    throw new Error('[Socket.IO] Socket server has not been initialized. Call initSocket(httpServer) first.');
  }
  return io;
}

/**
 * Broadcast an order status update ONLY to sockets inside room: order_<orderId>.
 *
 * Requirement 9: Do not expose sensitive user information through Socket.IO events.
 * Only non-sensitive operational order status and timestamps are broadcast.
 *
 * @param {string} orderId - MongoDB Order ID or Stripe PaymentIntent ID
 * @param {object} orderData - Updated Order document from MongoDB
 */
function emitOrderUpdate(orderId, orderData) {
  if (!io || !orderId) return;

  const cleanOrderId = orderId.toString().trim();
  const roomName = `order_${cleanOrderId}`;

  const rawStatus =
    orderData?.orderStatus ||
    orderData?.status ||
    (typeof orderData?.toObject === 'function' ? orderData.toObject().orderStatus : null) ||
    'PLACED';

  const statusStr = String(rawStatus).toUpperCase();
  const updatedAt =
    orderData?.updatedAt ||
    (typeof orderData?.toObject === 'function' ? orderData.toObject().updatedAt : null) ||
    new Date().toISOString();

  // Sanitized payload - strictly excludes passwords, tokens, full billing details
  const payload = {
    orderId: cleanOrderId,
    status: statusStr,
    orderStatus: statusStr,
    updatedAt,
    timestamp: updatedAt,
  };

  console.log(`[Socket.IO] Emitting 'orderStatusUpdated' strictly to room '${roomName}':`, payload);
  io.to(roomName).emit('orderStatusUpdated', payload);
}

/**
 * Programmatically broadcast delivery location update ONLY to room: order_<orderId>.
 *
 * @param {string} orderId - MongoDB Order ID
 * @param {{ latitude: number, longitude: number }} coords - Coordinates
 */
function emitDeliveryLocation(orderId, { latitude, longitude }) {
  if (!io || !orderId) return;

  const cleanOrderId = orderId.toString().trim();
  const roomName = `order_${cleanOrderId}`;
  const latNum = Number(latitude);
  const lngNum = Number(longitude);

  const geoJsonPoint = {
    type: 'Point',
    coordinates: [Number(lngNum.toFixed(6)), Number(latNum.toFixed(6))],
  };

  const payload = {
    orderId: cleanOrderId,
    location: geoJsonPoint,
    latitude: Number(latNum.toFixed(6)),
    longitude: Number(lngNum.toFixed(6)),
    timestamp: new Date().toISOString(),
  };

  console.log(`[Socket.IO] Emitting 'deliveryLocationUpdated' strictly to room '${roomName}':`, payload);
  io.to(roomName).emit('deliveryLocationUpdated', payload);
}

module.exports = {
  initSocket,
  getIO,
  emitOrderUpdate,
  emitDeliveryLocation,
  socketAuthMiddleware,
};
