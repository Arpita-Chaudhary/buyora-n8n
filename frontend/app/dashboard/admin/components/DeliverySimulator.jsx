'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useSocket, setSocketAuthToken } from '../../../../utils/socket';

/**
 * Helper to dynamically generate a 5-step delivery route leading directly
 * from a store hub towards the selected customer's actual delivery destination.
 *
 * This ensures the scooter moves towards the customer's address rather than
 * an arbitrary static location in the opposite direction.
 */
function generateRouteStepsForDestination(destLat, destLng) {
  const targetLat = Number(destLat) || 30.7094;
  const targetLng = Number(destLng) || 76.7131;

  // Offset store hub ~1.2km away so there is a realistic transit path towards destination
  const startLat = targetLat - 0.0120;
  const startLng = targetLng - 0.0110;

  const dLat = targetLat - startLat;
  const dLng = targetLng - startLng;

  return [
    {
      step: 1,
      name: 'Start Location',
      label: 'Store / Fulfillment Hub',
      icon: '🏪',
      latitude: Number(startLat.toFixed(4)),
      longitude: Number(startLng.toFixed(4)),
      description: 'Order packed & picked up by delivery partner',
    },
    {
      step: 2,
      name: 'Location 1',
      label: 'Dispatched / En Route',
      icon: '📍',
      latitude: Number((startLat + dLat * 0.25).toFixed(4)),
      longitude: Number((startLng + dLng * 0.25).toFixed(4)),
      description: 'Rider on arterial road moving towards customer sector',
    },
    {
      step: 3,
      name: 'Location 2',
      label: 'Midway Transit',
      icon: '📍',
      latitude: Number((startLat + dLat * 0.50).toFixed(4)),
      longitude: Number((startLng + dLng * 0.50).toFixed(4)),
      description: 'Halfway through the route, moving at steady pace',
    },
    {
      step: 4,
      name: 'Location 3',
      label: 'Approaching Locality',
      icon: '📍',
      latitude: Number((startLat + dLat * 0.75).toFixed(4)),
      longitude: Number((startLng + dLng * 0.75).toFixed(4)),
      description: 'Entering customer street/neighborhood, reaching soon',
    },
    {
      step: 5,
      name: 'Customer Location',
      label: 'Customer Doorstep',
      icon: '🏠',
      latitude: Number(targetLat.toFixed(4)),
      longitude: Number(targetLng.toFixed(4)),
      description: 'Arrived at delivery address. Order delivered!',
    },
  ];
}

export default function DeliverySimulator({ token, initialOrderId = '' }) {
  const [activeToken, setActiveToken] = useState(
    token || (typeof window !== 'undefined' ? (localStorage.getItem('admin_token') || localStorage.getItem('token')) : '')
  );
  const { socket, isConnected } = useSocket(activeToken);

  // Form State
  const [orderId, setOrderId] = useState(initialOrderId);
  const [latitude, setLatitude] = useState('30.6974');
  const [longitude, setLongitude] = useState('76.7021');
  const [isSending, setIsSending] = useState(false);
  const [isSwitchingAuth, setIsSwitchingAuth] = useState(false);
  const [hasAuthError, setHasAuthError] = useState(false);

  // Delivered Confirmation Prompt State (Admin Panel Prompt on Arrival)
  const [showDeliveredPrompt, setShowDeliveredPrompt] = useState(false);
  const [isMarkingDelivered, setIsMarkingDelivered] = useState(false);

  // Route Simulation State
  const [activeStep, setActiveStep] = useState(null);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const autoPlayTimerRef = useRef(null);

  // Customer Destination Coordinates (defaults to Phase 7 / Sector 60 Hub)
  const [destinationCoords, setDestinationCoords] = useState({ latitude: 30.7094, longitude: 76.7131 });

  // Dynamically compute the 5 steps leading directly to the customer's actual destination
  const routeSteps = useMemo(() => {
    return generateRouteStepsForDestination(destinationCoords.latitude, destinationCoords.longitude);
  }, [destinationCoords.latitude, destinationCoords.longitude]);

  // Telemetry Log State
  const [logs, setLogs] = useState([]);

  const addLog = (message, type = 'info', data = null) => {
    const entry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      message,
      type, // 'info' | 'success' | 'warn' | 'error'
      data,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 49)]);
  };

  // Optional lookup of destination coordinates when user manually enters a 24-char ObjectId
  useEffect(() => {
    const trimmed = (orderId || '').trim();
    if (!trimmed || trimmed.length !== 24) return;

    let isMounted = true;
    const lookupOrder = async () => {
      try {
        const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null);
        const res = await fetch(`/api/payments/orders/${trimmed}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        const data = await res.json();
        const ord = data.data || data.order;
        if (isMounted && data.success && ord) {
          let destLat = ord.deliveryCoordinates?.latitude;
          let destLng = ord.deliveryCoordinates?.longitude;
          if (!destLat || !destLng || isNaN(Number(destLat)) || isNaN(Number(destLng)) || Math.abs(Number(destLat)) < 1) {
            const addr = (ord.customer?.shippingAddress?.address || '').toLowerCase();
            if (addr.includes('phase 7') || addr.includes('sector 60')) {
              destLat = 30.7094;
              destLng = 76.7131;
            } else {
              destLat = 30.7188;
              destLng = 76.7299;
            }
          }
          const finalLat = Number(destLat);
          const finalLng = Number(destLng);
          setDestinationCoords({ latitude: finalLat, longitude: finalLng });
          const steps = generateRouteStepsForDestination(finalLat, finalLng);
          setLatitude(String(steps[0].latitude));
          setLongitude(String(steps[0].longitude));
          setActiveStep(1);
          addLog(
            `Targeting Order #${trimmed.substring(trimmed.length - 6).toUpperCase()} Destination: [${finalLat}, ${finalLng}]`,
            'info'
          );
        }
      } catch (_) {}
    };

    lookupOrder();
    return () => {
      isMounted = false;
    };
  }, [orderId, token]);

  // Ensure socket is authenticated with admin token when available
  useEffect(() => {
    const storedAdmin = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
    const finalToken = token || storedAdmin;
    if (finalToken) {
      setActiveToken(finalToken);
      setSocketAuthToken(finalToken);
    }
  }, [token]);

  // Quick Admin Switch helper for development
  const handleQuickAdminLogin = async () => {
    setIsSwitchingAuth(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'Admin@123456' }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('admin_token', data.token);
        if (data.user) {
          localStorage.setItem('admin_user', JSON.stringify(data.user));
        }
        setActiveToken(data.token);
        setSocketAuthToken(data.token);
        setHasAuthError(false);
        addLog('Successfully switched to Administrator session (admin@example.com)!', 'success');
      } else {
        addLog(`Admin login failed: ${data.message || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      addLog(`Admin login network error: ${err.message}`, 'error');
    } finally {
      setIsSwitchingAuth(false);
    }
  };


  // Listen to Socket.IO acknowledgments and broadcasts
  useEffect(() => {
    if (!socket) return;

    const handleDeliveryLocationUpdated = (payload) => {
      addLog(
        `Received 'deliveryLocationUpdated' for order ${payload?.orderId}`,
        'success',
        payload
      );
    };

    const handleLocationError = (err) => {
      addLog(`Server rejected location update: ${err?.message}`, 'error', err);
    };

    socket.on('deliveryLocationUpdated', handleDeliveryLocationUpdated);
    socket.on('locationError', handleLocationError);

    return () => {
      socket.off('deliveryLocationUpdated', handleDeliveryLocationUpdated);
      socket.off('locationError', handleLocationError);
    };
  }, [socket]);

  // Clean up auto-play interval on unmount
  useEffect(() => {
    return () => {
      if (autoPlayTimerRef.current) {
        clearInterval(autoPlayTimerRef.current);
      }
    };
  }, []);

  /**
   * Primary Action: Send Location
   * Executes requirement:
   * socket.emit("updateDeliveryLocation", { orderId, latitude, longitude })
   */
  const handleSendLocation = (customLat = null, customLng = null, stepIndex = null) => {
    if (!socket) {
      addLog('Cannot send: Socket.IO client is not connected.', 'error');
      return;
    }

    const cleanOrderId = (orderId || '').trim();
    if (!cleanOrderId) {
      addLog('Please enter or select a valid Order ID.', 'warn');
      return;
    }

    const latVal = Number(customLat !== null ? customLat : latitude);
    const lngVal = Number(customLng !== null ? customLng : longitude);

    if (isNaN(latVal) || isNaN(lngVal) || latVal < -90 || latVal > 90 || lngVal < -180 || lngVal > 180) {
      addLog(`Invalid coordinates: Lat [${latVal}], Lng [${lngVal}]. Range is -90..90 and -180..180.`, 'error');
      return;
    }

    setIsSending(true);
    if (stepIndex !== null) {
      setActiveStep(stepIndex);
    }

    const effectiveAuthToken =
      activeToken ||
      (typeof window !== 'undefined'
        ? localStorage.getItem('admin_token') || localStorage.getItem('token')
        : null);

    const payload = {
      orderId: cleanOrderId,
      latitude: latVal,
      longitude: lngVal,
      token: effectiveAuthToken,
      isSimulator: true,
    };

    addLog(`Emitting 'updateDeliveryLocation' -> orderId: ${cleanOrderId}`, 'info', payload);

    // 5. socket.emit("updateDeliveryLocation", { orderId, latitude, longitude })
    socket.emit('updateDeliveryLocation', payload, (ack) => {
      setIsSending(false);
      if (ack?.success) {
        setHasAuthError(false);
        addLog(
          `Server Ack: GeoJSON Point [${ack.location?.coordinates?.[0]}, ${ack.location?.coordinates?.[1]}] saved in MongoDB!`,
          'success',
          ack
        );

        // If rider reached customer destination (Step 5), prompt admin immediately!
        if (
          stepIndex === 5 ||
          (Math.abs(latVal - destinationCoords.latitude) < 0.0015 &&
            Math.abs(lngVal - destinationCoords.longitude) < 0.0015)
        ) {
          addLog('📍 Delivery partner arrived at Customer Destination! Prompting for delivery confirmation...', 'info');
          setShowDeliveredPrompt(true);
        }
      } else {
        addLog(`Server Ack Error: ${ack?.message || 'Update failed'}`, 'error', ack);
        if (ack?.message?.includes('Forbidden')) {
          setHasAuthError(true);
        }
      }
    });
  };

  /**
   * Action: Mark Order as Delivered (Called from prompt modal when destination is reached)
   */
  const handleMarkAsDelivered = async () => {
    const cleanOrderId = (orderId || '').trim();
    if (!cleanOrderId) return;
    setIsMarkingDelivered(true);

    try {
      const effectiveAuthToken =
        activeToken ||
        (typeof window !== 'undefined'
          ? localStorage.getItem('admin_token') || localStorage.getItem('token')
          : null);

      // 1. Call REST API: PATCH /api/payments/orders/:id/status
      const res = await fetch(`/api/payments/orders/${cleanOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(effectiveAuthToken ? { Authorization: `Bearer ${effectiveAuthToken}` } : {}),
        },
        body: JSON.stringify({ status: 'DELIVERED' }),
      });

      const data = await res.json();

      // 2. Also emit Socket.IO update for instant broadcast
      if (socket) {
        socket.emit('updateOrderStatus', {
          orderId: cleanOrderId,
          orderStatus: 'DELIVERED',
          token: effectiveAuthToken,
          isSimulator: true,
        });
      }

      if (res.ok && data.success) {
        addLog(
          `🎉 Order #${cleanOrderId} successfully updated to DELIVERED in MongoDB! Live notification broadcast to customer tracking page.`,
          'success',
          data
        );
        setShowDeliveredPrompt(false);
      } else {
        addLog(`Error updating status: ${data.message || 'Server error'}`, 'error', data);
      }
    } catch (err) {
      addLog(`Failed to mark order as delivered: ${err.message}`, 'error');
    } finally {
      setIsMarkingDelivered(false);
    }
  };

  /**
   * Auto-Play the 5-step journey:
   * Start Location -> Location 1 -> Location 2 -> Location 3 -> Customer Location
   */
  const handleStartAutoPlay = () => {
    if (isAutoPlaying) {
      if (autoPlayTimerRef.current) {
        clearInterval(autoPlayTimerRef.current);
        autoPlayTimerRef.current = null;
      }
      setIsAutoPlaying(false);
      addLog('Auto-play simulation paused.', 'warn');
      return;
    }

    const cleanOrderId = (orderId || '').trim();
    if (!cleanOrderId) {
      addLog('Please select or enter an Order ID before starting simulation.', 'warn');
      return;
    }

    setIsAutoPlaying(true);
    let currentIdx = 0;

    // Send Step 1 immediately
    const step1 = routeSteps[0];
    setLatitude(String(step1.latitude));
    setLongitude(String(step1.longitude));
    handleSendLocation(step1.latitude, step1.longitude, 1);
    currentIdx = 1;

    // Advance through remaining steps every 2.5 seconds
    autoPlayTimerRef.current = setInterval(() => {
      if (currentIdx >= routeSteps.length) {
        clearInterval(autoPlayTimerRef.current);
        autoPlayTimerRef.current = null;
        setIsAutoPlaying(false);
        addLog('🎉 Route simulation complete! Rider reached Customer Location. Automatically marking order as DELIVERED in MongoDB...', 'success');
        setShowDeliveredPrompt(false);
        handleMarkAsDelivered();
        return;
      }

      const nextStep = routeSteps[currentIdx];
      setLatitude(String(nextStep.latitude));
      setLongitude(String(nextStep.longitude));
      handleSendLocation(nextStep.latitude, nextStep.longitude, nextStep.step);
      currentIdx++;
    }, 2500);
  };

  return (
    <div
      style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '24px 16px',
        fontFamily: 'inherit',
      }}
    >
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          borderRadius: '16px',
          padding: '24px 28px',
          color: '#ffffff',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '28px' }}>🛵</span>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Delivery Partner Location Simulator
            </h1>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                background: '#f59e0b',
                color: '#78350f',
                padding: '2px 8px',
                borderRadius: '6px',
                letterSpacing: '0.05em',
              }}
            >
              Dev Tool
            </span>
          </div>
          <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '13.5px' }}>
            Simulate live delivery-partner movement via Socket.IO without a physical mobile application.
          </p>
        </div>

        {/* Socket Status Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: isConnected ? '1px solid #10b981' : '1px solid #ef4444',
            padding: '6px 14px',
            borderRadius: '20px',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isConnected ? '#10b981' : '#ef4444',
              boxShadow: isConnected ? '0 0 8px #10b981' : 'none',
            }}
          />
          <span
            style={{
              fontSize: '12.5px',
              fontWeight: 700,
              color: isConnected ? '#34d399' : '#f87171',
            }}
          >
            {isConnected ? 'Socket.IO Online' : 'Socket Offline'}
          </span>
        </div>
      </div>

      {/* Admin Authorization Notice / Quick Login */}
      {hasAuthError && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            padding: '14px 18px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🛡️</span>
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#991b1b' }}>
                Administrator Authorization Required
              </div>
              <div style={{ fontSize: '12.5px', color: '#b91c1c' }}>
                The backend rejected coordinates because the socket is currently connected as a regular customer. Click below to instantly authorize the simulator with the development Admin account.
              </div>
            </div>
          </div>
          <button
            onClick={handleQuickAdminLogin}
            disabled={isSwitchingAuth}
            style={{
              background: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: isSwitchingAuth ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isSwitchingAuth ? 'Authorizing...' : '⚡ Quick Connect as Admin'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left Column: Direct Location Sender Form */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            padding: '22px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              📍 Manual GPS Coordinate Dispatch
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              Enter an order ID and coordinates to emit <code>updateDeliveryLocation</code>.
            </p>
          </div>

          {/* Order ID Input & Dropdown */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                Order ID <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Manual Input
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Enter or paste Order ID (e.g. 6abf8a...)"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value.trim())}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13.5px',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
              {orderId && (
                <button
                  type="button"
                  onClick={() => setOrderId('')}
                  style={{
                    padding: '0 12px',
                    fontSize: '12px',
                    color: '#64748b',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  title="Clear ID"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Latitude & Longitude Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Latitude
              </label>
              <input
                type="number"
                step="0.0001"
                placeholder="e.g. 30.7046"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13.5px',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Longitude
              </label>
              <input
                type="number"
                step="0.0001"
                placeholder="e.g. 76.7179"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13.5px',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Directional Nudge Buttons */}
          <div>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Micro-nudge GPS (±0.002):
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setLatitude((prev) => (Number(prev) + 0.002).toFixed(4))}
                style={{ padding: '6px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}
              >
                ↑ North
              </button>
              <button
                type="button"
                onClick={() => setLatitude((prev) => (Number(prev) - 0.002).toFixed(4))}
                style={{ padding: '6px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}
              >
                ↓ South
              </button>
              <button
                type="button"
                onClick={() => setLongitude((prev) => (Number(prev) + 0.002).toFixed(4))}
                style={{ padding: '6px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}
              >
                → East
              </button>
              <button
                type="button"
                onClick={() => setLongitude((prev) => (Number(prev) - 0.002).toFixed(4))}
                style={{ padding: '6px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}
              >
                ← West
              </button>
            </div>
          </div>

          {/* Primary Action Button */}
          <button
            type="button"
            onClick={() => handleSendLocation()}
            disabled={isSending || !orderId}
            style={{
              padding: '12px 18px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#ffffff',
              border: 'none',
              fontSize: '14px',
              fontWeight: 700,
              cursor: isSending || !orderId ? 'not-allowed' : 'pointer',
              opacity: isSending || !orderId ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
              transition: 'all 0.2s',
            }}
          >
            <span>📡</span>
            <span>{isSending ? 'Transmitting Location...' : 'Send Location'}</span>
          </button>

          {/* Direct Arrive at Destination Button */}
          <button
            type="button"
            onClick={() => {
              const destStep = routeSteps[routeSteps.length - 1];
              setLatitude(String(destStep.latitude));
              setLongitude(String(destStep.longitude));
              handleSendLocation(destStep.latitude, destStep.longitude, 5);
            }}
            disabled={isSending || !orderId}
            style={{
              padding: '12px 18px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              color: '#ffffff',
              border: 'none',
              fontSize: '14px',
              fontWeight: 800,
              cursor: isSending || !orderId ? 'not-allowed' : 'pointer',
              opacity: isSending || !orderId ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)',
              transition: 'all 0.2s',
            }}
          >
            <span>🏠</span>
            <span>Arrive at Destination Now (Step 5)</span>
          </button>

          {/* Side-by-side verification link */}
          {orderId && (
            <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px dashed #e2e8f0', textAlign: 'center' }}>
              <Link
                href={`/orders/${orderId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  color: '#2563eb',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <span>🔗 Open Customer Tracking Page in New Tab</span>
                <span style={{ fontSize: '14px' }}>↗</span>
              </Link>
            </div>
          )}
        </div>

        {/* Right Column: 5-Step Journey Route Simulation */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            padding: '22px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                🗺️ 5-Step Delivery Journey Simulation
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                Route aligned to Customer Destination ({destinationCoords.latitude.toFixed(4)}, {destinationCoords.longitude.toFixed(4)})
              </p>
            </div>

            {/* Auto Play Button */}
            <button
              type="button"
              onClick={handleStartAutoPlay}
              disabled={!orderId}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                background: isAutoPlaying ? '#dc2626' : '#059669',
                color: '#ffffff',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: !orderId ? 'not-allowed' : 'pointer',
                opacity: !orderId ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>{isAutoPlaying ? '⏸ Stop Journey' : '▶ Play Full Journey'}</span>
            </button>
          </div>

          {/* Vertical Stepper: Start Location -> Location 1 -> Location 2 -> Location 3 -> Customer Location */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {routeSteps.map((st, idx) => {
              const isSelected = activeStep === st.step;
              return (
                <React.Fragment key={st.step}>
                  <div
                    onClick={() => {
                      setLatitude(String(st.latitude));
                      setLongitude(String(st.longitude));
                      handleSendLocation(st.latitude, st.longitude, st.step);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                      background: isSelected ? '#eff6ff' : '#f8fafc',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: isSelected ? '#2563eb' : '#e2e8f0',
                          color: isSelected ? '#ffffff' : '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '16px',
                        }}
                      >
                        {st.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                          {st.name} <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 500 }}>({st.label})</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          Coords: {st.latitude.toFixed(4)}, {st.longitude.toFixed(4)}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      style={{
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #2563eb' : '1px solid #cbd5e1',
                        background: isSelected ? '#2563eb' : '#ffffff',
                        color: isSelected ? '#ffffff' : '#334155',
                        cursor: 'pointer',
                      }}
                    >
                      {isSelected ? '✓ Sent' : 'Emit Step'}
                    </button>
                  </div>

                  {idx < routeSteps.length - 1 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#94a3b8',
                        fontSize: '14px',
                        fontWeight: 800,
                        margin: '-4px 0',
                      }}
                    >
                      ↓
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Section: Real-Time Event & Telemetry Logs */}
      <div
        style={{
          marginTop: '24px',
          background: '#0f172a',
          color: '#e2e8f0',
          borderRadius: '14px',
          padding: '18px 22px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>📟</span>
            <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#f8fafc' }}>
              Socket.IO Live Telemetry & Event Console
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLogs([])}
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: '#334155',
              color: '#cbd5e1',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Clear Console
          </button>
        </div>

        <div
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            background: '#020617',
            padding: '12px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: '#64748b', fontStyle: 'italic', padding: '8px 0' }}>
              No socket events transmitted yet. Click &apos;Send Location&apos; or &apos;Play Full Journey&apos; to begin transmitting.
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                  color:
                    log.type === 'success'
                      ? '#4ade80'
                      : log.type === 'error'
                      ? '#f87171'
                      : log.type === 'warn'
                      ? '#fde047'
                      : '#93c5fd',
                }}
              >
                <span style={{ color: '#64748b' }}>[{log.timestamp}]</span>
                <span>{log.message}</span>
                {log.data && (
                  <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                    {JSON.stringify(log.data)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Destination Arrival Confirmation Prompt Modal */}
      {showDeliveredPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              maxWidth: '480px',
              width: '100%',
              padding: '32px 28px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0,0,0,0.05)',
              textAlign: 'center',
              position: 'relative',
            }}
          >
            {/* Top Close Button */}
            <button
              type="button"
              onClick={() => setShowDeliveredPrompt(false)}
              disabled={isMarkingDelivered}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: '#f1f5f9',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
                fontSize: '16px',
                fontWeight: 700,
                cursor: isMarkingDelivered ? 'not-allowed' : 'pointer',
              }}
            >
              ✕
            </button>

            {/* Destination Reached Badge & Icon */}
            <div
              style={{
                width: '72px',
                height: '72px',
                margin: '0 auto 16px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                border: '3px solid #10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
                boxShadow: '0 0 24px rgba(16, 185, 129, 0.3)',
              }}
            >
              🏠
            </div>

            <div
              style={{
                display: 'inline-block',
                background: '#ecfdf5',
                color: '#059669',
                fontSize: '11.5px',
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: '12px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: '10px',
              }}
            >
              Destination Reached
            </div>

            <h3
              style={{
                margin: '0 0 8px',
                fontSize: '21px',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              Order Arrived at Customer!
            </h3>

            <p
              style={{
                margin: '0 0 20px',
                fontSize: '14px',
                color: '#64748b',
                lineHeight: 1.5,
              }}
            >
              The delivery partner has reached the customer destination for{' '}
              <strong style={{ color: '#0f172a' }}>
                Order #{orderId ? orderId.substring(orderId.length - 6).toUpperCase() : 'N/A'}
              </strong>
              . Click below to confirm delivery. This will immediately update the order status to{' '}
              <strong style={{ color: '#059669' }}>DELIVERED</strong>, save it in MongoDB, and trigger the celebratory delivery toaster on the customer tracking page.
            </p>

            {/* Coordinates snapshot badge */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '10px 14px',
                marginBottom: '22px',
                fontSize: '12px',
                color: '#475569',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>📍 Drop-off Point: <strong>{destinationCoords.latitude.toFixed(4)}, {destinationCoords.longitude.toFixed(4)}</strong></span>
              <span style={{ color: '#059669', fontWeight: 700 }}>● At Doorstep</span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => handleMarkAsDelivered()}
                disabled={isMarkingDelivered}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '14px 20px',
                  fontSize: '14.5px',
                  fontWeight: 800,
                  cursor: isMarkingDelivered ? 'not-allowed' : 'pointer',
                  opacity: isMarkingDelivered ? 0.75 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 8px 20px -4px rgba(5, 150, 105, 0.4)',
                  transition: 'all 0.2s',
                }}
              >
                <span>🎉</span>
                <span>{isMarkingDelivered ? 'Updating & Notifying Customer...' : 'Mark Order as Delivered'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowDeliveredPrompt(false)}
                disabled={isMarkingDelivered}
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: '12px',
                  padding: '14px 18px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: isMarkingDelivered ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
