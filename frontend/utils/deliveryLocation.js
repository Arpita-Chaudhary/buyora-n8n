'use client';

import { useState, useEffect, useCallback } from 'react';

const CURRENT_ADDR_KEY = 'customer_delivery_address';
const SAVED_ADDRS_KEY = 'customer_saved_addresses';
const ZONE_CACHE_KEY = 'customer_delivery_zone';
const LOCATION_EVENT_NAME = 'customer_location_updated';

// Default initial location: Phase 3B2, Mohali (inside Mohali Central Express Zone)
export const DEFAULT_LOCATION = {
  id: 'default-mohali',
  label: 'Phase 7, Mohali',
  address: 'Phase 7, Sector 60, SAS Nagar, Mohali, Punjab 160059',
  city: 'Mohali',
  state: 'Punjab',
  lat: 30.7046,
  lng: 76.7179,
  isDefault: true,
};

// Initial clean saved addresses - user's own home address
export const INITIAL_SAVED_ADDRESSES = [
  {
    id: 'saved-home-default',
    label: '2854,Phase7, Mohali',
    tag: 'Home',
    address: 'House #2854, Phase 7, SAS Nagar, Mohali, Punjab 160062',
    city: 'Mohali',
    state: 'Punjab',
    lat: 30.7180,
    lng: 76.7120,
    isHome: true,
  },
];

/**
 * Get current delivery address from localStorage safely
 */
export function getCurrentDeliveryAddress() {
  if (typeof window === 'undefined') return DEFAULT_LOCATION;
  try {
    const raw = localStorage.getItem(CURRENT_ADDR_KEY);
    if (!raw) return DEFAULT_LOCATION;
    const parsed = JSON.parse(raw);
    return parsed && parsed.lat && parsed.lng ? parsed : DEFAULT_LOCATION;
  } catch (e) {
    return DEFAULT_LOCATION;
  }
}

/**
 * Get saved addresses from localStorage safely with dummy mock address cleanup
 */
export function getSavedDeliveryAddresses() {
  if (typeof window === 'undefined') return INITIAL_SAVED_ADDRESSES;
  try {
    const raw = localStorage.getItem(SAVED_ADDRS_KEY);
    if (!raw) return INITIAL_SAVED_ADDRESSES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return INITIAL_SAVED_ADDRESSES;

    // Filter out mock dummy sample addresses ('Company', 'Work', 'Airport Road', 'saved-work-1', 'saved-aerocity-1')
    // so user's real saved addresses are kept clean and never mixed up with others
    const cleaned = parsed.filter((item) => {
      if (!item) return false;
      const isMockWork = item.id === 'saved-work-1' || (item.label === 'Work' && item.address?.includes('Industrial Area Phase 8B'));
      const isMockAirport = item.id === 'saved-aerocity-1' || (item.label === 'Airport Road' && item.address?.includes('Aerocity'));
      const isMockCompany = item.label === 'Company' && item.address?.includes('House #142');
      return !isMockWork && !isMockAirport && !isMockCompany;
    });

    if (cleaned.length === 0) {
      return INITIAL_SAVED_ADDRESSES;
    }

    // Persist cleaned version if mock addresses were stripped
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(SAVED_ADDRS_KEY, JSON.stringify(cleaned));
    }

    return cleaned;
  } catch (e) {
    return INITIAL_SAVED_ADDRESSES;
  }
}

/**
 * Retrieve the single saved Home address for the user
 */
export function getSavedHomeAddress(addresses = null) {
  const list = addresses || getSavedDeliveryAddresses();
  if (!Array.isArray(list) || list.length === 0) return null;
  const home = list.find(
    (a) => a.isHome || (a.tag && a.tag.toLowerCase() === 'home') || (a.label && a.label.toLowerCase().includes('home'))
  );
  return home || list[0] || null;
}

/**
 * Get cached zone info from localStorage
 */
export function getCachedDeliveryZone() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ZONE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Query backend /api/delivery-zones/check-serviceability
 */
export async function checkZoneServiceability(lat, lng, addressInfo = {}) {
  try {
    const res = await fetch('/api/delivery-zones/check-serviceability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: Number(lat),
        longitude: Number(lng),
        address: addressInfo?.address || addressInfo?.label || '',
        label: addressInfo?.label || '',
        city: addressInfo?.city || '',
      }),
    });

    if (!res.ok) {
      throw new Error(`Serviceability check failed (${res.status})`);
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('[DELIVERY ZONE CHECK]', err.message);
    return {
      success: false,
      serviceable: false,
      message: 'Could not connect to delivery zone service.',
    };
  }
}

/**
 * Save new active delivery location, check zone, and broadcast change
 */
export async function setCurrentDeliveryLocation(newLocation) {
  if (typeof window === 'undefined' || !newLocation) return null;

  const sanitized = {
    ...newLocation,
    lat: Number(Number(newLocation.lat).toFixed(6)),
    lng: Number(Number(newLocation.lng).toFixed(6)),
  };

  try {
    localStorage.setItem(CURRENT_ADDR_KEY, JSON.stringify(sanitized));
  } catch (e) {
    // Ignore storage quota
  }

  // Detect zone serviceability for the new coordinates
  const zoneResult = await checkZoneServiceability(sanitized.lat, sanitized.lng, sanitized);

  try {
    localStorage.setItem(ZONE_CACHE_KEY, JSON.stringify(zoneResult));
  } catch (e) {
    // Ignore
  }

  // Broadcast event across application
  window.dispatchEvent(
    new CustomEvent(LOCATION_EVENT_NAME, {
      detail: { address: sanitized, zone: zoneResult },
    })
  );

  return { address: sanitized, zone: zoneResult };
}

/**
 * Save an address to customer's saved address book without destroying previous saved addresses
 */
export function saveAddressToBook(newAddr) {
  if (typeof window === 'undefined' || !newAddr) return;
  const current = getSavedDeliveryAddresses();
  const isHome = Boolean(
    newAddr.isHome ||
    newAddr.tag?.toLowerCase() === 'home' ||
    newAddr.label?.toLowerCase() === 'home'
  );

  const addressItem = {
    id: newAddr.id || `saved-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    label: newAddr.label || (isHome ? 'Home' : 'Saved Place'),
    tag: isHome ? 'Home' : (newAddr.tag || 'Other'),
    address: newAddr.address || `${newAddr.lat}, ${newAddr.lng}`,
    city: newAddr.city || '',
    state: newAddr.state || '',
    lat: Number(Number(newAddr.lat).toFixed(6)),
    lng: Number(Number(newAddr.lng).toFixed(6)),
    isHome,
    createdAt: newAddr.createdAt || Date.now(),
  };

  // We NEVER destroy or delete previous saved addresses!
  // If an address with the exact same ID already exists, update it in place.
  // Otherwise, prepend this new address so both previous and new addresses are preserved!
  const existingIndex = current.findIndex((a) => a.id === addressItem.id);
  let updated;

  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = { ...current[existingIndex], ...addressItem };
  } else {
    // Add the new address to the front without removing any existing ones
    updated = [addressItem, ...current];
  }

  // If this address is tagged as Home, mark it as primary Home,
  // while keeping previous home addresses safe in the saved addresses list!
  if (isHome) {
    updated = updated.map((addr) => {
      if (addr.id === addressItem.id) {
        return { ...addr, isHome: true };
      }
      return { ...addr, isHome: false };
    });
  }

  try {
    localStorage.setItem(SAVED_ADDRS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(LOCATION_EVENT_NAME, { detail: { savedOnly: true } }));
  } catch (e) {
    // Ignore
  }

  return updated;
}

/**
 * Delete an address from saved address book
 */
export function removeSavedAddressFromBook(addressId) {
  if (typeof window === 'undefined') return;
  const current = getSavedDeliveryAddresses();
  const updated = current.filter((a) => a.id !== addressId);
  try {
    localStorage.setItem(SAVED_ADDRS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(LOCATION_EVENT_NAME, { detail: { savedOnly: true } }));
  } catch (e) {
    // Ignore
  }
  return updated;
}

/**
 * Reverse geocode GPS coordinate to a readable street/area address
 */
export async function reverseGeocodeCoords(lat, lng) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        const p = data.features[0].properties || {};
        const parts = [
          p.name,
          p.street ? `${p.housenumber || ''} ${p.street}`.trim() : null,
          p.district,
          p.city || p.town || p.village,
          p.state,
          p.postcode,
        ].filter(Boolean);
        const unique = parts.filter((item, idx, arr) => arr.indexOf(item) === idx).join(', ');
        return {
          label: p.name || p.district || p.city || 'Pinpointed Location',
          address: unique || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          city: p.city || p.town || p.district || '',
          state: p.state || '',
        };
      }
    }
  } catch (e) {
    // Fallback
  }
  return {
    label: 'Pinpointed Location',
    address: `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`,
    city: '',
    state: '',
  };
}

/**
 * React Hook: useDeliveryLocation
 * Provides active delivery location, detected delivery zone, saved addresses, and actions
 */
export function useDeliveryLocation() {
  const [address, setAddress] = useState(DEFAULT_LOCATION);
  const [savedAddresses, setSavedAddresses] = useState(INITIAL_SAVED_ADDRESSES);
  const [zone, setZone] = useState(null);
  const [loading, setLoading] = useState(true);

  const syncState = useCallback(async () => {
    const currentAddr = getCurrentDeliveryAddress();
    const addrs = getSavedDeliveryAddresses();
    setAddress(currentAddr);
    setSavedAddresses(addrs);

    // Check cached zone first, or perform fresh check
    let currentZone = getCachedDeliveryZone();
    if (!currentZone && currentAddr?.lat && currentAddr?.lng) {
      setLoading(true);
      currentZone = await checkZoneServiceability(currentAddr.lat, currentAddr.lng);
      try {
        localStorage.setItem(ZONE_CACHE_KEY, JSON.stringify(currentZone));
      } catch (e) { }
    }
    setZone(currentZone);
    setLoading(false);
  }, []);

  useEffect(() => {
    syncState();

    const handleUpdate = () => {
      syncState();
    };

    window.addEventListener(LOCATION_EVENT_NAME, handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener(LOCATION_EVENT_NAME, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [syncState]);

  // Set new address and re-verify zone
  const selectLocation = useCallback(async (newLoc) => {
    setLoading(true);
    const result = await setCurrentDeliveryLocation(newLoc);
    if (result) {
      setAddress(result.address);
      setZone(result.zone);
    }
    setLoading(false);
    return result;
  }, []);

  // Save new address into book
  const saveAddress = useCallback((addr) => {
    const updated = saveAddressToBook(addr);
    if (updated) setSavedAddresses(updated);
  }, []);

  // Remove saved address
  const removeAddress = useCallback((id) => {
    const updated = removeSavedAddressFromBook(id);
    if (updated) setSavedAddresses(updated);
  }, []);

  // Request browser GPS
  const detectGPSLocation = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.geolocation) {
      throw new Error('Geolocation is not supported by your browser.');
    }

    setLoading(true);
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const lat = Number(position.coords.latitude.toFixed(6));
            const lng = Number(position.coords.longitude.toFixed(6));
            const geoInfo = await reverseGeocodeCoords(lat, lng);
            const newLoc = {
              id: `gps-${Date.now()}`,
              label: geoInfo.label || 'Current Location',
              address: geoInfo.address,
              city: geoInfo.city,
              state: geoInfo.state,
              lat,
              lng,
            };
            const result = await setCurrentDeliveryLocation(newLoc);
            setAddress(result.address);
            setZone(result.zone);
            setLoading(false);
            resolve(result);
          } catch (err) {
            setLoading(false);
            reject(err);
          }
        },
        (error) => {
          setLoading(false);
          let msg = 'Unable to retrieve your location.';
          if (error.code === 1) msg = 'Location access was denied. Please enable location permissions.';
          else if (error.code === 2) msg = 'Location unavailable. Please select your address on the map.';
          else if (error.code === 3) msg = 'Location request timed out.';
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }, []);

  const homeAddress = getSavedHomeAddress(savedAddresses);

  return {
    address,
    savedAddresses,
    homeAddress,
    zone,
    loading,
    selectLocation,
    saveAddress,
    removeAddress,
    detectGPSLocation,
    refreshLocation: syncState,
  };
}
