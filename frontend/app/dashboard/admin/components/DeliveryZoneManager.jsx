'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import styles from './DeliveryZoneManager.module.css';

// Curated modern color palette for delivery zones
const ZONE_COLORS = [
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Indigo', hex: '#6366f1' },
];

// Bounding box for India [South-West, North-East]
const INDIA_BOUNDS = [
  [6.5546, 68.1113],
  [35.6745, 97.3956],
];

// Helper to convert GeoJSON [lng, lat] ring to Leaflet [lat, lng] array
function geoJsonToLeafletCoords(geoJsonPolygon) {
  if (
    !geoJsonPolygon ||
    !Array.isArray(geoJsonPolygon.coordinates) ||
    geoJsonPolygon.coordinates.length === 0
  ) {
    return [];
  }
  const ring = geoJsonPolygon.coordinates[0];
  // Filter out the closing point duplicate for clean vertex editing
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i];
    if (i === ring.length - 1 && ring.length > 3 && ring[0][0] === lng && ring[0][1] === lat) {
      continue;
    }
    pts.push([lat, lng]);
  }
  return pts;
}

// Helper to convert Leaflet [lat, lng] vertices to GeoJSON [lng, lat] closed ring
function leafletToGeoJsonCoords(leafletVertices) {
  if (!leafletVertices || leafletVertices.length < 3) return [];
  const ring = leafletVertices.map(([lat, lng]) => [
    Number(lng.toFixed(6)),
    Number(lat.toFixed(6)),
  ]);
  // Close the linear ring
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

export default function DeliveryZoneManager({ token, triggerToast }) {
  // Data States
  const [zones, setZones] = useState([]);
  const [metrics, setMetrics] = useState({
    totalZones: 0,
    activeZones: 0,
    inactiveZones: 0,
    averageFee: 0,
  });
  const [allProducts, setAllProducts] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteModalZone, setDeleteModalZone] = useState(null);

  // Search & Filter in Table
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Leaflet Module dynamic state
  const [MapModule, setMapModule] = useState(null);

  // Map Drawing / Editing States
  const [isDrawing, setIsDrawing] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState(null); // null = new zone or idle
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [activeVertices, setActiveVertices] = useState([]); // array of [lat, lng]
  const [mapCenter, setMapCenter] = useState([30.7046, 76.7179]); // Mohali center
  const [mapZoom, setMapZoom] = useState(12);

  // Geocoding Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchTimeoutRef = useRef(null);
  const searchContainerRef = useRef(null);

  // Zone Form State
  const initialFormState = {
    name: '',
    description: '',
    status: 'active',
    color: '#3b82f6',
    deliveryCharge: '49',
    minOrderAmount: '199',
    estimatedDeliveryTime: '30-45 mins',
    assignmentType: 'all', // 'all' | 'categories' | 'products'
    assignedCategories: [],
    assignedProducts: [],
  };
  const [zoneForm, setZoneForm] = useState(initialFormState);
  const [productSearch, setProductSearch] = useState('');

  // Target map element ref for fitting bounds
  const mapInstanceRef = useRef(null);

  // 1. Fetch Zones & Metrics
  const fetchZones = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/delivery-zones', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Server returned unexpected response (${res.status}). Verify the backend server is running.`);
      }
      const data = await res.json();
      if (data.success) {
        setZones(data.data || []);
        if (data.metrics) {
          setMetrics(data.metrics);
        }
      } else {
        triggerToast(data.message || 'Failed to load delivery zones', 'error');
      }
    } catch (err) {
      triggerToast(err.message || 'Error fetching delivery zones', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, triggerToast]);

  // 2. Fetch Products & Extract Categories
  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/products?limit=100');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setAllProducts(data.data);
        const cats = Array.from(
          new Set(data.data.map((p) => p.category).filter(Boolean))
        );
        setAllCategories(cats.length > 0 ? cats : ['General', 'Electronics', 'Wearables', 'Groceries']);
      }
    } catch (e) {
      console.warn('Could not load products for zone assignment:', e);
    }
  }, []);

  // 2b. Manual Refresh handler — wraps fetchZones with user feedback
  const handleRefresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/delivery-zones', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Server returned unexpected response (${res.status}). Verify the backend server is running.`);
      }
      const data = await res.json();
      if (data.success) {
        setZones(data.data || []);
        if (data.metrics) {
          setMetrics(data.metrics);
        }
        triggerToast(`Refreshed! ${(data.data || []).length} delivery zone(s) loaded.`, 'success');
      } else {
        triggerToast(data.message || 'Failed to load delivery zones', 'error');
      }
    } catch (err) {
      triggerToast(err.message || 'Error fetching delivery zones', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, triggerToast]);

  useEffect(() => {
    fetchZones();
    fetchProducts();
  }, [fetchZones, fetchProducts]);

  // 3. Dynamically Load Leaflet & React-Leaflet
  useEffect(() => {
    let isMounted = true;
    if (typeof window !== 'undefined') {
      Promise.all([
        import('react-leaflet'),
        import('leaflet'),
      ])
        .then(([{ MapContainer, TileLayer, Polygon, Polyline, Marker, Popup, Tooltip, useMapEvents, useMap }, LModule]) => {
          if (!isMounted) return;
          const L = LModule.default || LModule;

          // Fix Leaflet icons
          delete L.Icon.Default.prototype._getIconUrl;
          L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
          });

          // Custom Vertex Marker Icon Generator
          const createVertexIcon = (index, isStart = false) => {
            return L.divIcon({
              className: 'vertex-marker',
              html: `<div style="
                background-color: ${isStart ? '#10b981' : '#2563eb'};
                color: #ffffff;
                width: 26px;
                height: 26px;
                border-radius: 50%;
                border: 2px solid #ffffff;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 800;
                cursor: grab;
                transition: transform 0.15s;
              ">${isStart ? '★' : index + 1}</div>`,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            });
          };

          // Custom Map Click Handler for Drawing Mode
          function DrawClickHandler({ isDrawing, onAddPoint }) {
            useMapEvents({
              click(e) {
                if (isDrawing) {
                  onAddPoint([Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))]);
                }
              },
            });
            return null;
          }

          // Component to expose map instance
          function MapRefSetter({ onReady }) {
            const map = useMap();
            useEffect(() => {
              onReady(map);
            }, [map, onReady]);
            return null;
          }

          setMapModule({
            MapContainer,
            TileLayer,
            Polygon,
            Polyline,
            Marker,
            Popup,
            Tooltip,
            DrawClickHandler,
            MapRefSetter,
            createVertexIcon,
            L,
          });
        })
        .catch((err) => {
          console.error('Error importing Leaflet in DeliveryZoneManager:', err);
        });
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Area Geocoding Search
  const handleSearchInput = (e) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&bbox=68.1113,6.5546,97.3956,35.6745&limit=5`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data && data.features) {
            const formatted = data.features.map((f) => {
              const p = f.properties || {};
              const label = [
                p.name,
                p.street,
                p.district,
                p.city || p.town || p.village,
                p.state,
                p.country,
              ]
                .filter(Boolean)
                .join(', ');
              return {
                label: label || p.name || 'Unknown Location',
                lat: f.geometry.coordinates[1],
                lng: f.geometry.coordinates[0],
              };
            });
            setSearchResults(formatted);
            setShowSearchDropdown(formatted.length > 0);
          }
        }
      } catch (err) {
        console.warn('Geocoding error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  const handleSelectSearchResult = (result) => {
    setSearchQuery(result.label);
    setShowSearchDropdown(false);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([result.lat, result.lng], 14, { duration: 1.2 });
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      triggerToast('Geolocation is not supported by your browser', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([latitude, longitude], 14, { duration: 1.2 });
        }
        triggerToast('Map centered to your current location', 'success');
      },
      (err) => {
        triggerToast('Could not access your location: ' + err.message, 'error');
      }
    );
  };

  // 4. Drawing & Vertex Manipulations
  const handleStartDrawNewZone = () => {
    setEditingZoneId(null);
    setZoneForm({
      ...initialFormState,
      name: `Delivery Zone #${zones.length + 1}`,
    });
    setActiveVertices([]);
    setIsDrawing(true);
    setIsEditorOpen(true);
    triggerToast('Drawing Mode active: Click anywhere on the map to define the boundary vertices.', 'info');
  };

  const handleAddVertex = (point) => {
    setActiveVertices((prev) => [...prev, point]);
  };

  const handleUndoVertex = () => {
    setActiveVertices((prev) => prev.slice(0, -1));
  };

  const handleClearBoundary = () => {
    setActiveVertices([]);
  };

  const handleCompleteBoundary = () => {
    if (activeVertices.length < 3) {
      triggerToast('At least 3 boundary vertices are required to form a delivery zone.', 'error');
      return;
    }
    setIsDrawing(false);
    triggerToast(`Boundary completed with ${activeVertices.length} vertices! Fill in the zone details and save.`, 'success');
  };

  // Draggable vertex update
  const handleVertexDrag = (index, newLatLng) => {
    setActiveVertices((prev) => {
      const updated = [...prev];
      updated[index] = [Number(newLatLng.lat.toFixed(6)), Number(newLatLng.lng.toFixed(6))];
      return updated;
    });
  };

  // 5. Zone Editing & Focusing
  const handleEditZone = (zone) => {
    setEditingZoneId(zone._id);
    const vertices = geoJsonToLeafletCoords(zone.boundary);
    setActiveVertices(vertices);
    setIsDrawing(false);
    setIsEditorOpen(true);

    setZoneForm({
      name: zone.name || '',
      description: zone.description || '',
      status: zone.status || 'active',
      color: zone.color || '#3b82f6',
      deliveryCharge: String(zone.deliveryCharge ?? '2.99'),
      minOrderAmount: String(zone.minOrderAmount ?? '0'),
      estimatedDeliveryTime: zone.estimatedDeliveryTime || '30-45 mins',
      assignmentType: zone.assignmentType || 'all',
      assignedCategories: zone.assignedCategories || [],
      assignedProducts: Array.isArray(zone.assignedProducts)
        ? zone.assignedProducts.map((p) => (typeof p === 'object' ? p._id : p))
        : [],
    });

    // Fly to zone bounds
    if (mapInstanceRef.current && vertices.length > 0) {
      if (MapModule && MapModule.L) {
        const bounds = MapModule.L.latLngBounds(vertices);
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    }
  };

  const handleFocusZone = (zone) => {
    const vertices = geoJsonToLeafletCoords(zone.boundary);
    if (mapInstanceRef.current && vertices.length > 0 && MapModule && MapModule.L) {
      const bounds = MapModule.L.latLngBounds(vertices);
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  };

  const handleFitAllZones = () => {
    if (!mapInstanceRef.current || !MapModule || !MapModule.L || zones.length === 0) return;
    const allCoords = [];
    zones.forEach((z) => {
      const pts = geoJsonToLeafletCoords(z.boundary);
      pts.forEach((pt) => allCoords.push(pt));
    });
    if (allCoords.length > 0) {
      const bounds = MapModule.L.latLngBounds(allCoords);
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  };

  // 6. Save Zone (Create or Update)
  const handleSaveZone = async (e) => {
    e.preventDefault();

    if (!zoneForm.name.trim()) {
      triggerToast('Zone name is required', 'error');
      return;
    }

    if (activeVertices.length < 3) {
      triggerToast('Please draw at least 3 points on the map to define the zone boundary.', 'error');
      return;
    }

    const closedRing = leafletToGeoJsonCoords(activeVertices);
    if (closedRing.length < 4) {
      triggerToast('Invalid boundary polygon. Please add more points.', 'error');
      return;
    }

    const payload = {
      name: zoneForm.name.trim(),
      description: zoneForm.description.trim(),
      status: zoneForm.status,
      color: zoneForm.color,
      deliveryCharge: Number(zoneForm.deliveryCharge) || 0,
      minOrderAmount: Number(zoneForm.minOrderAmount) || 0,
      estimatedDeliveryTime: zoneForm.estimatedDeliveryTime.trim() || '30-45 mins',
      assignmentType: zoneForm.assignmentType,
      assignedCategories: zoneForm.assignedCategories,
      assignedProducts: zoneForm.assignedProducts,
      coordinates: closedRing,
    };

    try {
      setSaving(true);
      let res;
      if (editingZoneId) {
        res = await fetch(`/api/admin/delivery-zones/${editingZoneId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/admin/delivery-zones', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      }

      const contentType = res.headers.get('content-type') || '';
      let data = {};
      if (contentType.includes('application/json')) {
        data = await res.json();
      }

      if (!res.ok || !data.success) {
        throw new Error(data.message || `Failed to save delivery zone (${res.status})`);
      }

      triggerToast(
        editingZoneId
          ? `Delivery zone '${zoneForm.name}' updated successfully!`
          : `Delivery zone '${zoneForm.name}' created successfully!`,
        'success'
      );

      setIsEditorOpen(false);
      setIsDrawing(false);
      setEditingZoneId(null);
      setActiveVertices([]);
      fetchZones();
    } catch (err) {
      triggerToast(err.message || 'Error saving delivery zone', 'error');
    } finally {
      setSaving(false);
    }
  };

  // 7. Delete Zone
  const handleDeleteZone = async () => {
    if (!deleteModalZone) return;
    try {
      const res = await fetch(`/api/admin/delivery-zones/${deleteModalZone._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const contentType = res.headers.get('content-type') || '';
      let data = {};
      if (contentType.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to delete delivery zone');
      }
      triggerToast(`Delivery zone '${deleteModalZone.name}' deleted`, 'success');
      setDeleteModalZone(null);
      if (editingZoneId === deleteModalZone._id) {
        setIsEditorOpen(false);
        setEditingZoneId(null);
        setActiveVertices([]);
      }
      fetchZones();
    } catch (err) {
      triggerToast(err.message || 'Error deleting delivery zone', 'error');
    }
  };

  // Filtered zones for Table
  const filteredZones = useMemo(() => {
    return zones.filter((z) => {
      const matchesSearch =
        !tableSearch.trim() ||
        z.name.toLowerCase().includes(tableSearch.toLowerCase()) ||
        (z.description && z.description.toLowerCase().includes(tableSearch.toLowerCase()));
      const matchesStatus =
        statusFilter === 'all' || z.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [zones, tableSearch, statusFilter]);

  // Filtered products for assignment picker
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return allProducts;
    return allProducts.filter(
      (p) =>
        p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.category.toLowerCase().includes(productSearch.toLowerCase())
    );
  }, [allProducts, productSearch]);

  const toggleCategory = (cat) => {
    setZoneForm((prev) => {
      const exists = prev.assignedCategories.includes(cat);
      return {
        ...prev,
        assignedCategories: exists
          ? prev.assignedCategories.filter((c) => c !== cat)
          : [...prev.assignedCategories, cat],
      };
    });
  };

  const toggleProduct = (productId) => {
    setZoneForm((prev) => {
      const exists = prev.assignedProducts.includes(productId);
      return {
        ...prev,
        assignedProducts: exists
          ? prev.assignedProducts.filter((id) => id !== productId)
          : [...prev.assignedProducts, productId],
      };
    });
  };

  return (
    <div className={styles.container}>
      {/* 1. Header Bar */}
      <div className={styles.headerBar}>
        <div className={titleAreaClass(styles)}>
          <div className={styles.headingWrapper}>
            <h1 className={styles.pageTitle}>
              <span>🗺️</span> Delivery Zones Management
            </h1>
            <span className={styles.countBadge}>{zones.length} Zones</span>
          </div>
          <p className={styles.subHeading}>
            Draw geographic boundaries on the map to define delivery coverage, fees, minimum orders, and assigned products.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className={styles.secondaryBtn}
            title="Refresh zones"
          >
            <span className={loading ? styles.spinIcon : ''}>↻</span> {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={handleStartDrawNewZone}
            className={styles.primaryBtn}
          >
            <span>✏️</span> + Draw New Delivery Zone
          </button>
        </div>
      </div>

      {/* 2. Key Metrics Cards */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={`${styles.statIconWrapper} ${styles.iconBlue}`}>🗺️</div>
          <div className={styles.statDetails}>
            <div className={styles.statValue}>{metrics.totalZones}</div>
            <div className={styles.statLabel}>Total Delivery Zones</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIconWrapper} ${styles.iconGreen}`}>✓</div>
          <div className={styles.statDetails}>
            <div className={styles.statValue}>{metrics.activeZones}</div>
            <div className={styles.statLabel}>Active Serviceable Areas</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIconWrapper} ${styles.iconAmber}`}>💵</div>
          <div className={styles.statDetails}>
            <div className={styles.statValue}>₹{Number(metrics.averageFee || 0).toFixed(2)}</div>
            <div className={styles.statLabel}>Avg Delivery Fee</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIconWrapper} ${styles.iconPurple}`}>⚡</div>
          <div className={styles.statDetails}>
            <div className={styles.statValue}>
              {zones.length > 0 ? zones[0].estimatedDeliveryTime || '30 mins' : 'N/A'}
            </div>
            <div className={styles.statLabel}>Express Delivery Standard</div>
          </div>
        </div>
      </div>

      {/* 3. Main Split View: Interactive Map & Zone Editor */}
      <div className={styles.splitLayout}>
        {/* LEFT COLUMN: Map Card */}
        <div className={styles.mapCard}>
          {/* Map Toolbar */}
          <div className={styles.mapToolbar}>
            <div className={styles.searchRow}>
              <div className={styles.searchBoxWrapper} ref={searchContainerRef}>
                <span className={styles.searchIcon}>🔍</span>
                <input
                  type="text"
                  placeholder="Search city, town or address to center map..."
                  value={searchQuery}
                  onChange={handleSearchInput}
                  onFocus={() => {
                    if (searchResults.length > 0) setShowSearchDropdown(true);
                  }}
                  className={styles.searchInput}
                />
                {isSearching && (
                  <span
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '12px',
                      color: '#94a3b8',
                    }}
                  >
                    Searching...
                  </span>
                )}

                {showSearchDropdown && searchResults.length > 0 && (
                  <div className={styles.searchResultsDropdown}>
                    {searchResults.map((item, idx) => (
                      <div
                        key={idx}
                        className={styles.searchResultItem}
                        onClick={() => handleSelectSearchResult(item)}
                      >
                        <span>📍</span>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleUseMyLocation}
                className={styles.toolBtn}
                title="Center on my location"
              >
                🎯 Locate Me
              </button>
            </div>

            {/* Map Action Controls */}
            <div className={styles.mapActionRow}>
              <div className={styles.mapControlGroup}>
                <button
                  type="button"
                  onClick={() => {
                    if (isDrawing) {
                      setIsDrawing(false);
                    } else {
                      handleStartDrawNewZone();
                    }
                  }}
                  className={`${styles.toolBtn} ${isDrawing ? styles.toolBtnActive : ''}`}
                >
                  <span>✏️</span>
                  <span>{isDrawing ? 'Drawing Mode Active' : 'Start Drawing'}</span>
                </button>

                {isDrawing && (
                  <>
                    <button
                      type="button"
                      onClick={handleUndoVertex}
                      disabled={activeVertices.length === 0}
                      className={styles.toolBtn}
                    >
                      ↶ Undo Point
                    </button>
                    <button
                      type="button"
                      onClick={handleClearBoundary}
                      disabled={activeVertices.length === 0}
                      className={styles.toolBtn}
                    >
                      ✕ Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleCompleteBoundary}
                      disabled={activeVertices.length < 3}
                      className={`${styles.toolBtn} ${styles.toolBtnSuccess}`}
                    >
                      ✓ Complete ({activeVertices.length} pts)
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={handleFitAllZones}
                  disabled={zones.length === 0}
                  className={styles.toolBtn}
                >
                  🔍 Fit All Zones
                </button>
              </div>

              <div style={{ fontSize: '12px', color: '#64748b' }}>
                {isDrawing
                  ? `Click map to place points (${activeVertices.length} placed)`
                  : editingZoneId
                  ? 'Drag circle vertices to reshape boundary'
                  : 'Click any zone on map to inspect'}
              </div>
            </div>
          </div>

          {/* Active Drawing Banner */}
          {isDrawing && (
            <div className={styles.drawingBanner}>
              <div className={styles.drawingBannerText}>
                <span>ℹ️</span>
                <span>
                  <strong>Polygon Drawing Mode:</strong> Click on the map to add boundary points (minimum 3 required). Click "Complete" when done.
                </span>
              </div>
              <div className={styles.drawingBannerActions}>
                <button
                  type="button"
                  onClick={() => setIsDrawing(false)}
                  className={styles.toolBtn}
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                >
                  Exit Drawing
                </button>
              </div>
            </div>
          )}

          {/* Map Viewport */}
          <div className={styles.mapViewport}>
            {MapModule ? (
              <MapModule.MapContainer
                center={mapCenter}
                zoom={mapZoom}
                minZoom={4}
                maxZoom={18}
                maxBounds={INDIA_BOUNDS}
                maxBoundsViscosity={1.0}
                attributionControl={false}
                style={{ width: '100%', height: '100%' }}
                scrollWheelZoom={true}
              >
                <MapModule.MapRefSetter
                  onReady={(map) => {
                    mapInstanceRef.current = map;
                  }}
                />

                <MapModule.TileLayer
                  attribution=""
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Drawing Click Listener */}
                <MapModule.DrawClickHandler
                  isDrawing={isDrawing}
                  onAddPoint={handleAddVertex}
                />

                {/* Render Existing Saved Zones */}
                {zones.map((zone) => {
                  const pts = geoJsonToLeafletCoords(zone.boundary);
                  if (pts.length < 3) return null;
                  const isBeingEdited = editingZoneId === zone._id;
                  const zoneColor = isBeingEdited ? zoneForm.color : zone.color || '#3b82f6';

                  return (
                    <MapModule.Polygon
                      key={zone._id}
                      positions={isBeingEdited ? activeVertices : pts}
                      pathOptions={{
                        color: zoneColor,
                        fillColor: zoneColor,
                        fillOpacity: isBeingEdited ? 0.45 : 0.28,
                        weight: isBeingEdited ? 3.5 : 2,
                        dashArray: isBeingEdited ? '6, 6' : null,
                      }}
                    >
                      <MapModule.Popup>
                        <div style={{ padding: '4px', minWidth: '180px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                            <span
                              style={{
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                backgroundColor: zone.color || '#3b82f6',
                              }}
                            />
                            <strong style={{ fontSize: '14px', color: '#0f172a' }}>{zone.name}</strong>
                          </div>
                          {zone.description && (
                            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 8px 0' }}>
                              {zone.description}
                            </p>
                          )}
                          <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '3px', color: '#334155' }}>
                            <div>💵 Delivery Charge: <strong>₹{Number(zone.deliveryCharge).toFixed(2)}</strong></div>
                            <div>🛒 Min Order: <strong>₹{Number(zone.minOrderAmount).toFixed(2)}</strong></div>
                            <div>⏱️ Est. Time: <strong>{zone.estimatedDeliveryTime}</strong></div>
                            <div>
                              📦 Serviceability: <strong>
                                {zone.assignmentType === 'all'
                                  ? 'All Products'
                                  : zone.assignmentType === 'categories'
                                  ? `${zone.assignedCategories?.length || 0} Categories`
                                  : `${zone.assignedProducts?.length || 0} Products`}
                              </strong>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                            <button
                              type="button"
                              onClick={() => handleEditZone(zone)}
                              style={{
                                flex: 1,
                                background: '#2563eb',
                                color: '#ffffff',
                                border: 'none',
                                padding: '5px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              ✏️ Edit Zone
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteModalZone(zone)}
                              style={{
                                background: '#fee2e2',
                                color: '#dc2626',
                                border: '1px solid #fca5a5',
                                padding: '5px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </MapModule.Popup>
                      <MapModule.Tooltip sticky>
                        <span><strong>{zone.name}</strong> (₹{Number(zone.deliveryCharge).toFixed(2)})</span>
                      </MapModule.Tooltip>
                    </MapModule.Polygon>
                  );
                })}

                {/* Render In-Progress Polygon & Polyline while Drawing */}
                {isDrawing && activeVertices.length > 0 && (
                  <>
                    <MapModule.Polyline
                      positions={activeVertices}
                      pathOptions={{ color: zoneForm.color, weight: 3, dashArray: '4, 4' }}
                    />
                    {activeVertices.length >= 3 && (
                      <MapModule.Polygon
                        positions={activeVertices}
                        pathOptions={{
                          color: zoneForm.color,
                          fillColor: zoneForm.color,
                          fillOpacity: 0.35,
                          weight: 2,
                        }}
                      />
                    )}
                  </>
                )}

                {/* Draggable Markers for Active Vertices (in Drawing or Edit Mode) */}
                {(isDrawing || editingZoneId) &&
                  activeVertices.map((vertex, index) => (
                    <MapModule.Marker
                      key={`vertex-${index}-${vertex[0]}-${vertex[1]}`}
                      position={vertex}
                      draggable={true}
                      icon={MapModule.createVertexIcon(index, index === 0)}
                      eventHandlers={{
                        dragend: (e) => {
                          handleVertexDrag(index, e.target.getLatLng());
                        },
                      }}
                    >
                      <MapModule.Tooltip direction="top" offset={[0, -10]}>
                        <span>Vertex #{index + 1} (Drag to adjust)</span>
                      </MapModule.Tooltip>
                    </MapModule.Marker>
                  ))}
              </MapModule.MapContainer>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#64748b',
                  fontSize: '14px',
                }}
              >
                Loading Interactive Map Engine...
              </div>
            )}

          </div>

          {/* Map Legend Bar (Positioned outside map canvas to prevent obstruction) */}
          {zones.length > 0 && (
            <div className={styles.mapLegendBar}>
              <div className={styles.legendBarLabel}>
                <span>📍</span>
                <span>Active Coverage ({zones.length}):</span>
              </div>
              <div className={styles.legendPillsContainer}>
                {zones.map((z) => (
                  <button
                    key={z._id}
                    type="button"
                    onClick={() => handleFocusZone(z)}
                    className={styles.legendPill}
                    title={`Click to zoom into ${z.name}`}
                  >
                    <span
                      className={styles.legendDot}
                      style={{ backgroundColor: z.color || '#3b82f6' }}
                    />
                    <span className={styles.legendPillName}>{z.name}</span>
                    <span className={styles.legendPillCharge}>
                      ₹{Number(z.deliveryCharge).toFixed(0)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Zone Editor Drawer / Form */}
        {isEditorOpen ? (
          <div className={styles.editorCard}>
            <div className={styles.editorHeader}>
              <h3 className={styles.editorTitle}>
                <span>{editingZoneId ? '✏️ Edit Delivery Zone' : '✨ New Delivery Zone'}</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsEditorOpen(false);
                  setIsDrawing(false);
                  setEditingZoneId(null);
                  setActiveVertices([]);
                }}
                className={styles.closeBtn}
                title="Close editor"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveZone} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div className={styles.editorBody}>
                {/* Boundary Status Indicator */}
                <div
                  className={`${styles.boundaryStatusBox} ${
                    activeVertices.length >= 3 ? styles.boundaryValid : styles.boundaryInvalid
                  }`}
                >
                  <div>
                    <strong>Boundary Status:</strong>{' '}
                    {activeVertices.length >= 3
                      ? `✓ ${activeVertices.length} vertices defined`
                      : `⚠️ ${activeVertices.length} / 3 minimum vertices`}
                  </div>
                  {!isDrawing && (
                    <button
                      type="button"
                      onClick={() => setIsDrawing(true)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '12px',
                      }}
                    >
                      {activeVertices.length === 0 ? 'Draw on Map' : 'Add Points'}
                    </button>
                  )}
                </div>

                {/* Zone Name */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    Zone Name *
                    <span className={styles.formHint}>e.g. Downtown Express Zone</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. North Sector Metro Area"
                    value={zoneForm.name}
                    onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                    className={styles.formInput}
                  />
                </div>

                {/* Description */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Description (Optional)</label>
                  <textarea
                    rows={2}
                    placeholder="Brief description of neighborhood, radius, or coverage details..."
                    value={zoneForm.description}
                    onChange={(e) => setZoneForm({ ...zoneForm, description: e.target.value })}
                    className={styles.formTextarea}
                  />
                </div>

                {/* Status & Color Selection */}
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Zone Status</label>
                    <select
                      value={zoneForm.status}
                      onChange={(e) => setZoneForm({ ...zoneForm, status: e.target.value })}
                      className={styles.formSelect}
                    >
                      <option value="active">Active (Deliverable)</option>
                      <option value="inactive">Inactive (Disabled)</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Map Color</label>
                    <div className={styles.colorPickerRow}>
                      {ZONE_COLORS.map((c) => (
                        <div
                          key={c.hex}
                          onClick={() => setZoneForm({ ...zoneForm, color: c.hex })}
                          className={`${styles.colorSwatch} ${
                            zoneForm.color === c.hex ? styles.colorSwatchSelected : ''
                          }`}
                          style={{ backgroundColor: c.hex }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Delivery Charge & Minimum Order Amount */}
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Delivery Charge (₹)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      required
                      placeholder="0"
                      value={zoneForm.deliveryCharge}
                      onChange={(e) => setZoneForm({ ...zoneForm, deliveryCharge: e.target.value })}
                      className={styles.formInput}
                    />
                    <div className={styles.chipGroup}>
                      {['0', '29', '49', '79', '99'].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setZoneForm({ ...zoneForm, deliveryCharge: amt })}
                          className={`${styles.chip} ${
                            zoneForm.deliveryCharge === amt ? styles.chipActive : ''
                          }`}
                        >
                          {amt === '0' ? 'Free' : `₹${amt}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Min. Order (₹)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      required
                      placeholder="0"
                      value={zoneForm.minOrderAmount}
                      onChange={(e) => setZoneForm({ ...zoneForm, minOrderAmount: e.target.value })}
                      className={styles.formInput}
                    />
                    <div className={styles.chipGroup}>
                      {['0', '99', '199', '299', '499'].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setZoneForm({ ...zoneForm, minOrderAmount: amt })}
                          className={`${styles.chip} ${
                            zoneForm.minOrderAmount === amt ? styles.chipActive : ''
                          }`}
                        >
                          {amt === '0' ? 'None' : `₹${amt}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Estimated Delivery Time */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    Estimated Delivery Time
                    <span className={styles.formHint}>e.g. 25-40 mins</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 30-45 mins"
                    value={zoneForm.estimatedDeliveryTime}
                    onChange={(e) =>
                      setZoneForm({ ...zoneForm, estimatedDeliveryTime: e.target.value })
                    }
                    className={styles.formInput}
                  />
                  <div className={styles.chipGroup}>
                    {['15-25 mins', '30-45 mins', '45-60 mins', 'Same Day Delivery'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setZoneForm({ ...zoneForm, estimatedDeliveryTime: t })}
                        className={`${styles.chip} ${
                          zoneForm.estimatedDeliveryTime === t ? styles.chipActive : ''
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Product & Category Serviceability Assignment */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Serviceable Products Assignment</label>
                  <div className={styles.scopeTabs}>
                    <button
                      type="button"
                      onClick={() => setZoneForm({ ...zoneForm, assignmentType: 'all' })}
                      className={`${styles.scopeTab} ${
                        zoneForm.assignmentType === 'all' ? styles.scopeTabActive : ''
                      }`}
                    >
                      🌐 All Products
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoneForm({ ...zoneForm, assignmentType: 'categories' })}
                      className={`${styles.scopeTab} ${
                        zoneForm.assignmentType === 'categories' ? styles.scopeTabActive : ''
                      }`}
                    >
                      🏷️ By Category
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoneForm({ ...zoneForm, assignmentType: 'products' })}
                      className={`${styles.scopeTab} ${
                        zoneForm.assignmentType === 'products' ? styles.scopeTabActive : ''
                      }`}
                    >
                      📦 By Product
                    </button>
                  </div>
                </div>

                {/* Category Selection Panel */}
                {zoneForm.assignmentType === 'categories' && (
                  <div className={styles.formGroup}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={styles.formLabel}>Select Categories ({zoneForm.assignedCategories.length})</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setZoneForm({ ...zoneForm, assignedCategories: [...allCategories] })}
                          style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoneForm({ ...zoneForm, assignedCategories: [] })}
                          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer' }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className={styles.categoryGrid}>
                      {allCategories.map((cat) => {
                        const isSelected = zoneForm.assignedCategories.includes(cat);
                        return (
                          <div
                            key={cat}
                            onClick={() => toggleCategory(cat)}
                            className={`${styles.categoryPill} ${isSelected ? styles.categoryPillActive : ''}`}
                          >
                            <span>{isSelected ? '✓' : '+'}</span>
                            <span>{cat}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Specific Products Selection Panel */}
                {zoneForm.assignmentType === 'products' && (
                  <div className={styles.formGroup}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={styles.formLabel}>Select Products ({zoneForm.assignedProducts.length} selected)</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Filter products by title..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className={styles.formInput}
                      style={{ marginBottom: '6px', fontSize: '12px', padding: '6px 10px' }}
                    />
                    <div className={styles.productPickerList}>
                      {filteredProducts.length === 0 ? (
                        <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                          No products found
                        </div>
                      ) : (
                        filteredProducts.map((prod) => {
                          const isSelected = zoneForm.assignedProducts.includes(prod._id);
                          return (
                            <div
                              key={prod._id}
                              onClick={() => toggleProduct(prod._id)}
                              className={styles.productPickerItem}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                style={{ cursor: 'pointer' }}
                              />
                              {prod.image ? (
                                <img src={prod.image} alt={prod.title} className={styles.productPickerImg} />
                              ) : (
                                <div className={styles.productPickerImg} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  📦
                                </div>
                              )}
                              <div className={styles.productPickerInfo}>
                                <div className={styles.productPickerTitle}>{prod.title}</div>
                                <div className={styles.productPickerSub}>
                                  ₹{prod.price} • {prod.category}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Editor Actions Footer */}
              <div className={styles.editorFooter}>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditorOpen(false);
                    setIsDrawing(false);
                    setEditingZoneId(null);
                    setActiveVertices([]);
                  }}
                  className={styles.secondaryBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || activeVertices.length < 3}
                  className={styles.primaryBtn}
                >
                  {saving ? 'Saving Zone...' : editingZoneId ? 'Update Delivery Zone' : 'Create Delivery Zone'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div
            className={styles.editorCard}
            style={{
              padding: '30px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '400px',
              background: '#f8fafc',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                marginBottom: '16px',
              }}
            >
              📍
            </div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#0f172a' }}>
              Zone Inspector & Editor
            </h4>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b', maxWidth: '280px', lineHeight: 1.5 }}>
              Select an existing delivery zone from the map or table to inspect and edit, or start drawing a new geographical boundary.
            </p>
            <button
              type="button"
              onClick={handleStartDrawNewZone}
              className={styles.primaryBtn}
            >
              <span>✏️</span> + Draw New Delivery Zone
            </button>
          </div>
        )}
      </div>

      {/* 4. Delivery Zones Data Table */}
      <div className={styles.zonesSection}>
        <div className={styles.zonesSectionHeader}>
          <h2 className={styles.sectionTitle}>Delivery Zones Directory</h2>

          <div className={styles.filterControls}>
            <input
              type="text"
              placeholder="Search zones by name or description..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className={styles.tableSearchInput}
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={styles.statusFilterSelect}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
        </div>

        <div className={styles.tableContainer}>
          <table className={styles.zonesTable}>
            <thead>
              <tr>
                <th>Zone Name</th>
                <th>Status</th>
                <th>Delivery Fee</th>
                <th>Min Order</th>
                <th>Est. Delivery Time</th>
                <th>Serviceability Scope</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredZones.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                    {zones.length === 0
                      ? 'No delivery zones created yet. Click "+ Draw New Delivery Zone" above to define your first boundary!'
                      : 'No zones match your search query.'}
                  </td>
                </tr>
              ) : (
                filteredZones.map((zone) => (
                  <tr key={zone._id} className={styles.zonesTableRow}>
                    <td>
                      <div className={styles.zoneNameCol}>
                        <div
                          className={styles.colorIndicator}
                          style={{ backgroundColor: zone.color || '#3b82f6' }}
                        />
                        <div>
                          <div className={styles.zoneNameText}>{zone.name}</div>
                          {zone.description && (
                            <div className={styles.zoneDescText}>{zone.description}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td>
                      <span
                        className={`${styles.statusBadge} ${
                          zone.status === 'active' ? styles.statusActive : styles.statusInactive
                        }`}
                      >
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: zone.status === 'active' ? '#10b981' : '#94a3b8',
                          }}
                        />
                        {zone.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    <td>
                      <strong style={{ color: Number(zone.deliveryCharge) === 0 ? '#059669' : '#0f172a' }}>
                        {Number(zone.deliveryCharge) === 0 ? 'Free' : `₹${Number(zone.deliveryCharge).toFixed(2)}`}
                      </strong>
                    </td>

                    <td>
                      <span>₹{Number(zone.minOrderAmount || 0).toFixed(2)}</span>
                    </td>

                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>⏱️</span>
                        <span>{zone.estimatedDeliveryTime || '30 mins'}</span>
                      </span>
                    </td>

                    <td>
                      <span
                        style={{
                          background: '#f1f5f9',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {zone.assignmentType === 'all'
                          ? '🌐 All Products'
                          : zone.assignmentType === 'categories'
                          ? `🏷️ ${zone.assignedCategories?.length || 0} Categories`
                          : `📦 ${zone.assignedProducts?.length || 0} Products`}
                      </span>
                    </td>

                    <td>
                      <div className={styles.actionBtnGroup}>
                        <button
                          type="button"
                          onClick={() => handleFocusZone(zone)}
                          className={styles.actionBtn}
                          title="Focus map on zone"
                        >
                          🎯 Focus
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditZone(zone)}
                          className={`${styles.actionBtn} ${styles.actionBtnEdit}`}
                          title="Edit zone"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteModalZone(zone)}
                          className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                          title="Delete zone"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Delete Confirmation Modal */}
      {deleteModalZone && (
        <div
          className={styles.modalOverlay}
          onClick={() => setDeleteModalZone(null)}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>
              <span>⚠️</span> Delete Delivery Zone
            </h3>
            <p className={styles.modalText}>
              Are you sure you want to delete the delivery zone <strong>"{deleteModalZone.name}"</strong>?
              Customers in this geographical boundary will no longer be eligible for zone-specific rates or serviceability.
            </p>
            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setDeleteModalZone(null)}
                className={styles.secondaryBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteZone}
                className={styles.dangerBtn}
              >
                Yes, Delete Zone
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to keep styling clean
function titleAreaClass(styles) {
  return styles.titleArea;
}
