'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Bounding box for India [South-West, North-East]
const INDIA_BOUNDS = [
  [6.5546, 68.1113],
  [35.6745, 97.3956],
];

export default function LocationPicker({
  value,
  onChange,
  defaultCenter = [30.7046, 76.7179], // Mohali center
  height = '320px',
  placeholderText = 'Click anywhere on the map or search an area to select a location.',
  products = [],
  selectedProductId = null,
  onProductMarkerClick,
  onViewProduct,
  showSearchBar = true,
}) {
  const [MapModule, setMapModule] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [locationName, setLocationName] = useState('');

  // Search Bar state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [isLocatingUser, setIsLocatingUser] = useState(false);

  const searchContainerRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Dynamically load Leaflet and React-Leaflet in browser only
  useEffect(() => {
    let isMounted = true;

    if (typeof window !== 'undefined') {
      Promise.all([
        import('react-leaflet'),
        import('leaflet'),
      ])
        .then(([{ MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap }, LModule]) => {
          if (!isMounted) return;

          const L = LModule.default || LModule;

          // Fix Leaflet's default marker icons in Next.js
          delete L.Icon.Default.prototype._getIconUrl;
          L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
          });

          // Custom product icons for default and highlighted states
          const defaultProductIcon = L.divIcon({
            className: 'prod-marker-default',
            html: `<div style="background-color: #2563eb; color: white; width: 30px; height: 30px; border-radius: 50%; border: 2.5px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; transition: transform 0.2s;">🛍️</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15],
          });

          const activeProductIcon = L.divIcon({
            className: 'prod-marker-active',
            html: `<div style="background-color: #dc2626; color: white; width: 38px; height: 38px; border-radius: 50%; border: 3px solid #fef08a; box-shadow: 0 0 14px rgba(220,38,38,0.8), 0 2px 8px rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; transform: scale(1.12); transition: all 0.2s;">⭐</div>`,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
            popupAnchor: [0, -19],
          });

          // Helper to handle clicks on the map
          function ClickHandler({ onSelect }) {
            useMapEvents({
              click(e) {
                onSelect({
                  lat: Number(e.latlng.lat.toFixed(6)),
                  lng: Number(e.latlng.lng.toFixed(6)),
                });
              },
            });
            return null;
          }

          // Smoothly fly to location when changed
          function FlyToLocationHandler({ targetLoc }) {
            const map = useMap();
            useEffect(() => {
              if (targetLoc && targetLoc.lat && targetLoc.lng) {
                map.flyTo([targetLoc.lat, targetLoc.lng], Math.max(map.getZoom() || 13, 14), {
                  animate: true,
                  duration: 1.0,
                });
              }
            }, [targetLoc, map]);
            return null;
          }

          // Helper to re-center or fit bounds to include products and location
          function FitBoundsHandler({ prods, center }) {
            const map = useMap();
            useEffect(() => {
              if (Array.isArray(prods) && prods.length > 0) {
                const points = [];
                if (center && center.lat && center.lng) {
                  points.push([center.lat, center.lng]);
                }
                prods.forEach((p) => {
                  if (
                    p &&
                    p.location &&
                    Array.isArray(p.location.coordinates) &&
                    p.location.coordinates.length >= 2
                  ) {
                    const pLng = Number(p.location.coordinates[0]);
                    const pLat = Number(p.location.coordinates[1]);
                    if (!isNaN(pLat) && !isNaN(pLng)) {
                      points.push([pLat, pLng]);
                    }
                  }
                });

                if (points.length > 1) {
                  map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
                } else if (points.length === 1) {
                  map.setView(points[0], 13);
                }
              }
            }, [prods, center, map]);
            return null;
          }

          // Helper to highlight and open popup of the selected product marker
          function ActiveMarkerHandler({ activeId, refs }) {
            const map = useMap();
            useEffect(() => {
              if (activeId && refs.current && refs.current[activeId]) {
                const marker = refs.current[activeId];
                if (marker && marker.openPopup) {
                  marker.openPopup();
                }
                if (marker && marker.getLatLng) {
                  const latlng = marker.getLatLng();
                  map.panTo(latlng, { animate: true, duration: 0.5 });
                }
              }
            }, [activeId, map, refs]);
            return null;
          }

          function MapView({ loc, defCenter, onLocSelect, prods, selectedId, onMarkerClick, onProdClick, locName }) {
            const centerPos = loc ? [loc.lat, loc.lng] : defCenter;
            const markerRefs = React.useRef({});

            return (
              <MapContainer
                center={centerPos}
                zoom={13}
                minZoom={4}
                maxZoom={18}
                maxBounds={INDIA_BOUNDS}
                maxBoundsViscosity={1.0}
                attributionControl={false}
                scrollWheelZoom={true}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution=""
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ClickHandler onSelect={onLocSelect} />
                <FlyToLocationHandler targetLoc={loc} />
                <FitBoundsHandler prods={prods} center={loc} />
                <ActiveMarkerHandler activeId={selectedId} refs={markerRefs} />

                {/* Customer / Selected Location Marker */}
                {loc && (
                  <Marker position={[loc.lat, loc.lng]}>
                    <Popup>
                      <div style={{ padding: '4px 2px', textAlign: 'center', minWidth: '130px' }}>
                        <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block' }}>
                          📍 Selected Location
                        </strong>
                        {locName && (
                          <div style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600, marginTop: '2px', wordBreak: 'break-word' }}>
                            {locName}
                          </div>
                        )}
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                          {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* Returned Nearby Product Markers */}
                {Array.isArray(prods) &&
                  prods.map((product) => {
                    if (
                      !product ||
                      !product.location ||
                      !Array.isArray(product.location.coordinates) ||
                      product.location.coordinates.length < 2
                    ) {
                      return null;
                    }

                    // GeoJSON format: coordinates[0] = longitude, coordinates[1] = latitude
                    // Leaflet requires: [latitude, longitude]
                    const longitude = Number(product.location.coordinates[0]);
                    const latitude = Number(product.location.coordinates[1]);

                    if (isNaN(latitude) || isNaN(longitude)) return null;

                    const isSelected = selectedId && String(selectedId) === String(product._id);

                    return (
                      <Marker
                        key={product._id || `${latitude}-${longitude}`}
                        position={[latitude, longitude]}
                        icon={isSelected ? activeProductIcon : defaultProductIcon}
                        ref={(ref) => {
                          if (ref) markerRefs.current[product._id] = ref;
                        }}
                        eventHandlers={{
                          click: () => {
                            if (onMarkerClick) {
                              onMarkerClick(product);
                            }
                          },
                        }}
                      >
                        <Popup>
                          <div style={{ minWidth: '170px', padding: '4px 2px', fontFamily: 'inherit' }}>
                            {product.image && (
                              <div style={{ width: '100%', height: '85px', borderRadius: '6px', overflow: 'hidden', marginBottom: '6px', background: '#f1f5f9' }}>
                                <img
                                  src={product.image}
                                  alt={product.title}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                            )}
                            <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>
                              {product.title}
                            </h4>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#2563eb', marginBottom: '2px' }}>
                              ₹{product.price}
                            </div>
                            {product.distanceKm !== undefined && (
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#059669', marginBottom: '8px' }}>
                                {product.distanceKm} km away
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onProdClick) {
                                  onProdClick(product);
                                } else if (product._id) {
                                  window.location.href = `/products/${product._id}`;
                                }
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 12px',
                                background: '#2563eb',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                textAlign: 'center',
                                transition: 'background-color 0.15s ease',
                              }}
                            >
                              View Product
                            </button>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
              </MapContainer>
            );
          }

          setMapModule(() => MapView);
        })
        .catch((err) => {
          console.error('Failed to load map components:', err);
        });
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Parse incoming value prop
  useEffect(() => {
    if (!value) {
      setSelectedLocation(null);
      return;
    }

    if (value.lat !== undefined && value.lng !== undefined) {
      setSelectedLocation({
        lat: Number(value.lat),
        lng: Number(value.lng),
      });
      if (value.displayName) {
        setLocationName(value.displayName);
      }
    } else if (value.latitude !== undefined && value.longitude !== undefined) {
      setSelectedLocation({
        lat: Number(value.latitude),
        lng: Number(value.longitude),
      });
    } else if (
      value.coordinates &&
      Array.isArray(value.coordinates) &&
      value.coordinates.length === 2
    ) {
      // GeoJSON stores [longitude, latitude]
      setSelectedLocation({
        lat: Number(value.coordinates[1]),
        lng: Number(value.coordinates[0]),
      });
    }
  }, [value]);

  const handleLocationSelect = useCallback((loc, name = '') => {
    setSelectedLocation(loc);
    if (name) {
      setLocationName(name);
    }
    if (onChange && typeof onChange === 'function') {
      onChange(loc);
    }
  }, [onChange]);

  // Geocoding Search function with fallback
  const performGeocodeSearch = async (text) => {
    const q = text.trim();
    if (!q || q.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      // 1. Try internal backend API endpoint first
      let results = [];
      try {
        const res = await fetch(`/api/products/geocode?query=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            results = json.data;
          }
        }
      } catch (err) {
        console.warn('Internal geocode route failed, trying direct Photon API fallback...', err);
      }

      // 2. Direct Photon fallback if internal route returned no results
      if (!results || results.length === 0) {
        const fallbackRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=68.1113,6.5546,97.3956,35.6745&limit=6`);
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          if (fallbackData && Array.isArray(fallbackData.features)) {
            results = fallbackData.features
              .filter((f) => f && f.geometry && Array.isArray(f.geometry.coordinates))
              .map((f) => {
                const p = f.properties || {};
                const c = f.geometry.coordinates;
                const label = [p.name, p.district, p.city || p.town || p.county, p.state, p.country]
                  .filter(Boolean)
                  .filter((item, idx, arr) => arr.indexOf(item) === idx)
                  .join(', ');
                return {
                  label: label || p.name || 'Unknown Location',
                  name: p.name || '',
                  city: p.city || p.district || '',
                  state: p.state || '',
                  country: p.country || '',
                  lat: Number(c[1]),
                  lng: Number(c[0]),
                };
              });
          }
        }
      }

      setSearchResults(results);
      setShowDropdown(true);
      if (results.length === 0) {
        setSearchError('No places found. Try searching by city, sector, or landmark.');
      }
    } catch (err) {
      setSearchError('Failed to search locations. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  // Handle Search Input Change with Debounce
  const handleInputChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setSearchError(null);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (val.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performGeocodeSearch(val);
      }, 350);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
    }
  };

  // Handle Search Result Selection
  const handleSelectResult = (item) => {
    setSearchQuery(item.label);
    setLocationName(item.label);
    setShowDropdown(false);
    setSearchError(null);

    const newLoc = {
      lat: Number(item.lat.toFixed(6)),
      lng: Number(item.lng.toFixed(6)),
      displayName: item.label,
    };

    handleLocationSelect(newLoc, item.label);
  };

  // Handle Form Submit (pressing Enter or Search button)
  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    if (searchResults.length > 0) {
      handleSelectResult(searchResults[0]);
    } else if (searchQuery.trim().length >= 2) {
      performGeocodeSearch(searchQuery);
    }
  };

  // Handle Clear Search
  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
    setSearchError(null);
  };

  // Handle Use Current Location (GPS)
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setSearchError('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocatingUser(true);
    setSearchError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocatingUser(false);
        const loc = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        setSearchQuery('Current Location');
        setLocationName('Your Current GPS Location');
        handleLocationSelect(loc, 'Your Current GPS Location');
      },
      (err) => {
        setIsLocatingUser(false);
        setSearchError('Unable to retrieve current location. Please allow location permissions.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="w-full flex flex-col space-y-2">
      {/* Area Search Bar */}
      {showSearchBar && (
        <div ref={searchContainerRef} className="relative z-30 w-full">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5 w-full">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              <input
                type="text"
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={() => {
                  if (searchResults.length > 0) setShowDropdown(true);
                }}
                placeholder="Search area, city, sector, landmark (e.g. Sector 62 Mohali)..."
                className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
              />

              {/* Clear button or searching spinner */}
              <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center">
                {isSearching ? (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                ) : searchQuery ? (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                    title="Clear search"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>

            {/* Search Action Button */}
            <button
              type="submit"
              disabled={isSearching}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-1.5 shrink-0"
              title="Search this area"
            >
              <span>Search</span>
            </button>

            {/* Use Current GPS Location Button */}
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={isLocatingUser}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 shrink-0"
              title="Locate my position (GPS)"
            >
              {isLocatingUser ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>📍 GPS</span>
              )}
            </button>
          </form>

          {/* Autocomplete Suggestions Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden max-h-60 overflow-y-auto z-50">
              <div className="p-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500 px-3 border-b border-slate-100 dark:border-slate-800">
                Suggested Areas & Places (Click to point map)
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {searchResults.map((item, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => handleSelectResult(item)}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 dark:hover:bg-slate-800/80 transition-colors flex items-start gap-2.5 group"
                    >
                      <span className="text-base text-blue-500 group-hover:scale-110 transition-transform mt-0.5">
                        📍
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {item.name || item.label.split(',')[0]}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {item.label}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0 self-center">
                        {item.lat.toFixed(2)}, {item.lng.toFixed(2)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Search Error Notice */}
          {searchError && (
            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 pl-1 flex items-center gap-1">
              <span>⚠️</span>
              <span>{searchError}</span>
            </div>
          )}
        </div>
      )}

      {/* Map Container */}
      <div
        className="w-full rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 shadow-sm relative z-0"
        style={{ height }}
      >
        {MapModule ? (
          <MapModule
            loc={selectedLocation}
            defCenter={defaultCenter}
            onLocSelect={handleLocationSelect}
            prods={products}
            selectedId={selectedProductId}
            onMarkerClick={onProductMarkerClick}
            onProdClick={onViewProduct}
            locName={locationName}
          />
        ) : (
          <div className="w-full h-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm text-slate-500 animate-pulse">
            <span>Loading interactive map...</span>
          </div>
        )}
      </div>

      {/* Selected Coordinates & Area Name Display Below Map */}
      <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-2 text-xs">
        {selectedLocation ? (
          <>
            <div className="flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                Selected Location:
              </span>
              {locationName && (
                <span className="text-blue-600 dark:text-blue-400 font-medium max-w-[240px] truncate" title={locationName}>
                  ({locationName})
                </span>
              )}
            </div>
            <div className="flex items-center space-x-4 text-slate-600 dark:text-slate-300 font-mono">
              <span>
                <strong>Lat:</strong> {selectedLocation.lat.toFixed(6)}
              </span>
              <span>
                <strong>Lng:</strong> {selectedLocation.lng.toFixed(6)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center space-x-2 text-slate-500 dark:text-slate-400">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            <span>{placeholderText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
