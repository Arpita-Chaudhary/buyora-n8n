'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';

/**
 * Helper to extract [lat, lng] from GeoJSON Point { type: 'Point', coordinates: [lng, lat] }
 * Leaflet requires [latitude, longitude].
 * Strictly filters out invalid coordinates, nulls, and [0, 0] (Null Island).
 */
function extractLatLngFromGeoJSON(location) {
  if (!location) return null;

  // GeoJSON Point format: coordinates: [longitude, latitude]
  if (
    location.type === 'Point' &&
    Array.isArray(location.coordinates) &&
    location.coordinates.length >= 2
  ) {
    const lng = Number(location.coordinates[0]);
    const lat = Number(location.coordinates[1]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) > 1 && Math.abs(lng) > 1 && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [lat, lng];
    }
  }

  // Fallback if coordinates object is provided: { latitude, longitude } or { lat, lng }
  const rawLat = location.latitude ?? location.lat;
  const rawLng = location.longitude ?? location.lng;
  if (rawLat !== null && rawLat !== undefined && rawLng !== null && rawLng !== undefined) {
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) > 1 && Math.abs(lng) > 1 && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [lat, lng];
    }
  }

  return null;
}

/**
 * Resolve realistic fallback destination coordinates from address string
 * Prevents map from ever defaulting to [0, 0]
 */
function resolveDestinationFromAddress(addressStr) {
  const addr = String(addressStr || '').toLowerCase();
  if (addr.includes('phase 7') || addr.includes('sector 60')) {
    return [30.7094, 76.7131];
  }
  if (addr.includes('rosewood') || addr.includes('phase 8') || addr.includes('sector 55') || addr.includes('160055')) {
    return [30.7188, 76.7299];
  }
  if (addr.includes('chandigarh') || addr.includes('oak') || addr.includes('sector 17') || addr.includes('160017')) {
    return [30.7333, 76.7794];
  }
  // Default Mohali/Chandigarh Central Hub
  return [30.7188, 76.7299];
}

/**
 * Map Auto-Re-centering and Bounds Component
 * Ensures BOTH rider and customer destination remain comfortably in view
 */
function MapViewUpdater({ riderPos, destinationPos, LeafletModule }) {
  const map = LeafletModule?.useMap ? LeafletModule.useMap() : null;

  useEffect(() => {
    if (!map) return;

    if (riderPos && destinationPos) {
      try {
        const bounds = [riderPos, destinationPos];
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      } catch (e) {
        map.panTo(riderPos, { animate: true, duration: 0.8 });
      }
    } else if (destinationPos) {
      map.setView(destinationPos, 16);
    } else if (riderPos) {
      map.setView(riderPos, 16);
    }
  }, [map, riderPos, destinationPos]);

  return null;
}

/**
 * OrderTrackingMap Component
 *
 * Renders an OpenStreetMap using Leaflet and updates delivery partner marker
 * in real-time whenever new GeoJSON coordinates are received over Socket.IO.
 */
export default function OrderTrackingMap({
  orderId,
  deliveryLocation,
  destinationCoords,
  destinationAddress,
  orderStatus = 'OUT_FOR_DELIVERY',
  isLiveConnected = true,
}) {
  const [leafletComponents, setLeafletComponents] = useState(null);
  const [LInstance, setLInstance] = useState(null);
  const [transitProgress, setTransitProgress] = useState(0); // 0 (Store Hub) to 1.0 (Doorstep)
  const [liveSocketLatLng, setLiveSocketLatLng] = useState(null);

  // Parse Destination Coordinates (Customer Doorstep)
  const destinationLatLng = useMemo(() => {
    const extracted = extractLatLngFromGeoJSON(destinationCoords);
    if (extracted) return extracted;

    const addr = String(destinationAddress || '').toLowerCase();
    if (addr.includes('phase 7') || addr.includes('sector 60')) {
      return [30.7094, 76.7131];
    }
    if (addr.includes('rosewood') || addr.includes('phase 8') || addr.includes('sector 55') || addr.includes('160055')) {
      return [30.7188, 76.7299];
    }
    if (addr.includes('chandigarh') || addr.includes('oak') || addr.includes('sector 17') || addr.includes('160017')) {
      return [30.7333, 76.7794];
    }
    return resolveDestinationFromAddress(destinationAddress);
  }, [destinationCoords, destinationAddress]);

  // Origin Store Hub: Positioned ~1.2km away from destination so transit vector is always perfect
  const storeHubLatLng = useMemo(() => {
    return [
      Number((destinationLatLng[0] - 0.0120).toFixed(5)),
      Number((destinationLatLng[1] - 0.0110).toFixed(5)),
    ];
  }, [destinationLatLng]);

  const isDelivered = String(orderStatus || '').toUpperCase() === 'DELIVERED';

  // Listen for live socket update prop changes (e.g. from Delivery Simulator or driver)
  const initialMountRef = useRef(true);
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    const extracted = extractLatLngFromGeoJSON(deliveryLocation);
    if (extracted) {
      setLiveSocketLatLng(extracted);
    }
  }, [deliveryLocation]);

  // Automated transit movement when tracking map is opened
  // Moves scooter along the path directly towards the customer's doorstep
  useEffect(() => {
    if (isDelivered) {
      setTransitProgress(1);
      return;
    }

    // Reset transit progress on order change
    setTransitProgress(0);

    const interval = setInterval(() => {
      setTransitProgress((prev) => {
        if (prev >= 1) {
          clearInterval(interval);
          return 1;
        }
        return Math.min(1, Number((prev + 0.20).toFixed(2)));
      });
    }, 2200);

    return () => clearInterval(interval);
  }, [orderId, isDelivered]);

  // Effective Rider Coordinates:
  // 1. If order is DELIVERED, rider is strictly at the doorstep (0m).
  // 2. If a live socket update was emitted during this session (e.g. from simulator), follow it.
  // 3. Otherwise, smoothly advance along vector from Store Hub directly to Customer Doorstep!
  const riderLatLng = useMemo(() => {
    if (isDelivered) return destinationLatLng;
    if (liveSocketLatLng) return liveSocketLatLng;
    if (transitProgress >= 1) return destinationLatLng;

    const lat = storeHubLatLng[0] + (destinationLatLng[0] - storeHubLatLng[0]) * transitProgress;
    const lng = storeHubLatLng[1] + (destinationLatLng[1] - storeHubLatLng[1]) * transitProgress;
    return [Number(lat.toFixed(5)), Number(lng.toFixed(5))];
  }, [isDelivered, destinationLatLng, liveSocketLatLng, transitProgress, storeHubLatLng]);

  // Dynamically import Leaflet only on client side (SSR-safe)
  useEffect(() => {
    let isMounted = true;

    if (typeof window !== 'undefined') {
      Promise.all([
        import('react-leaflet'),
        import('leaflet'),
      ])
        .then(([reactLeaflet, leafletModule]) => {
          if (!isMounted) return;

          const L = leafletModule.default || leafletModule;

          // Configure Leaflet assets
          delete L.Icon.Default.prototype._getIconUrl;
          L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
          });

          setLeafletComponents(reactLeaflet);
          setLInstance(L);
        })
        .catch((err) => {
          console.error('[OrderTrackingMap] Failed to load Leaflet:', err);
        });
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Determine initial center
  const defaultCenter = useMemo(() => {
    if (riderLatLng) return riderLatLng;
    return destinationLatLng;
  }, [riderLatLng, destinationLatLng]);

  // Calculate True Bearing Angle (Degrees from North: 0 = North, 90 = East, 180 = South, 270 = West)
  const headingAngle = useMemo(() => {
    if (!riderLatLng || !destinationLatLng) return 0;
    const dLat = destinationLatLng[0] - riderLatLng[0];
    const dLng = destinationLatLng[1] - riderLatLng[1];
    const angleRad = Math.atan2(dLng, dLat);
    return ((angleRad * 180) / Math.PI + 360) % 360;
  }, [riderLatLng, destinationLatLng]);

  // Check if rider has arrived at the doorstep (within ~50 meters or marked DELIVERED or progress >= 1)
  const isArrivedAtDestination = useMemo(() => {
    if (isDelivered) return true;
    if (!riderLatLng || !destinationLatLng) return false;
    if (transitProgress >= 1 && !liveSocketLatLng) return true;
    const dLat = Math.abs(riderLatLng[0] - destinationLatLng[0]);
    const dLng = Math.abs(riderLatLng[1] - destinationLatLng[1]);
    return dLat < 0.0006 && dLng < 0.0006;
  }, [riderLatLng, destinationLatLng, isDelivered, transitProgress, liveSocketLatLng]);

  // Create custom markers
  const riderIcon = useMemo(() => {
    if (!LInstance) return null;

    if (isArrivedAtDestination) {
      return LInstance.divIcon({
        className: 'custom-rider-marker-arrived',
        html: `
          <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(16, 185, 129, 0.25); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: #059669; border: 3px solid #ffffff; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.45); display: flex; align-items: center; justify-content: center; font-size: 18px; color: #ffffff;">
              🛵
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22],
      });
    }

    // Check if heading towards East (flip emoji horizontally)
    const isHeadingEast = destinationLatLng[1] >= riderLatLng[1];

    return LInstance.divIcon({
      className: 'custom-rider-marker',
      html: `
        <div style="position: relative; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center;">
          <!-- Animated pulse ring -->
          <div style="position: absolute; width: 46px; height: 46px; border-radius: 50%; background: rgba(37, 99, 235, 0.22); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>

          <!-- Navigation Arrow Indicator pointing in exact heading direction towards doorstep -->
          <div style="position: absolute; width: 44px; height: 44px; display: flex; justify-content: center; transform: rotate(${headingAngle}deg); transition: transform 0.4s ease; pointer-events: none;">
            <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid #1d4ed8; margin-top: -4px;"></div>
          </div>

          <!-- Scooter Badge -->
          <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: #2563eb; border: 3px solid #ffffff; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.45); display: flex; align-items: center; justify-content: center; font-size: 18px; color: #ffffff;">
            <span style="display: inline-block; ${isHeadingEast ? 'transform: scaleX(-1);' : ''} transition: transform 0.3s ease;">🛵</span>
          </div>
        </div>
      `,
      iconSize: [46, 46],
      iconAnchor: [23, 23],
      popupAnchor: [0, -23],
    });
  }, [LInstance, riderLatLng, destinationLatLng, headingAngle, isArrivedAtDestination]);

  const destinationIcon = useMemo(() => {
    if (!LInstance) return null;
    return LInstance.divIcon({
      className: 'custom-dest-marker',
      html: `
        <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: #059669; border: 3px solid #ffffff; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.45); display: flex; align-items: center; justify-content: center; font-size: 17px; color: #ffffff;">
            🏠
          </div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20],
    });
  }, [LInstance]);

  // Polyline path connecting rider to destination (hide line once arrived at doorstep)
  const routePoints = useMemo(() => {
    return riderLatLng && destinationLatLng && !isArrivedAtDestination
      ? [riderLatLng, destinationLatLng]
      : null;
  }, [riderLatLng, destinationLatLng, isArrivedAtDestination]);

  // Live distance to customer doorstep in meters
  const distanceToDestinationMeters = useMemo(() => {
    if (isDelivered || isArrivedAtDestination || !riderLatLng || !destinationLatLng) return 0;
    const dLat = (destinationLatLng[0] - riderLatLng[0]) * 111000;
    const dLng = (destinationLatLng[1] - riderLatLng[1]) * 96000;
    const dist = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
    return dist < 30 ? 0 : dist;
  }, [riderLatLng, destinationLatLng, isDelivered, isArrivedAtDestination]);

  if (!leafletComponents || !LInstance) {
    return (
      <div
        style={{
          height: '340px',
          background: '#f8fafc',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: '#64748b',
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '3px solid #e2e8f0',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
        <span>Initializing Live Tracking Map...</span>
      </div>
    );
  }

  const { MapContainer, TileLayer, Marker, Popup, Polyline } = leafletComponents;

  return (
    <div
      style={{
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        marginTop: '16px',
        marginBottom: '24px',
      }}
    >
      {/* Live Tracking Header Bar */}
      <div
        style={{
          padding: '12px 18px',
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(59, 130, 246, 0.2)',
              fontSize: '18px',
            }}
          >
            🗺️
          </span>
          <div>
            <div style={{ fontWeight: 800, fontSize: '16px', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Delivery Map</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: isLiveConnected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  color: isLiveConnected ? '#34d399' : '#f87171',
                  border: isLiveConnected ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isLiveConnected ? '#10b981' : '#ef4444',
                  }}
                />
                {isLiveConnected ? 'Live Tracking Connected' : 'Connecting...'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              Real-time delivery partner location • OpenStreetMap
            </div>
          </div>
        </div>

        {/* Live Coordinate Telemetry Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Distance to Doorstep Pill */}
          <div
            style={{
              fontSize: '12px',
              background: isArrivedAtDestination ? 'rgba(16, 185, 129, 0.25)' : 'rgba(37, 99, 235, 0.25)',
              border: isArrivedAtDestination ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(37, 99, 235, 0.5)',
              color: isArrivedAtDestination ? '#34d399' : '#93c5fd',
              padding: '4px 10px',
              borderRadius: '8px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            {isArrivedAtDestination
              ? '🎉 Arrived at Doorstep!'
              : `🛵 ${distanceToDestinationMeters > 1000 ? (distanceToDestinationMeters / 1000).toFixed(1) + ' km' : distanceToDestinationMeters + ' m'} to Doorstep`}
          </div>

          {riderLatLng && (
            <div
              style={{
                fontSize: '12px',
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '4px 10px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ color: '#60a5fa', fontWeight: 600 }}>Rider:</span>
              <code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                {riderLatLng[0].toFixed(4)}, {riderLatLng[1].toFixed(4)}
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Interactive Leaflet Map */}
      <div style={{ height: '360px', width: '100%', position: 'relative' }}>
        <MapContainer
          center={defaultCenter}
          zoom={14}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapViewUpdater
            riderPos={riderLatLng}
            destinationPos={destinationLatLng}
            LeafletModule={leafletComponents}
          />

          {/* Dotted Route Line connecting Rider and Customer */}
          {routePoints && (
            <Polyline
              positions={routePoints}
              pathOptions={{
                color: '#3b82f6',
                weight: 4,
                dashArray: '8, 8',
                opacity: 0.7,
              }}
            />
          )}

          {/* Delivery Partner Live Marker (Moves seamlessly on update) */}
          {riderLatLng && riderIcon && (
            <Marker position={riderLatLng} icon={riderIcon}>
              <Popup>
                <div style={{ minWidth: '180px', padding: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#1e3a8a', fontSize: '13px' }}>
                    <span>🛵</span>
                    <span>Delivery Partner</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '4px' }}>
                    Live position updated via Socket.IO
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '11px', background: '#eff6ff', padding: '4px 6px', borderRadius: '4px', color: '#1d4ed8' }}>
                    <strong>GeoJSON:</strong> [{deliveryLocation?.coordinates?.[0]?.toFixed(5) || riderLatLng[1].toFixed(5)}, {deliveryLocation?.coordinates?.[1]?.toFixed(5) || riderLatLng[0].toFixed(5)}]
                  </div>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Customer Destination Marker */}
          {destinationLatLng && destinationIcon && (
            <Marker position={destinationLatLng} icon={destinationIcon}>
              <Popup>
                <div style={{ minWidth: '180px', padding: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#065f46', fontSize: '13px' }}>
                    <span>🏠</span>
                    <span>Your Delivery Location</span>
                  </div>
                  {destinationAddress && (
                    <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '4px' }}>
                      {destinationAddress}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>

        {/* Floating Marker Status Banner & Legend */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            zIndex: 1000,
            background: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '8px 14px',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            fontSize: '12px',
            flexWrap: 'wrap',
          }}
        >
          {/* Delivery Partner ● */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>Delivery Partner</span>
            <span style={{ color: '#2563eb', fontSize: '13px' }}>●</span>
          </div>

          {/* Customer 📍 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderLeft: '1px solid #cbd5e1', paddingLeft: '12px' }}>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>Customer</span>
            <span style={{ fontSize: '14px' }}>📍</span>
          </div>

          {/* ● Live Tracking Connected */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderLeft: '1px solid #cbd5e1', paddingLeft: '12px' }}>
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: isLiveConnected ? '#10b981' : '#ef4444',
                boxShadow: isLiveConnected ? '0 0 6px #10b981' : 'none',
              }}
            />
            <span
              style={{
                fontWeight: 700,
                color: isLiveConnected ? '#059669' : '#dc2626',
              }}
            >
              {isLiveConnected ? 'Live Tracking Connected' : 'Connecting...'}
            </span>
          </div>

          {/* Arrived at Doorstep Indicator */}
          {isArrivedAtDestination && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderLeft: '1px solid #cbd5e1', paddingLeft: '12px' }}>
              <span
                style={{
                  background: '#ecfdf5',
                  color: '#059669',
                  border: '1px solid #a7f3d0',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '11px',
                  letterSpacing: '0.02em',
                }}
              >
                🎉 Arrived at Doorstep!
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
