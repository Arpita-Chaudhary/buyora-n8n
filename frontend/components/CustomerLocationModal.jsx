'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from './CustomerLocationModal.module.css';
import {
  useDeliveryLocation,
  checkZoneServiceability,
  reverseGeocodeCoords,
} from '../utils/deliveryLocation';

// Bounding box for India [South-West, North-East]
const INDIA_BOUNDS = [
  [6.5546, 68.1113],
  [35.6745, 97.3956],
];

export default function CustomerLocationModal({ isOpen, onClose }) {
  const {
    address: currentAddress,
    savedAddresses,
    homeAddress,
    zone: activeZone,
    selectLocation,
    saveAddress,
    removeAddress,
    detectGPSLocation,
  } = useDeliveryLocation();

  // View state: main map view vs all saved addresses view
  const [showSavedAddressesView, setShowSavedAddressesView] = useState(false);

  // Temporary draft location while picking in modal
  const [draftLocation, setDraftLocation] = useState(currentAddress);
  const [draftZone, setDraftZone] = useState(activeZone);
  const [checkingZone, setCheckingZone] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef(null);

  // Save new address form state
  const [newTag, setNewTag] = useState('Home');
  const [newLabel, setNewLabel] = useState('');
  const [isSavingAddr, setIsSavingAddr] = useState(false);

  // Active delivery zones for map overlay
  const [publicZones, setPublicZones] = useState([]);

  // Leaflet Dynamic Module
  const [MapModule, setMapModule] = useState(null);
  const mapRef = useRef(null);

  // Sync draft with current address when opening modal
  useEffect(() => {
    if (isOpen) {
      setDraftLocation(currentAddress);
      setDraftZone(activeZone);
      setSearchQuery('');
      setShowDropdown(false);
      setShowSavedAddressesView(false);
      setIsSavingAddr(false);
    }
  }, [isOpen, currentAddress, activeZone]);

  // Load public delivery zones for map polygons
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/delivery-zones/public')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.success && Array.isArray(data.data)) {
          setPublicZones(data.data);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Dynamically import Leaflet
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    if (typeof window !== 'undefined') {
      Promise.all([import('react-leaflet'), import('leaflet')]).then(
        ([{ MapContainer, TileLayer, Marker, Popup, Polygon, Tooltip, useMapEvents, useMap }, LModule]) => {
          if (!isMounted) return;
          const L = LModule.default || LModule;

          // Fix Leaflet marker icons
          delete L.Icon.Default.prototype._getIconUrl;
          L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
          });

          // Custom customer pin
          const customerPinIcon = L.divIcon({
            className: 'customer-pin',
            html: `<div style="
              background: #2563eb;
              color: #ffffff;
              width: 32px;
              height: 32px;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              border: 3px solid #ffffff;
              box-shadow: 0 4px 12px rgba(0,0,0,0.35);
              display: flex;
              align-items: center;
              justify-content: center;
            "><span style="transform: rotate(45deg); font-size: 14px;">📍</span></div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
          });

          // Click handler to re-pin location
          function MapClickHandler({ onMapClick }) {
            useMapEvents({
              click(e) {
                onMapClick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
              },
            });
            return null;
          }

          // Map pan setter
          function MapPanTo({ center }) {
            const map = useMap();
            useEffect(() => {
              if (center && center[0] && center[1]) {
                map.panTo(center, { animate: true });
              }
            }, [center, map]);
            return null;
          }

          setMapModule({
            MapContainer,
            TileLayer,
            Marker,
            Popup,
            Polygon,
            Tooltip,
            MapClickHandler,
            MapPanTo,
            customerPinIcon,
            L,
          });
        }
      );
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Evaluate zone serviceability whenever draft coordinates change
  const handleCoordsChange = useCallback(async (lat, lng, labelHint = null, addressHint = null) => {
    setCheckingZone(true);
    let resolvedLabel = labelHint;
    let resolvedAddress = addressHint;

    if (!resolvedAddress) {
      const geo = await reverseGeocodeCoords(lat, lng);
      resolvedLabel = resolvedLabel || geo.label;
      resolvedAddress = geo.address;
    }

    const newLoc = {
      label: resolvedLabel || 'Selected Location',
      address: resolvedAddress || `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`,
      lat,
      lng,
    };

    setDraftLocation(newLoc);

    // Call zone serviceability API with coordinates and location hints
    const zoneData = await checkZoneServiceability(lat, lng, newLoc);
    setDraftZone(zoneData);
    setCheckingZone(false);
  }, []);

  // Handle Search Input Debounce
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!val || val.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/geocode?query=${encodeURIComponent(val)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            setSearchResults(json.data);
            setShowDropdown(true);
          }
        }
      } catch (err) {
        console.warn('Geocode search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  // Select item from search dropdown
  const handleSelectSearchResult = (result) => {
    setShowDropdown(false);
    setSearchQuery(result.label);
    handleCoordsChange(Number(result.lat), Number(result.lng), result.name || result.city, result.label);
  };

  // GPS Auto-detect Click
  const handleDetectGPS = async () => {
    setCheckingZone(true);
    try {
      const detected = await detectGPSLocation();
      if (detected) {
        setDraftLocation(detected.address);
        setDraftZone(detected.zone);
      }
    } catch (err) {
      alert(err.message || 'Could not access GPS location.');
    } finally {
      setCheckingZone(false);
    }
  };

  // Pick a saved address
  const handleSelectSaved = (saved) => {
    handleCoordsChange(saved.lat, saved.lng, saved.label, saved.address);
    setShowSavedAddressesView(false);
  };

  // Delete a saved address from book
  const handleDeleteSaved = (e, addressId) => {
    e.stopPropagation();
    if (typeof window !== 'undefined' && window.confirm('Are you sure you want to remove this saved address?')) {
      removeAddress(addressId);
    }
  };

  // Check if home address is currently drafted
  const isHomeSelected =
    homeAddress &&
    draftLocation &&
    Math.abs(homeAddress.lat - draftLocation.lat) < 0.0002 &&
    Math.abs(homeAddress.lng - draftLocation.lng) < 0.0002;

  // Save current location to Address Book
  const handleSaveCurrentToBook = (e) => {
    e.preventDefault();
    if (!draftLocation) return;
    const finalLabel = newLabel.trim() || newTag;
    saveAddress({
      ...draftLocation,
      id: `saved-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      label: finalLabel,
      tag: newTag,
      isHome: newTag === 'Home',
    });
    setNewLabel('');
    setIsSavingAddr(false);
  };

  // Confirm Location Button Click
  const handleConfirmLocation = async () => {
    if (!draftLocation) return;
    await selectLocation(draftLocation);
    onClose();
  };

  if (!isOpen) return null;

  const isServiceable = draftZone?.serviceable;
  const primaryZone = draftZone?.primaryZone;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIcon}>📍</div>
            <div>
              <h3 className={styles.modalTitle}>Select Delivery Location</h3>
              <p className={styles.modalSubtitle}>
                Pinpoint your address to check delivery availability, charges, and speeds
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className={styles.closeBtn} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {showSavedAddressesView ? (
            /* DEDICATED VIEW: ALL SAVED ADDRESSES */
            <div className={styles.savedAddressesView}>
              <div className={styles.savedViewHeader}>
                <button
                  type="button"
                  onClick={() => setShowSavedAddressesView(false)}
                  className={styles.backToMapBtn}
                  id="btn-back-to-map"
                >
                  <span>←</span>
                  <span>Back to Map</span>
                </button>
                <div className={styles.savedViewTitleGroup}>
                  <h4 className={styles.savedViewTitle}>Your Saved Addresses</h4>
                  <span className={styles.savedViewCountBadge}>
                    {savedAddresses.length} saved
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSavedAddressesView(false);
                    setIsSavingAddr(true);
                  }}
                  className={styles.addNewAddrBtn}
                >
                  + Add Current Location
                </button>
              </div>

              {savedAddresses.length === 0 ? (
                <div className={styles.emptySavedState}>
                  <div className={styles.emptyIcon}>📍</div>
                  <p className={styles.emptyTitle}>No saved addresses found</p>
                  <p className={styles.emptySubtitle}>
                    Pin your location on the map and click "+ Save this location" to store it.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSavedAddressesView(false)}
                    className={styles.backToMapPrimaryBtn}
                  >
                    Pin on Map
                  </button>
                </div>
              ) : (
                <div className={styles.savedFullList}>
                  {savedAddresses.map((s) => {
                    const isSelected =
                      Math.abs(s.lat - draftLocation.lat) < 0.0002 &&
                      Math.abs(s.lng - draftLocation.lng) < 0.0002;
                    const isHome = s.isHome || s.tag?.toLowerCase() === 'home';
                    const isWork = s.tag?.toLowerCase() === 'work';

                    return (
                      <div
                        key={s.id}
                        className={`${styles.savedFullCard} ${
                          isSelected ? styles.savedFullCardActive : ''
                        }`}
                        onClick={() => handleSelectSaved(s)}
                      >
                        <div className={styles.savedFullLeftIcon}>
                          {isHome ? '🏠' : isWork ? '💼' : '📍'}
                        </div>
                        <div className={styles.savedFullInfo}>
                          <div className={styles.savedFullHeader}>
                            <strong className={styles.savedFullLabel}>{s.label}</strong>
                            <span
                              className={`${styles.savedFullTag} ${
                                isHome
                                  ? styles.tagHome
                                  : isWork
                                  ? styles.tagWork
                                  : styles.tagOther
                              }`}
                            >
                              {s.tag || (isHome ? 'Home' : 'Other')}
                            </span>
                            {isSelected && (
                              <span className={styles.selectedPillBadge}>✓ Active</span>
                            )}
                          </div>
                          <p className={styles.savedFullAddressText}>{s.address}</p>
                          <div className={styles.savedFullCoordinates}>
                            {s.city ? `${s.city} • ` : ''}Lat: {s.lat.toFixed(4)}, Lng: {s.lng.toFixed(4)}
                          </div>
                        </div>
                        <div className={styles.savedFullActions} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleSelectSaved(s)}
                            className={styles.selectAddressBtn}
                            title="Deliver to this location"
                          >
                            Deliver Here
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSaved(e, s.id)}
                            className={styles.deleteAddressBtn}
                            title="Remove this address"
                            aria-label="Delete address"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* STANDARD VIEW: SEARCH + ZONE BANNER + MAP + 1 HOME ADDRESS & "SAVED ADDRESSES" OPTION */
            <>
              {/* Controls: Search + GPS */}
              <div className={styles.controlsRow}>
                <div className={styles.searchWrapper}>
                  <span className={styles.searchIcon}>🔍</span>
                  <input
                    type="text"
                    placeholder="Search area, landmark or sector in Mohali / Chandigarh..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    className={styles.searchInput}
                  />
                  {/* Dropdown */}
                  {showDropdown && searchResults.length > 0 && (
                    <div className={styles.searchDropdown}>
                      {searchResults.map((r, i) => (
                        <div
                          key={`${r.lat}-${r.lng}-${i}`}
                          className={styles.searchItem}
                          onClick={() => handleSelectSearchResult(r)}
                        >
                          <span>📍</span>
                          <span>{r.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleDetectGPS}
                  disabled={checkingZone}
                  className={styles.gpsBtn}
                  title="Detect my location automatically"
                >
                  <span>🎯</span>
                  <span>{checkingZone ? 'Locating...' : 'Locate Me'}</span>
                </button>
              </div>

              {/* Serviceability & Delivery Zone Banner */}
              <div
                className={`${styles.zoneBanner} ${
                  checkingZone
                    ? styles.zoneBannerLoading
                    : isServiceable
                    ? styles.zoneBannerSuccess
                    : styles.zoneBannerWarning
                }`}
              >
                <div className={styles.zoneBannerIcon}>
                  {checkingZone ? '⏳' : isServiceable ? '⚡' : '⚠️'}
                </div>
                <div className={styles.zoneBannerContent}>
                  <div className={styles.zoneBannerTitle}>
                    {checkingZone ? (
                      <span>Checking delivery zone availability...</span>
                    ) : isServiceable && primaryZone ? (
                      <>
                        <span>Available for Express Delivery</span>
                        <span className={styles.zoneNameBadge}>{primaryZone.name}</span>
                      </>
                    ) : (
                      <span>Service Unreachable</span>
                    )}
                  </div>

                  {!checkingZone && (
                    <div className={styles.zoneBannerDetails}>
                      {isServiceable && primaryZone ? (
                        <>
                          <span className={styles.zoneBannerPill}>
                            ⏱️ {primaryZone.estimatedDeliveryTime || '30 mins'}
                          </span>
                          <span className={styles.zoneBannerPill}>
                            💵 Fee:{' '}
                            {Number(primaryZone.deliveryCharge) === 0
                              ? 'FREE'
                              : `₹${Number(primaryZone.deliveryCharge).toFixed(2)}`}
                          </span>
                          <span className={styles.zoneBannerPill}>
                            🛒 Min Order: ₹{Number(primaryZone.minOrderAmount || 0).toFixed(2)}
                          </span>
                        </>
                      ) : (
                        <span>
                          Service Unreachable: We currently deliver across Mohali, Chandigarh, and backend configured zones. Please choose an address inside our coverage boundary.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Interactive Map */}
              <div className={styles.mapContainer}>
                {MapModule ? (
                  <MapModule.MapContainer
                    center={[draftLocation.lat || 30.7046, draftLocation.lng || 76.7179]}
                    zoom={13}
                    minZoom={4}
                    maxZoom={18}
                    maxBounds={INDIA_BOUNDS}
                    maxBoundsViscosity={1.0}
                    attributionControl={false}
                    style={{ height: '100%', width: '100%' }}
                    whenCreated={(map) => {
                      mapRef.current = map;
                    }}
                  >
                    <MapModule.TileLayer
                      attribution=""
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* Overlaid Delivery Zones Polygons */}
                    {publicZones.map((z) => {
                      const ring = z.boundary?.coordinates?.[0];
                      if (!Array.isArray(ring) || ring.length < 3) return null;
                      const pts = ring.map(([lng, lat]) => [lat, lng]);

                      return (
                        <MapModule.Polygon
                          key={z._id}
                          positions={pts}
                          pathOptions={{
                            color: z.color || '#3b82f6',
                            fillColor: z.color || '#3b82f6',
                            fillOpacity: 0.18,
                            weight: 2,
                          }}
                        >
                          <MapModule.Tooltip sticky>
                            <span>
                              <strong>{z.name}</strong> • ⚡ {z.estimatedDeliveryTime} (₹{z.deliveryCharge})
                            </span>
                          </MapModule.Tooltip>
                        </MapModule.Polygon>
                      );
                    })}

                    {/* Customer Location Pin */}
                    <MapModule.Marker
                      position={[draftLocation.lat || 30.7046, draftLocation.lng || 76.7179]}
                      icon={MapModule.customerPinIcon}
                    >
                      <MapModule.Popup>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>
                          📍 {draftLocation.label || 'Your Location'}
                        </div>
                      </MapModule.Popup>
                    </MapModule.Marker>

                    <MapModule.MapClickHandler
                      onMapClick={(lat, lng) => handleCoordsChange(lat, lng)}
                    />
                    <MapModule.MapPanTo
                      center={[draftLocation.lat || 30.7046, draftLocation.lng || 76.7179]}
                    />
                  </MapModule.MapContainer>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: '#64748b',
                    }}
                  >
                    Loading interactive map...
                  </div>
                )}
                <div className={styles.mapInstructions}>
                  Click anywhere on the map to pin your doorstep
                </div>
              </div>

              {/* Saved Addresses Section */}
              <div className={styles.savedSection}>
                <div className={styles.sectionHeading}>
                  <div className={styles.sectionHeadingLeft}>
                    <span>Saved Delivery Addresses</span>
                  </div>
                  <div className={styles.sectionHeadingRight}>
                    <button
                      type="button"
                      onClick={() => setShowSavedAddressesView(true)}
                      className={styles.headerSavedBtn}
                      id="btn-saved-addresses-header"
                      title="View all your saved addresses"
                    >
                      <span>📑</span>
                      <span>Saved Addresses</span>
                      <span className={styles.savedCountPill}>{savedAddresses.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSavingAddr((prev) => !prev)}
                      className={styles.headerSaveLocBtn}
                    >
                      {isSavingAddr ? '✕ Cancel' : '+ Save this location'}
                    </button>
                  </div>
                </div>

                {/* Quick-Save current location form */}
                {isSavingAddr && (
                  <form onSubmit={handleSaveCurrentToBook} className={styles.saveNewAddressRow}>
                    <select
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      className={styles.tagSelect}
                    >
                      <option value="Home">Home</option>
                      <option value="Work">Work</option>
                      <option value="Other">Other</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Address Nickname (e.g. My Apartment, Office)"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      className={styles.labelInput}
                    />
                    <button type="submit" className={styles.saveBtnSmall}>
                      Save to Book
                    </button>
                  </form>
                )}

                {/* Grid: 1. Just ONE saved Home address + 2. Option named "Saved Addresses" */}
                <div className={styles.homeAndSavedGrid}>
                  {/* ONE SAVED HOME ADDRESS CARD */}
                  {homeAddress ? (
                    <button
                      type="button"
                      onClick={() => handleSelectSaved(homeAddress)}
                      className={`${styles.homeAddressCard} ${
                        isHomeSelected ? styles.homeAddressCardActive : ''
                      }`}
                      title="Click to select your saved Home address"
                      id="card-saved-home-address"
                    >
                      <div className={styles.homeCardTop}>
                        <div className={styles.homeCardIconGroup}>
                          <span className={styles.homeEmoji}>🏠</span>
                          <div className={styles.homeNameRow}>
                            <strong className={styles.homeLabelText}>
                              {homeAddress.label || 'Home'}
                            </strong>
                            <span className={styles.homeTagPill}>HOME</span>
                          </div>
                        </div>
                        {isHomeSelected ? (
                          <span className={styles.homeSelectedBadge}>✓ Selected</span>
                        ) : (
                          <span className={styles.homeDeliverHerePrompt}>Deliver Here ➔</span>
                        )}
                      </div>
                      <p className={styles.homeAddressDetails}>{homeAddress.address}</p>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setNewTag('Home');
                        setNewLabel('Home');
                        setIsSavingAddr(true);
                      }}
                      className={styles.emptyHomePromptCard}
                    >
                      <span className={styles.homeEmoji}>🏠</span>
                      <div className={styles.emptyHomeText}>
                        <strong>Save Current Address as Home</strong>
                        <span>Pin your home on map and click to save</span>
                      </div>
                      <span className={styles.plusAction}>+</span>
                    </button>
                  )}

                  {/* OPTION NAMED "SAVED ADDRESSES" */}
                  <button
                    type="button"
                    onClick={() => setShowSavedAddressesView(true)}
                    className={styles.savedAddressesTriggerCard}
                    id="btn-saved-addresses-card"
                    title="View all your saved addresses"
                  >
                    <div className={styles.triggerCardTop}>
                      <div className={styles.triggerIconGroup}>
                        <div className={styles.triggerEmojiWrap}>
                          <span className={styles.triggerEmoji}>📑</span>
                        </div>
                        <div>
                          <strong className={styles.triggerTitle}>Saved Addresses</strong>
                          <span className={styles.triggerSubtitle}>
                            {savedAddresses.length} saved location{savedAddresses.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                      <span className={styles.triggerViewBadge}>View All ➔</span>
                    </div>
                    <p className={styles.triggerDescription}>
                      Click to view, select, or manage all your saved delivery addresses.
                    </p>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <div className={styles.footerAddressPreview}>
            <strong>📍 {draftLocation.label || 'Selected'}:</strong> {draftLocation.address}
          </div>
          <button
            type="button"
            onClick={handleConfirmLocation}
            className={styles.confirmBtn}
            id="btn-deliver-here-confirm"
          >
            <span>Deliver Here</span>
            <span>➔</span>
          </button>
        </div>
      </div>
    </div>
  );
}
