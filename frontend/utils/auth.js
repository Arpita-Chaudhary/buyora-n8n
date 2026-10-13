'use client';

import { useState, useEffect, useCallback } from 'react';

export const AUTH_STORAGE_CUSTOMER_TOKEN = 'customer_token';
export const AUTH_STORAGE_CUSTOMER_USER = 'customer_user';
export const AUTH_STORAGE_ADMIN_TOKEN = 'admin_token';
export const AUTH_STORAGE_ADMIN_USER = 'admin_user';
export const AUTH_STORAGE_LEGACY_TOKEN = 'token';
export const AUTH_EVENT_NAME = 'customer_auth_changed';

/**
 * Retrieve stored customer auth session from localStorage safely.
 * Isolates customer session so it is never overwritten by admin/system logins.
 */
export function getStoredAuth() {
  if (typeof window === 'undefined') {
    return { token: null, user: null, isAuthenticated: false };
  }
  try {
    // 0. If currently browsing an Admin route (/dashboard/admin or /admin), prioritize Admin session
    const currentPath = typeof window !== 'undefined' ? (window.location?.pathname || '') : '';
    const isAdminRoute = currentPath.startsWith('/dashboard/admin') || currentPath.startsWith('/admin');

    if (isAdminRoute) {
      const adminToken = localStorage.getItem(AUTH_STORAGE_ADMIN_TOKEN);
      const adminUserRaw = localStorage.getItem(AUTH_STORAGE_ADMIN_USER);
      if (adminToken) {
        const user = adminUserRaw ? JSON.parse(adminUserRaw) : null;
        return {
          token: adminToken,
          user,
          isAuthenticated: true,
        };
      }
    }

    // 1. Check primary customer session first
    let token = localStorage.getItem(AUTH_STORAGE_CUSTOMER_TOKEN);
    let userRaw = localStorage.getItem(AUTH_STORAGE_CUSTOMER_USER);

    // 2. Check legacy customer keys if customer keys are not set
    if (!token) {
      const legacyToken = localStorage.getItem(AUTH_STORAGE_LEGACY_TOKEN);
      const legacyUser = localStorage.getItem(AUTH_STORAGE_LEGACY_USER);
      if (legacyToken && legacyUser) {
        try {
          const parsed = JSON.parse(legacyUser);
          if (parsed.role !== 'ADMIN') {
            token = legacyToken;
            userRaw = legacyUser;
          }
        } catch (e) {}
      }
    }

    // 3. Fallback to admin session if no customer session exists
    if (!token) {
      const adminToken = localStorage.getItem(AUTH_STORAGE_ADMIN_TOKEN);
      const adminUserRaw = localStorage.getItem(AUTH_STORAGE_ADMIN_USER);
      if (adminToken && adminUserRaw) {
        token = adminToken;
        userRaw = adminUserRaw;
      }
    }

    const user = userRaw ? JSON.parse(userRaw) : null;
    return {
      token,
      user,
      isAuthenticated: Boolean(token),
    };
  } catch (err) {
    console.error('Error reading auth state:', err);
    return { token: null, user: null, isAuthenticated: false };
  }
}

/**
 * Set stored auth session into localStorage and broadcast change.
 * Intelligently separates ADMIN credentials from CUSTOMER credentials.
 */
export function setStoredAuth(token, user) {
  if (typeof window === 'undefined') return;
  try {
    const isAdmin = (user?.role || '').toUpperCase() === 'ADMIN';

    if (isAdmin) {
      if (token) localStorage.setItem(AUTH_STORAGE_ADMIN_TOKEN, token);
      if (user) localStorage.setItem(AUTH_STORAGE_ADMIN_USER, JSON.stringify(user));
      // Do NOT overwrite customer_user or customer_token so customer view is preserved!
    } else {
      if (token) {
        localStorage.setItem(AUTH_STORAGE_CUSTOMER_TOKEN, token);
        localStorage.setItem(AUTH_STORAGE_LEGACY_TOKEN, token);
      }
      if (user) {
        localStorage.setItem(AUTH_STORAGE_CUSTOMER_USER, JSON.stringify(user));
        localStorage.setItem(AUTH_STORAGE_LEGACY_USER, JSON.stringify(user));
      }
      window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME, { detail: { token, user } }));
    }
  } catch (err) {
    console.error('Error storing auth session:', err);
  }
}

/**
 * Clear customer auth session and notify all components.
 * Does NOT clear admin panel session so admin dashboard remains logged in.
 */
export function clearStoredAuth() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_STORAGE_CUSTOMER_TOKEN);
    localStorage.removeItem(AUTH_STORAGE_CUSTOMER_USER);
    localStorage.removeItem(AUTH_STORAGE_LEGACY_TOKEN);
    localStorage.removeItem(AUTH_STORAGE_LEGACY_USER);
    window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME, { detail: { token: null, user: null } }));
  } catch (err) {
    console.error('Error clearing auth session:', err);
  }
}

/**
 * Custom React hook for live customer authentication state.
 */
export function useCustomerAuth() {
  const [authState, setAuthState] = useState({
    token: null,
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const syncAuth = useCallback(() => {
    const stored = getStoredAuth();
    setAuthState({
      token: stored.token,
      user: stored.user,
      isAuthenticated: stored.isAuthenticated,
      isLoading: false,
    });
  }, []);

  useEffect(() => {
    syncAuth();

    const handleAuthEvent = () => syncAuth();
    window.addEventListener(AUTH_EVENT_NAME, handleAuthEvent);
    window.addEventListener('storage', handleAuthEvent);

    return () => {
      window.removeEventListener(AUTH_EVENT_NAME, handleAuthEvent);
      window.removeEventListener('storage', handleAuthEvent);
    };
  }, [syncAuth]);

  const logout = useCallback(() => {
    clearStoredAuth();
    setAuthState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  return {
    ...authState,
    logout,
    refresh: syncAuth,
  };
}
