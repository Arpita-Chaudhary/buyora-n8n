'use client';

import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { getStoredAuth } from './auth';

// Backend Socket.IO server URL
const SOCKET_SERVER_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:5000';

// Module-level singleton instance - prevents multiple connections across re-renders
let socketInstance = null;

/**
 * Get or create the reusable singleton Socket.IO client instance.
 * Guaranteed to execute only on the client side (SSR-safe).
 * Authenticates using the existing JWT / auth storage session.
 *
 * @returns {import('socket.io-client').Socket | null} Active Socket client
 */
export function getSocket(overrideToken = null) {
  // Ensure socket is never instantiated during Next.js server-side rendering
  if (typeof window === 'undefined') {
    return null;
  }

  const resolveToken = () => {
    if (overrideToken) return overrideToken;
    try {
      const auth = getStoredAuth();
      return auth?.token || localStorage.getItem('admin_token') || localStorage.getItem('token') || null;
    } catch {
      return null;
    }
  };

  const currentToken = resolveToken();
  const bearerToken = currentToken
    ? (String(currentToken).startsWith('Bearer ') ? currentToken : `Bearer ${currentToken}`)
    : null;

  // Reuse existing connection if already initialized and active
  if (!socketInstance) {
    console.log(`[Socket.IO Client] Initializing singleton connection to ${SOCKET_SERVER_URL}`);

    socketInstance = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity, // Automatically attempt reconnection indefinitely
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 20000,
      // Authenticate the Socket.IO connection using the existing JWT/token mechanism
      auth: (cb) => {
        const token = resolveToken();
        cb({
          token: token ? (String(token).startsWith('Bearer ') ? token : `Bearer ${token}`) : null,
        });
      },
    });

    socketInstance.on('connect', () => {
      console.log(`[Socket.IO Client] Connected to backend server with ID: ${socketInstance.id}`);
    });

    socketInstance.on('connect_error', (error) => {
      console.warn(`[Socket.IO Client] Connection error:`, error.message);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log(`[Socket.IO Client] Disconnected: ${reason}`);
    });

    socketInstance.on('reconnect', (attemptNumber) => {
      console.log(`[Socket.IO Client] Successfully reconnected after ${attemptNumber} attempts`);
    });
  } else {
    // If socket exists but token switched (e.g., navigated to Admin Simulator)
    if (bearerToken && socketInstance.auth?.token !== bearerToken) {
      console.log('[Socket.IO Client] Session context switch detected. Reconnecting with new auth token...');
      socketInstance.auth = { token: bearerToken };
      socketInstance.disconnect().connect();
    } else if (!socketInstance.connected && socketInstance.disconnected) {
      socketInstance.connect();
    }
  }

  return socketInstance;
}

/**
 * Manually switch or update the active authentication token on the socket.
 *
 * @param {string} token - Raw or Bearer JWT token
 */
export function setSocketAuthToken(token) {
  if (typeof window === 'undefined' || !token) return;
  const bearerToken = String(token).startsWith('Bearer ') ? token : `Bearer ${token}`;
  if (socketInstance) {
    if (socketInstance.auth?.token !== bearerToken) {
      socketInstance.auth = { token: bearerToken };
      socketInstance.disconnect().connect();
    }
  } else {
    getSocket(bearerToken);
  }
}

/**
 * Disconnect the singleton Socket.IO instance cleanly.
 */
export function disconnectSocket() {
  if (socketInstance) {
    console.log('[Socket.IO Client] Disconnecting active socket instance.');
    socketInstance.disconnect();
    socketInstance = null;
  }
}

/**
 * React hook to access the singleton Socket.IO client and connection status.
 * Safe for client-side use in Next.js components.
 *
 * @param {string} [explicitToken] - Optional token override (e.g. admin_token on simulator)
 * @returns {{ socket: import('socket.io-client').Socket | null, isConnected: boolean }}
 */
export function useSocket(explicitToken = null) {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Only runs in the browser
    const client = getSocket(explicitToken);
    if (!client) return;

    setSocket(client);
    setIsConnected(client.connected);

    const onConnect = () => {
      console.log('[Socket Hook] Live tracking connected');
      setIsConnected(true);
    };

    const onDisconnect = (reason) => {
      console.log('[Socket Hook] Live tracking disconnected:', reason);
      setIsConnected(false);
    };

    const onConnectError = (err) => {
      console.warn('[Socket Hook] Connection error:', err.message);
      setIsConnected(false);
    };

    client.on('connect', onConnect);
    client.on('disconnect', onDisconnect);
    client.on('connect_error', onConnectError);
    client.on('reconnect', onConnect);

    return () => {
      client.off('connect', onConnect);
      client.off('disconnect', onDisconnect);
      client.off('connect_error', onConnectError);
      client.off('reconnect', onConnect);
    };
  }, []);

  return { socket, isConnected };
}

/**
 * React hook dedicated to real-time order tracking.
 * Joins the order room on mount, listens for real-time status changes,
 * automatically rejoins the order room when connection is restored,
 * and leaves the room cleanly on unmount.
 *
 * @param {string} orderId - ID of the order to track in real time
 * @param {function} onOrderUpdate - Callback invoked when status update is received
 * @param {function} [onLocationUpdate] - Optional callback invoked when live delivery location is received
 * @returns {{ isConnected: boolean, lastUpdate: object | null, lastLocation: object | null }}
 */
export function useOrderTracking(orderId, onOrderUpdate, onLocationUpdate) {
  const { socket, isConnected } = useSocket();
  const [lastUpdate, setLastUpdate] = useState(null);
  const [lastLocation, setLastLocation] = useState(null);
  const callbackRef = useRef(onOrderUpdate);
  const locationCallbackRef = useRef(onLocationUpdate);

  // Keep callback references updated without triggering re-subscriptions
  useEffect(() => {
    callbackRef.current = onOrderUpdate;
  }, [onOrderUpdate]);

  useEffect(() => {
    locationCallbackRef.current = onLocationUpdate;
  }, [onLocationUpdate]);

  useEffect(() => {
    if (!socket || !orderId) return;

    const joinCurrentOrderRoom = () => {
      console.log(`[Order Tracking Hook] Joining order room for order: ${orderId}`);
      socket.emit('joinOrder', orderId);
    };

    // 1. Join room immediately if socket is currently connected
    if (socket.connected) {
      joinCurrentOrderRoom();
    }

    // 5. When the connection is restored:
    //    - reconnect the socket (handled by auto reconnection)
    //    - rejoin the current order room
    //    - continue receiving order updates
    const handleConnectOrReconnect = () => {
      console.log(`[Order Tracking Hook] Connection restored. Rejoining order room for order: ${orderId}`);
      joinCurrentOrderRoom();
    };

    // 2. Event listener for order status updates sent strictly to this order room
    const handleStatusUpdate = (payload) => {
      if (
        payload &&
        (String(payload.orderId) === String(orderId) ||
          String(payload.order?._id) === String(orderId) ||
          String(payload.order?.stripePaymentIntentId) === String(orderId))
      ) {
        console.log(`[Order Tracking Hook] Real-time order update received:`, payload);
        setLastUpdate(payload);
        if (callbackRef.current) {
          callbackRef.current(payload);
        }
      }
    };

    // 2b. Event listener for live delivery-partner location updates: deliveryLocationUpdated
    const handleLocationUpdate = (payload) => {
      if (
        payload &&
        (String(payload.orderId) === String(orderId) ||
          String(payload.order?._id) === String(orderId))
      ) {
        console.log(`[Order Tracking Hook] Real-time delivery location received:`, payload);
        setLastLocation(payload);
        if (locationCallbackRef.current) {
          locationCallbackRef.current(payload);
        }
      }
    };

    const handleOrderError = (err) => {
      console.warn(`[Order Tracking Hook] Validation notice for order ${orderId}:`, err?.message);
    };

    socket.on('connect', handleConnectOrReconnect);
    socket.on('reconnect', handleConnectOrReconnect);
    socket.on('orderStatusUpdated', handleStatusUpdate);
    socket.on('deliveryLocationUpdated', handleLocationUpdate);
    socket.on('orderError', handleOrderError);

    // 3. Cleanup on unmount or when orderId changes: remove from room and detach listeners
    return () => {
      socket.emit('leaveOrder', orderId);
      socket.off('connect', handleConnectOrReconnect);
      socket.off('reconnect', handleConnectOrReconnect);
      socket.off('orderStatusUpdated', handleStatusUpdate);
      socket.off('deliveryLocationUpdated', handleLocationUpdate);
      socket.off('orderError', handleOrderError);
      console.log(`[Order Tracking Hook] Left tracking room for order: ${orderId}`);
    };
  }, [socket, orderId]);

  return { isConnected, lastUpdate, lastLocation };
}

/**
 * Helper to emit a live delivery location update via Socket.IO
 *
 * @param {string} orderId
 * @param {{ latitude: number, longitude: number }} coords
 */
export function emitDeliveryLocationUpdate(orderId, { latitude, longitude }) {
  const socket = getSocket();
  if (socket && orderId) {
    socket.emit('updateDeliveryLocation', { orderId, latitude, longitude });
  }
}
