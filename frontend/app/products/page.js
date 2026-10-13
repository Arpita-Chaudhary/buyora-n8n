'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './products.module.css';
import { useCart } from '../../utils/cart';
import CustomerNavbar from '../../components/CustomerNavbar';
import { getStoredAuth } from '../../utils/auth';
import LocationPicker from '../../components/LocationPicker';
import { useDeliveryLocation } from '../../utils/deliveryLocation';

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Customer delivery zone & address
  const { address, zone, loading: zoneLoading } = useDeliveryLocation();
  const [deliverableOnly, setDeliverableOnly] = useState(true);

  // Customer Cart from shared hook
  const { cart, totalCount, addItem, updateQty, removeItem } = useCart();
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Product Details Modal state
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [modalQuantity, setModalQuantity] = useState(1);

  // Feedback Toast state
  const [toastMessage, setToastMessage] = useState(null);
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);

  // Current logged in user (if any)
  const [currentUser, setCurrentUser] = useState(null);

  // Geolocation & Nearby Products state
  const [userLocation, setUserLocation] = useState(null); // Active applied location: { lat, lng }
  const [manualLocation, setManualLocation] = useState(null); // Selected coordinates on map: { lat, lng }
  const [selectedRadius, setSelectedRadius] = useState(5); // 5, 10, 25 km
  const [isManualMapOpen, setIsManualMapOpen] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState(null);
  const [isNearbyActive, setIsNearbyActive] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(null); // Linked map marker & product card ID

  // Connect Map Marker <-> Product Card
  const handleMarkerClick = (product) => {
    if (!product || !product._id) return;
    setSelectedProductId(product._id);

    // Scroll smoothly to corresponding card in nearby list or main grid
    const nearbyCard = document.getElementById(`nearby-map-card-${product._id}`);
    const mainCard = document.getElementById(`product-card-${product._id}`);
    const targetCard = nearbyCard || mainCard;

    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleProductCardClick = (product) => {
    if (!product || !product._id) return;
    setSelectedProductId(product._id);

    // Open map if currently closed so marker is visible
    if (!isManualMapOpen) {
      setIsManualMapOpen(true);
    }

    // Scroll map container into view if user is further down the page
    const mapSection = document.getElementById('location-map-section');
    if (mapSection) {
      mapSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // 1. Check for logged-in user on mount & sync search from URL
  useEffect(() => {
    try {
      const auth = getStoredAuth();
      if (auth && auth.user) {
        setCurrentUser(auth.user);
      }
    } catch (e) {
      // Ignore JSON parse errors
    }

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('search') || params.get('q');
      const cat = params.get('category');
      if (q) setSearchQuery(q);
      if (cat) setSelectedCategory(cat);
    }
  }, []);

  // 2. Fetch products from existing backend Product API
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pass status=active so customers only receive active items
      // Also send Authorization header if token exists
      const token = typeof window !== 'undefined' ? getStoredAuth().token : null;
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let url = '/api/products?status=active';
      if (deliverableOnly && address?.lat && address?.lng) {
        url += `&latitude=${address.lat}&longitude=${address.lng}`;
      }

      const res = await fetch(url, {
        headers,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Failed to fetch products (HTTP ${res.status})`);
      }

      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        // Double-check defensive filter to ensure strictly active products
        const activeOnly = data.data.filter((p) => p.status === 'active');
        setProducts(activeOnly);
      } else {
        setProducts([]);
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred while loading products.');
    } finally {
      setLoading(false);
    }
  }, [deliverableOnly, address?.lat, address?.lng]);

  // 2b. Fetch nearby products from backend GET /api/products/nearby
  const fetchNearbyProducts = async (lat, lng, radius = selectedRadius) => {
    // Validate coordinates presence and validity
    if (lat === undefined || lng === undefined || lat === null || lng === null || isNaN(Number(lat)) || isNaN(Number(lng))) {
      setLocError('Location coordinates are missing or invalid. Please select a valid location on the map.');
      return;
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    // Validate geographic coordinate boundaries
    if (numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) {
      setLocError('Invalid location coordinates. Latitude must be between -90 and 90, and longitude between -180 and 180.');
      return;
    }

    setLoading(true);
    setLocLoading(true);
    setError(null);
    setLocError(null);
    try {
      const res = await fetch(`/api/products/nearby?latitude=${numLat}&longitude=${numLng}&radius=${radius}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `Failed to fetch nearby products (HTTP ${res.status})`);
      }

      if (data.success && Array.isArray(data.data)) {
        setProducts(data.data);
      } else {
        setProducts([]);
      }
    } catch (err) {
      setLocError(err.message || 'Error loading nearby products. Please select a location manually.');
    } finally {
      setLoading(false);
      setLocLoading(false);
    }
  };

  // 2c. Customer Geolocation Handler
  const handleGetCurrentLocation = () => {
    setLocError(null);

    // Check if browser supports Geolocation API
    if (typeof window === 'undefined' || !navigator || !navigator.geolocation) {
      setLocError('Geolocation is not supported by your browser. Please select a location manually.');
      setIsManualMapOpen(true);
      return;
    }

    setLocLoading(true);

    // Request current position from browser
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        // Get latitude and longitude
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));

        // Store coordinates in React state
        setUserLocation({ lat, lng });
        setManualLocation({ lat, lng });
        setIsNearbyActive(true);

        // Call GET /api/products/nearby
        await fetchNearbyProducts(lat, lng, selectedRadius);
      },
      (err) => {
        setLocLoading(false);
        // Handle errors and prompt customer to select manually
        let msg = 'Unable to retrieve your current location. Please select a location manually.';
        if (err.code === 1) { // PERMISSION_DENIED
          msg = 'Location permission was denied. Please allow location access in your browser or select a location manually.';
        } else if (err.code === 2) { // POSITION_UNAVAILABLE
          msg = 'Your location information is currently unavailable. Please select a location manually.';
        } else if (err.code === 3) { // TIMEOUT
          msg = 'Location request timed out. Please try again or select a location manually.';
        }
        setLocError(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  // 2d. Search nearby products using manually selected coordinates
  const handleSearchManualNearby = async () => {
    if (!manualLocation || typeof manualLocation.lat !== 'number' || typeof manualLocation.lng !== 'number') {
      setLocError('Please click on the map to select a location first.');
      return;
    }
    setLocError(null);
    setUserLocation(manualLocation);
    setIsNearbyActive(true);
    await fetchNearbyProducts(manualLocation.lat, manualLocation.lng, selectedRadius);
  };

  // 2e. Handle radius filter change (5 km, 10 km, 25 km)
  const handleRadiusChange = (radius) => {
    const r = Number(radius);
    setSelectedRadius(r);
    // Requirement 4: Do not make an API call if no location has been selected yet.
    // Requirement 3: Use the customer's currently selected latitude and longitude.
    if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
      fetchNearbyProducts(userLocation.lat, userLocation.lng, r);
    }
  };

  // 2f. Reset location filter to view all products
  const handleClearLocation = () => {
    setUserLocation(null);
    setManualLocation(null);
    setIsNearbyActive(false);
    setSelectedProductId(null);
    setLocError(null);
    fetchProducts();
  };

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // 3. Extract distinct categories from fetched active products
  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => {
      if (p.category && p.category.trim()) {
        set.add(p.category.trim());
      }
    });
    return ['ALL', ...Array.from(set)];
  }, [products]);

  // 4. Filter products based on search query and category
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      // Category filter
      if (selectedCategory !== 'ALL' && product.category?.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      // Search query filter (matches title, description, or category)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = product.title?.toLowerCase().includes(q);
        const descMatch = product.description?.toLowerCase().includes(q);
        const catMatch = product.category?.toLowerCase().includes(q);
        return titleMatch || descMatch || catMatch;
      }
      return true;
    });
  }, [products, selectedCategory, searchQuery]);

  // Trigger Toast Notification helper
  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // 5. Add to Cart Handler (supports multiple distinct products)
  const handleAddToCart = (product, qtyToAdd = 1) => {
    if (!product || product.quantity <= 0) return;
    addItem(product, qtyToAdd);
    setRecentlyAddedId(product._id);
    setTimeout(() => setRecentlyAddedId(null), 1200);
    showToast(`Added "${product.title}" to cart!`);
  };

  // Cart quantity controls
  const handleCartQtyChange = (productId, delta) => {
    const newCart = cart
      .map((item) => {
        if (item._id === productId) {
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) return null;
          return {
            ...item,
            quantity: Math.min(nextQty, item.maxStock || 999),
          };
        }
        return item;
      })
      .filter(Boolean);

    updateCart(newCart);
  };

  const handleRemoveFromCart = (productId) => {
    const newCart = cart.filter((item) => item._id !== productId);
    updateCart(newCart);
  };

  // Cart subtotal & total items calculation
  const totalCartCount = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.quantity, 0);
  }, [cart]);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  }, [cart]);

  // Open Details Modal
  const handleOpenDetails = (product) => {
    setSelectedProduct(product);
    setModalQuantity(1);
  };

  // Close Details Modal
  const handleCloseDetails = () => {
    setSelectedProduct(null);
    setModalQuantity(1);
  };

  return (
    <div className={styles.pageContainer}>
      {/* ------------------------------------------------------------------
          1. Storefront Navigation Bar
          ------------------------------------------------------------------ */}
      <CustomerNavbar />



      {/* ------------------------------------------------------------------
          2. Storefront Hero Banner
          ------------------------------------------------------------------ */}
      <section className={styles.heroSection}>
        <div className={styles.heroContent}>

          <h1 className={styles.heroTitle}>Discover Quality Products</h1>
          <p className={styles.heroDescription}>
            Browse our handpicked inventory with real-time stock availability, instant preview, and direct ordering.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------
          3. Search & Category Filter Toolbar
          ------------------------------------------------------------------ */}
      <div className={styles.toolbarContainer}>
        <div className={styles.toolbar}>
          {/* Search Box */}
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by title, description, category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Categories Pill Selector */}
          <div className={styles.categoriesWrapper}>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`${styles.categoryPill} ${selectedCategory === cat ? styles.categoryPillActive : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat === 'ALL' ? 'All Products' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Location Availability & Geolocation Toolbar */}
        <div style={{
          marginTop: '14px',
          padding: '14px 18px',
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                Local Delivery & Nearby Search
              </div>
              <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#0f172a' }}>
                {userLocation ? (
                  <span style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                    Showing products within {selectedRadius} km ({userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)})
                  </span>
                ) : (
                  'Find products near your current location or pick on map'
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Distance Filter Buttons (5 km, 10 km, 25 km) */}
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200">
              <span className="text-xs font-semibold text-slate-500 px-2 select-none">Distance:</span>
              {[5, 10, 25].map((radius) => {
                const isSelected = selectedRadius === radius;
                return (
                  <button
                    key={radius}
                    type="button"
                    onClick={() => handleRadiusChange(radius)}
                    disabled={locLoading}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-150 ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-700/20'
                        : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 border border-slate-200'
                    } ${locLoading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {radius} km
                  </button>
                );
              })}
            </div>

            {locLoading && (
              <span className="text-xs text-blue-600 font-semibold animate-pulse flex items-center gap-1">
                <svg className="animate-spin h-3.5 w-3.5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Searching...
              </span>
            )}

            {userLocation && (
              <button
                type="button"
                onClick={handleClearLocation}
                style={{
                  padding: '7px 14px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: '#475569',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                Clear Location
              </button>
            )}

            {/* Select Location Manually Button */}
            <button
              type="button"
              onClick={() => setIsManualMapOpen((prev) => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: isManualMapOpen ? '#f1f5f9' : '#ffffff',
                color: isManualMapOpen ? '#1e293b' : '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
                <line x1="8" y1="2" x2="8" y2="18"></line>
                <line x1="16" y1="6" x2="16" y2="22"></line>
              </svg>
              <span>{isManualMapOpen ? 'Hide Map' : 'Select Location Manually'}</span>
            </button>

            {/* Use My Current Location Button */}
            <button
              type="button"
              onClick={handleGetCurrentLocation}
              disabled={locLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: locLoading ? 'not-allowed' : 'pointer',
                opacity: locLoading ? 0.75 : 1,
                boxShadow: '0 1px 2px rgba(37, 99, 235, 0.2)',
              }}
            >
              {locLoading ? (
                <span>Finding location...</span>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="22" y1="12" x2="18" y2="12"></line>
                    <line x1="6" y1="12" x2="2" y2="12"></line>
                    <line x1="12" y1="6" x2="12" y2="2"></line>
                    <line x1="12" y1="22" x2="12" y2="18"></line>
                  </svg>
                  <span>Use My Current Location</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Location Error Notice */}
        {locError && (
          <div style={{
            marginTop: '10px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#fffbeb',
            border: '1px solid #fef3c7',
            color: '#92400e',
            fontSize: '12.5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚠️</span>
              <span>{locError}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {!isManualMapOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setIsManualMapOpen(true);
                    setLocError(null);
                  }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#92400e',
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Select Location Manually
                </button>
              )}
              <button
                type="button"
                onClick={() => setLocError(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#b45309',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Manual Location Selection Map Panel */}
        {isManualMapOpen && (
          <div
            id="location-map-section"
            style={{
              marginTop: '12px',
              padding: '16px',
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #cbd5e1',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
              flexWrap: 'wrap',
              gap: '8px',
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🗺️</span> Select Location on Map
                </h3>
                <p style={{ fontSize: '12.5px', color: '#64748b', margin: '3px 0 0 0' }}>
                  Click anywhere on the map to set your coordinates, then click &quot;Search Nearby Products&quot;.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {isNearbyActive && (
                  <div style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    color: '#1d4ed8',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}>
                    📍 {products.length} {products.length === 1 ? 'product' : 'products'} on map
                  </div>
                )}
                {manualLocation && (
                  <div style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    color: '#166534',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'monospace',
                  }}>
                    Coordinates: {manualLocation.lat.toFixed(4)}, {manualLocation.lng.toFixed(4)}
                  </div>
                )}
              </div>
            </div>

            {/* Reusable Leaflet LocationPicker component with Area Search */}
            <LocationPicker
              value={manualLocation || userLocation}
              onChange={(coords) => {
                setManualLocation(coords);
                setLocError(null);
                if (isNearbyActive) {
                  setUserLocation(coords);
                  fetchNearbyProducts(coords.lat, coords.lng, selectedRadius);
                }
              }}
              height="350px"
              placeholderText="Click anywhere on the map or search an area to select your chosen location."
              products={isNearbyActive ? products : []}
              selectedProductId={selectedProductId}
              onProductMarkerClick={handleMarkerClick}
              onViewProduct={(product) => {
                if (product && product._id) {
                  router.push(`/products/${product._id}`);
                }
              }}
            />

            {/* Controls & Search Nearby Products Button */}
            <div style={{
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}>
              <div style={{ fontSize: '12.5px', color: '#64748b' }}>
                {manualLocation ? (
                  <span style={{ color: '#059669', fontWeight: 600 }}>
                    ✓ Selected: Lat {manualLocation.lat.toFixed(4)}, Lng {manualLocation.lng.toFixed(4)} (Radius: {selectedRadius} km)
                  </span>
                ) : (
                  <span>Click on the map above to select your position.</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {/* Radius Filter Buttons inside Map Panel */}
                <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200">
                  <span className="text-xs font-semibold text-slate-500 px-1.5 select-none">Radius:</span>
                  {[5, 10, 25].map((radius) => {
                    const isSelected = selectedRadius === radius;
                    return (
                      <button
                        key={radius}
                        type="button"
                        onClick={() => handleRadiusChange(radius)}
                        disabled={locLoading}
                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
                        } ${locLoading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {radius} km
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setIsManualMapOpen(false)}
                  style={{
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#64748b',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  Close Map
                </button>

                <button
                  type="button"
                  onClick={handleSearchManualNearby}
                  disabled={!manualLocation || locLoading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 18px',
                    background: !manualLocation || locLoading ? '#94a3b8' : '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: !manualLocation || locLoading ? 'not-allowed' : 'pointer',
                    boxShadow: !manualLocation || locLoading ? 'none' : '0 2px 4px rgba(37, 99, 235, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <span>{locLoading ? 'Searching...' : 'Search Nearby Products'}</span>
                </button>
              </div>
            </div>

            {/* Nearby Products List Below the Map */}
            {isNearbyActive && filteredProducts.length > 0 && (
              <div className="mt-6 pt-5 border-t border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <span>🛍️</span> Nearby Products ({filteredProducts.length} within {selectedRadius} km)
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Products sorted by proximity to your selected location.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredProducts.map((product) => {
                    const isOutOfStock = !product.quantity || product.quantity <= 0;
                    const isSelected = selectedProductId && String(selectedProductId) === String(product._id);
                    return (
                      <div
                        key={`nearby-map-card-${product._id}`}
                        id={`nearby-map-card-${product._id}`}
                        onClick={() => handleProductCardClick(product)}
                        className={`bg-white rounded-xl border transition-all duration-200 flex flex-col overflow-hidden group cursor-pointer ${
                          isSelected
                            ? 'ring-2 ring-blue-600 border-blue-600 shadow-xl bg-blue-50/20 scale-[1.01]'
                            : 'border-slate-200 hover:border-blue-400 shadow-sm hover:shadow-md'
                        }`}
                      >
                        {/* Product Image & Badges */}
                        <div className="relative aspect-video sm:aspect-square bg-slate-100 overflow-hidden">
                          {product.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.image}
                              alt={product.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                              <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="1.6"></rect>
                                <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.6"></circle>
                                <polyline points="21 15 16 10 5 21" strokeWidth="1.6"></polyline>
                              </svg>
                              <span>No Image</span>
                            </div>
                          )}

                          {/* Category Tag */}
                          {product.category && (
                            <span className="absolute top-2.5 left-2.5 px-2 py-0.5 text-[11px] font-semibold bg-white/95 backdrop-blur-sm text-slate-700 rounded-md shadow-sm border border-slate-200/80">
                              {product.category}
                            </span>
                          )}

                          {/* Distance from selected location */}
                          {product.distanceKm !== undefined && (
                            <span className="absolute top-2.5 right-2.5 px-2 py-0.5 text-[11px] font-bold bg-emerald-600/90 backdrop-blur-sm text-white rounded-md shadow-sm">
                              📍 {product.distanceKm} km away
                            </span>
                          )}

                          {/* Active Marker Linked Badge */}
                          {isSelected && (
                            <span className="absolute bottom-2.5 left-2.5 px-2.5 py-1 text-[11px] font-bold bg-blue-600 text-white rounded-md shadow-md flex items-center gap-1 animate-pulse">
                              ⭐ Selected on Map
                            </span>
                          )}
                        </div>

                        {/* Card Body */}
                        <div className="p-4 flex flex-col flex-1">
                          <h5 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1 mb-1" title={product.title}>
                            {product.title}
                          </h5>

                          <div className="text-base font-extrabold text-slate-900 mb-1">
                            ₹{product.price}
                          </div>

                          {product.distanceKm !== undefined && (
                            <div className="text-xs font-semibold text-emerald-600 mb-3 flex items-center gap-1">
                              <span>{product.distanceKm} km away</span>
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="mt-auto pt-2 flex items-center gap-2">
                            <Link
                              href={`/products/${product._id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-lg text-center transition-colors shadow-sm"
                            >
                              View Product
                            </Link>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToCart(product, 1);
                              }}
                              disabled={isOutOfStock}
                              title={isOutOfStock ? 'Out of stock' : 'Add to cart'}
                              className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                                isOutOfStock
                                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                  : 'bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-700 border-slate-300'
                              }`}
                            >
                              Add to Cart
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Empty State within Map Panel */}
            {isNearbyActive && filteredProducts.length === 0 && !locLoading && (
              <div className="mt-5 p-5 bg-amber-50/80 border border-amber-200 rounded-xl text-center">
                <div className="text-3xl mb-1.5">📍</div>
                <h5 className="font-bold text-base text-amber-900 mb-1">
                  No products found within {selectedRadius} km.
                </h5>
                <p className="text-xs text-amber-700 mb-3.5">
                  Try increasing the search radius to discover products available farther away.
                </p>
                <div className="inline-flex items-center gap-1.5 p-1 bg-white rounded-lg border border-amber-200 shadow-sm">
                  <span className="text-xs font-semibold text-slate-500 px-2 select-none">Try Radius:</span>
                  {[5, 10, 25].map((r) => {
                    const isSelected = selectedRadius === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleRadiusChange(r)}
                        disabled={locLoading || isSelected}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                          isSelected
                            ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-700/20 cursor-default'
                            : 'bg-white hover:bg-amber-50 text-amber-900 border border-amber-200 cursor-pointer'
                        }`}
                      >
                        {r} km
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results Metadata */}
        {!loading && !error && (
          <div className={styles.resultsMeta}>
            <span>
              Showing <strong>{filteredProducts.length}</strong> available {filteredProducts.length === 1 ? 'product' : 'products'}
              {selectedCategory !== 'ALL' && ` in "${selectedCategory}"`}
              {searchQuery.trim() && ` matching "${searchQuery}"`}
            </span>
            {(selectedCategory !== 'ALL' || searchQuery.trim()) && (
              <button
                type="button"
                className={styles.clearFilterLink}
                onClick={() => {
                  setSelectedCategory('ALL');
                  setSearchQuery('');
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------
          4. Main Product Content Area
          ------------------------------------------------------------------ */}
      <main className={styles.mainContent}>
        {/* Loading State: Skeleton Cards Grid */}
        {loading && (
          <div className={styles.productGrid}>
            {[1, 2, 3, 4, 5, 6].map((idx) => (
              <div key={idx} className={styles.skeletonCard}>
                <div className={styles.skeletonImage} />
                <div className={styles.skeletonBody}>
                  <div className={styles.skeletonLine} style={{ width: '40%' }} />
                  <div className={styles.skeletonLine} style={{ width: '85%' }} />
                  <div className={styles.skeletonLine} style={{ width: '60%' }} />
                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between' }}>
                    <div className={styles.skeletonLine} style={{ width: '35%', height: '24px' }} />
                    <div className={styles.skeletonLine} style={{ width: '30%', height: '24px' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className={styles.stateContainer}>
            <div className={`${styles.stateIcon} ${styles.stateIconError}`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h2 className={styles.stateTitle}>Unable to Load Products</h2>
            <p className={styles.stateMessage}>{error}</p>
            <button type="button" className={styles.retryButton} onClick={fetchProducts}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              <span>Try Again</span>
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredProducts.length === 0 && (
          <div className={styles.stateContainer}>
            <div className={`${styles.stateIcon} ${styles.stateIconEmpty}`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
            </div>

            {isNearbyActive ? (
              <>
                <h2 className={styles.stateTitle}>
                  No products found within {selectedRadius} km.
                </h2>
                <p className={styles.stateMessage}>
                  Try increasing the search radius to discover products available farther away.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', marginTop: '16px' }}>
                  <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200 shadow-sm">
                    <span className="text-xs font-semibold text-slate-500 px-2 select-none">Try Radius:</span>
                    {[5, 10, 25].map((r) => {
                      const isSelected = selectedRadius === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => handleRadiusChange(r)}
                          disabled={locLoading || isSelected}
                          className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-700/20 cursor-default'
                              : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 cursor-pointer'
                          }`}
                        >
                          {r} km
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={handleClearLocation}
                  >
                    Clear Location & View All Products
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className={styles.stateTitle}>No Products Found</h2>
                <p className={styles.stateMessage}>
                  {searchQuery.trim() || selectedCategory !== 'ALL'
                    ? 'We could not find any active products matching your filters. Try clearing your search or switching categories.'
                    : 'There are currently no active products available in the store. Please check back later!'}
                </p>
                {(searchQuery.trim() || selectedCategory !== 'ALL') && (
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => {
                      setSelectedCategory('ALL');
                      setSearchQuery('');
                    }}
                  >
                    Clear All Filters
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* 5. Products Grid */}
        {!loading && !error && filteredProducts.length > 0 && (
          <div className={styles.productGrid}>
            {filteredProducts.map((product) => {
              const isOutOfStock = !product.quantity || product.quantity <= 0;
              const isLowStock = !isOutOfStock && product.quantity <= 5;
              const isRecentlyAdded = recentlyAddedId === product._id;
              const isSelected = selectedProductId && String(selectedProductId) === String(product._id);

              return (
                <article
                  key={product._id}
                  id={`product-card-${product._id}`}
                  onClick={() => handleProductCardClick(product)}
                  className={`${styles.productCard} ${isSelected ? 'ring-2 ring-blue-600 shadow-xl' : ''}`}
                  style={isSelected ? { borderColor: '#2563eb', boxShadow: '0 0 0 2px #2563eb, 0 10px 25px -5px rgba(37, 99, 235, 0.3)', cursor: 'pointer' } : { cursor: 'pointer' }}
                >
                  {/* Product Image & Badges */}
                  <div className={styles.imageWrapper}>
                    {product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image}
                        alt={product.title}
                        className={styles.productImage}
                        loading="lazy"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}

                    {/* Fallback Placeholder (shown if no image or image fails) */}
                    <div
                      className={styles.imagePlaceholder}
                      style={{ display: product.image ? 'none' : 'flex' }}
                    >
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                        <polyline points="21 15 16 10 5 21"></polyline>
                      </svg>
                      <span>No Image Available</span>
                    </div>

                    {/* Category Tag */}
                    {product.category && (
                      <span className={styles.categoryTag}>{product.category}</span>
                    )}

                    {/* Active Marker Linked Badge */}
                    {isSelected && (
                      <span className="absolute bottom-2.5 left-2.5 px-2.5 py-1 text-[11px] font-bold bg-blue-600 text-white rounded-md shadow-md flex items-center gap-1 z-10 animate-pulse">
                        ⭐ Selected on Map
                      </span>
                    )}

                    {/* Stock Status Badge Overlay */}
                    <div className={styles.stockBadgeOverlay}>
                      {isOutOfStock ? (
                        <span className={styles.outOfStockBadge}>Out of Stock</span>
                      ) : isLowStock ? (
                        <span className={styles.lowStockBadge}>Only {product.quantity} left</span>
                      ) : (
                        <span className={styles.inStockBadge}>In Stock</span>
                      )}

                      {/* Distance Badge for Nearby Search */}
                      {product.distanceKm !== undefined && (
                        <span
                          style={{
                            background: 'rgba(16, 185, 129, 0.92)',
                            color: '#ffffff',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backdropFilter: 'blur(4px)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginLeft: '6px',
                          }}
                        >
                          📍 {product.distanceKm} km away
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Product Card Body */}
                  <div className={styles.cardBody}>
                    <h3 className={styles.productTitle} title={product.title}>
                      <Link
                        href={`/products/${product._id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {product.title}
                      </Link>
                    </h3>
                    <p className={styles.productDescription} title={product.description}>
                      {product.description || 'No description provided for this product.'}
                    </p>

                    {/* Price & Available Stock Row */}
                    <div className={styles.metaRow}>
                      <div className={styles.priceContainer}>
                        <span className={styles.priceLabel}>Price</span>
                        <span className={styles.priceValue}>
                          ₹{product.price}
                        </span>
                      </div>

                      <div className={styles.stockInfo}>
                        <span className={styles.priceLabel}>Available Stock</span>
                        <span
                          className={`${styles.stockCount} ${isOutOfStock
                              ? styles.stockOut
                              : isLowStock
                                ? styles.stockLow
                                : styles.stockIn
                            }`}
                        >
                          {isOutOfStock ? '0 units' : `${product.quantity} units`}
                        </span>
                      </div>
                    </div>

                    {/* Distance from selected location */}
                    {product.distanceKm !== undefined && (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 mb-3 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">
                        <span>📍</span>
                        <span>{product.distanceKm} km away from your location</span>
                      </div>
                    )}

                    {/* Delivery Zone Information Badge */}
                    {zone?.serviceable && zone?.primaryZone ? (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#047857',
                        background: '#ecfdf5',
                        border: '1px solid #a7f3d0',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        marginBottom: '10px',
                      }}>
                        <span>⚡</span>
                        <span>Deliverable: {zone.primaryZone.estimatedDeliveryTime || '20-35 mins'}</span>
                        <span style={{ color: '#94a3b8' }}>•</span>
                        <span>{Number(zone.primaryZone.deliveryCharge) === 0 ? 'Free Delivery' : `₹${Number(zone.primaryZone.deliveryCharge).toFixed(2)} Fee`}</span>
                      </div>
                    ) : zone && !zone.serviceable ? (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#b45309',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        marginBottom: '10px',
                      }}>
                        <span>⚠️</span>
                        <span>Service Unreachable for selected address</span>
                      </div>
                    ) : null}

                    {/* Action Buttons: View Product & Add to Cart */}
                    <div className={styles.cardActions}>
                      <Link
                        href={`/products/${product._id}`}
                        onClick={(e) => e.stopPropagation()}
                        className={styles.viewDetailsBtn}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="16" x2="12" y2="12"></line>
                          <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                        <span>View Product</span>
                      </Link>

                      <button
                        type="button"
                        className={`${styles.addToCartBtn} ${isRecentlyAdded ? styles.addedFeedback : ''}`}
                        disabled={isOutOfStock}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCart(product, 1);
                        }}
                        title={isOutOfStock ? 'This item is currently out of stock' : 'Add to your cart'}
                      >
                        {isRecentlyAdded ? (
                          <>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            <span>Added!</span>
                          </>
                        ) : isOutOfStock ? (
                          <span>Out of Stock</span>
                        ) : (
                          <>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 5v14M5 12h14"></path>
                            </svg>
                            <span>Add to Cart</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------------
          6. Product Details Modal
          ------------------------------------------------------------------ */}
      {selectedProduct && (
        <div className={styles.modalBackdrop} onClick={handleCloseDetails}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={handleCloseDetails}
              aria-label="Close product details"
            >
              ✕
            </button>

            <div className={styles.modalGrid}>
              {/* Modal Image Side */}
              <div className={styles.modalImageSide}>
                {selectedProduct.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedProduct.image}
                    alt={selectedProduct.title}
                    className={styles.modalImg}
                  />
                ) : (
                  <div className={styles.imagePlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    <span>No Image Provided</span>
                  </div>
                )}
              </div>

              {/* Modal Details Side */}
              <div className={styles.modalContentSide}>
                <span className={styles.modalCategory}>
                  {selectedProduct.category || 'General'}
                </span>
                <h2 className={styles.modalTitle}>{selectedProduct.title}</h2>

                <div className={styles.modalPriceRow}>
                  <span className={styles.modalPrice}>
                    ₹{Number(selectedProduct.price).toFixed(2)}
                  </span>
                  {selectedProduct.quantity > 0 ? (
                    <span className={styles.inStockBadge}>
                      {selectedProduct.quantity} in stock
                    </span>
                  ) : (
                    <span className={styles.outOfStockBadge}>Out of Stock</span>
                  )}
                </div>

                <p className={styles.modalDescription}>
                  {selectedProduct.description || 'No detailed description available.'}
                </p>

                <div className={styles.modalSpecs}>
                  <div>
                    <span style={{ color: '#64748b' }}>Availability: </span>
                    <strong>{selectedProduct.quantity > 0 ? 'Ready to ship' : 'Unavailable'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Product ID: </span>
                    <code style={{ fontSize: '11px', background: '#e2e8f0', padding: '2px 4px', borderRadius: '4px' }}>
                      {selectedProduct._id.slice(-6)}
                    </code>
                  </div>
                </div>

                {/* Modal Quantity & Add to Cart */}
                <div className={styles.modalActions}>
                  {selectedProduct.quantity > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#334155' }}>Quantity:</span>
                      <div className={styles.cartItemQtyControl}>
                        <button
                          type="button"
                          className={styles.qtyBtn}
                          onClick={() => setModalQuantity((prev) => Math.max(1, prev - 1))}
                        >
                          -
                        </button>
                        <span className={styles.qtyNumber}>{modalQuantity}</span>
                        <button
                          type="button"
                          className={styles.qtyBtn}
                          onClick={() =>
                            setModalQuantity((prev) =>
                              Math.min(selectedProduct.quantity, prev + 1)
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className={styles.addToCartBtn}
                    style={{ width: '100%', padding: '12px' }}
                    disabled={selectedProduct.quantity <= 0}
                    onClick={() => {
                      handleAddToCart(selectedProduct, modalQuantity);
                      handleCloseDetails();
                    }}
                  >
                    {selectedProduct.quantity <= 0
                      ? 'Out of Stock'
                      : `Add ${modalQuantity > 1 ? `${modalQuantity} items` : 'to Cart'} • ₹${(
                        selectedProduct.price * modalQuantity
                      ).toFixed(2)}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          7. Customer Cart Drawer / Slide-Out
          ------------------------------------------------------------------ */}
      {isCartOpen && (
        <div className={styles.drawerBackdrop} onClick={() => setIsCartOpen(false)}>
          <div className={styles.cartDrawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div className={styles.drawerTitle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="9" cy="21" r="1"></circle>
                  <circle cx="20" cy="21" r="1"></circle>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
                <span>Your Cart ({totalCartCount})</span>
              </div>
              <button
                type="button"
                className={styles.drawerCloseBtn}
                onClick={() => setIsCartOpen(false)}
                aria-label="Close cart"
              >
                ✕
              </button>
            </div>

            <div className={styles.drawerBody}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: '#64748b' }}>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                  </svg>
                  <p style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b' }}>Your cart is empty</p>
                  <p style={{ fontSize: '13px', marginTop: '4px' }}>
                    Browse our products and add your favorite items to get started.
                  </p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item._id} className={styles.cartItem}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image || '/placeholder.png'}
                      alt={item.title}
                      className={styles.cartItemImg}
                      onError={(e) => {
                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" fill="%23e2e8f0"><rect width="60" height="60"/></svg>';
                      }}
                    />
                    <div className={styles.cartItemDetails}>
                      <div className={styles.cartItemTitle}>{item.title}</div>
                      <div className={styles.cartItemPrice}>
                        ₹{(item.price * item.quantity).toFixed(2)}
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, marginLeft: '6px' }}>
                          (₹{Number(item.price).toFixed(2)} ea)
                        </span>
                      </div>
                      <div className={styles.cartItemQtyControl}>
                        <button
                          type="button"
                          className={styles.qtyBtn}
                          onClick={() => handleCartQtyChange(item._id, -1)}
                        >
                          -
                        </button>
                        <span className={styles.qtyNumber}>{item.quantity}</span>
                        <button
                          type="button"
                          className={styles.qtyBtn}
                          disabled={item.quantity >= item.maxStock}
                          onClick={() => handleCartQtyChange(item._id, 1)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className={styles.cartItemRemove}
                          onClick={() => handleRemoveFromCart(item._id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className={styles.drawerFooter}>
                <div className={styles.subtotalRow}>
                  <span>Subtotal:</span>
                  <span>₹{cartSubtotal.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  className={styles.checkoutBtn}
                  onClick={() => {
                    showToast('Proceeding to checkout...');
                  }}
                >
                  Checkout (₹{cartSubtotal.toFixed(2)})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          8. Feedback Toast
          ------------------------------------------------------------------ */}
      {toastMessage && (
        <div className={styles.toast}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
}
