'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import styles from './CustomerNavbar.module.css';
import { useCart } from '../utils/cart';
import { useCustomerAuth } from '../utils/auth';
import { useDeliveryLocation } from '../utils/deliveryLocation';
import { usePwa } from '../utils/pwa';
import CustomerLocationModal from './CustomerLocationModal';
import PwaInstallModal from './PwaInstallModal';

export default function CustomerNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  // Route check to guarantee PWA download option NEVER appears on Admin or Rider routes
  const isAdminOrRider =
    pathname?.startsWith('/dashboard') ||
    pathname?.startsWith('/admin') ||
    pathname?.startsWith('/rider') ||
    pathname?.startsWith('/simulator');

  // Prevent SSR hydration mismatches
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // PWA integration & install trigger
  const {
    isInstalled,
    triggerInstall,
    isInstallModalOpen,
    setIsInstallModalOpen,
    platform,
    deferredPrompt,
  } = usePwa();

  // Delivery Location & Zone Availability state from shared hook
  const { address, zone } = useDeliveryLocation();
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);

  // Live cart count from shared hook
  const { totalCount } = useCart();

  // Live customer auth state from shared hook
  const { user, isAuthenticated, logout } = useCustomerAuth();

  // Mobile menu open/close toggle
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Computed friendly customer display name (never display 'System'!)
  const displayName = useMemo(() => {
    if (!user) return 'Customer';
    if (user.role === 'ADMIN' || user.name === 'System Admin') return 'Admin';
    const firstWord = (user.name || '').trim().split(' ')[0];
    if (firstWord && firstWord.toLowerCase() !== 'system') return firstWord;
    return user.email ? user.email.split('@')[0] : 'User';
  }, [user]);

  // Close mobile menu whenever route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logout();
    setMobileMenuOpen(false);
    router.push('/login');
  };

  // Helper to determine if link is active
  const isActive = (path) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  return (
    <header className={styles.navWrapper}>
      <div className={styles.navContainer}>
        {/* 1. Customer Storefront Brand / Logo */}
        <Link href="/" className={styles.brand} aria-label="Buyora Home">
          <div className={styles.brandIcon}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
          </div>
          <div className={styles.brandTextGroup}>
            <span className={styles.brandName}>Buyora</span>
          </div>
        </Link>

        {/* 1b. Customer Delivery Location Selector Pill */}
        <button
          type="button"
          onClick={() => setIsLocationModalOpen(true)}
          className={styles.locationSelectorBtn}
          title="Click to change your delivery location and check zone availability"
        >
          <span className={styles.locationPinIcon}>📍</span>
          <div className={styles.locationTextGroup}>
            <span className={styles.locationPrefix}>Deliver to:</span>
            <span className={styles.locationAddressText}>
              {address?.label || address?.city || 'Select Location'}
            </span>
          </div>
          {zone?.serviceable && zone?.primaryZone ? (
            <span className={styles.locationSpeedBadge}>
              ⚡ {zone.primaryZone.estimatedDeliveryTime || '30m'}
            </span>
          ) : zone && !zone.serviceable ? (
            <span className={styles.locationWarningBadge}>
              ⚠️ Service Unreachable
            </span>
          ) : null}
          <span className={styles.locationChevron}>▾</span>
        </button>

        {/* 2. Desktop Navigation: Home | Products | Cart (count) | Orders | Profile */}
        <nav className={styles.desktopNav} aria-label="Customer Main Navigation">
          {/* Home */}
          <Link
            href="/"
            className={`${styles.navLink} ${isActive('/') && pathname === '/' ? styles.navLinkActive : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
            <span>Home</span>
          </Link>

          {/* Products */}
          <Link
            href="/products"
            className={`${styles.navLink} ${isActive('/products') ? styles.navLinkActive : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>Products</span>
          </Link>

          {/* Cart with Live Count */}
          <Link
            href="/cart"
            className={`${styles.navLink} ${isActive('/cart') ? styles.navLinkActive : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
            <span>Cart</span>
            <span className={`${styles.cartBadge} ${isActive('/cart') ? styles.cartBadgeActive : ''}`}>
              {totalCount}
            </span>
          </Link>

          {/* Orders */}
          <Link
            href="/orders"
            className={`${styles.navLink} ${isActive('/orders') ? styles.navLinkActive : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <span>Orders</span>
          </Link>

          {/* Profile */}
          <Link
            href="/profile"
            className={`${styles.navLink} ${isActive('/profile') ? styles.navLinkActive : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span>Profile</span>
          </Link>
        </nav>

        {/* 3. Desktop Auth Actions & PWA Download Button */}
        <div className={styles.authGroup} suppressHydrationWarning>
          {mounted && !isAdminOrRider && (
            <button
              type="button"
              onClick={triggerInstall}
              className={`${styles.pwaDownloadBtn} ${isInstalled ? styles.pwaDownloadBtnInstalled : ''}`}
              title={isInstalled ? 'Buyora App Installed' : 'Install Buyora App on your device'}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isInstalled ? (
                  <polyline points="20 6 9 17 4 12"></polyline>
                ) : (
                  <>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </>
                )}
              </svg>
              <span>{isInstalled ? 'App Installed' : 'Download App'}</span>
            </button>
          )}

          {mounted && isAuthenticated ? (
            <>
              <Link href="/profile" className={styles.userProfileSnippet}>
                <span className={styles.userAvatarMini}>
                  {(displayName || 'U')[0].toUpperCase()}
                </span>
                <span>{displayName}</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className={styles.logoutBtn}
                title="Sign out of your account"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                <span>Logout</span>
              </button>
            </>
          ) : (
            <Link href="/login" className={styles.loginBtn}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                <polyline points="10 17 15 12 10 7"></polyline>
                <line x1="15" y1="12" x2="3" y2="12"></line>
              </svg>
              <span>Login / Register</span>
            </Link>
          )}
        </div>

        {/* 4. Mobile Hamburger Toggle Button */}
        <button
          type="button"
          className={styles.mobileMenuBtn}
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          )}
        </button>
      </div>

      {/* 5. Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <nav className={styles.mobileDrawer} aria-label="Mobile Customer Navigation">
          {/* Mobile Delivery Location Selector */}
          <div className={styles.mobileLocationWrapper}>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setIsLocationModalOpen(true);
              }}
              className={`${styles.locationSelectorBtn} ${styles.mobileLocationBtn}`}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={styles.locationPinIcon}>📍</span>
                <div className={styles.locationTextGroup}>
                  <span className={styles.locationPrefix}>Deliver to:</span>
                  <span className={styles.locationAddressText} style={{ maxWidth: '170px' }}>
                    {address?.label || address?.city || 'Select Location'}
                  </span>
                </div>
              </div>
              {zone?.serviceable && zone?.primaryZone ? (
                <span className={styles.locationSpeedBadge}>
                  ⚡ {zone.primaryZone.estimatedDeliveryTime || '30m'}
                </span>
              ) : zone && !zone.serviceable ? (
                <span className={styles.locationWarningBadge}>
                  ⚠️ Service Unreachable
                </span>
              ) : null}
            </button>
          </div>

          <Link
            href="/"
            className={`${styles.mobileNavLink} ${isActive('/') && pathname === '/' ? styles.mobileNavLinkActive : ''}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
              <span>Home</span>
            </span>
          </Link>

          <Link
            href="/products"
            className={`${styles.mobileNavLink} ${isActive('/products') ? styles.mobileNavLinkActive : ''}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
              <span>Products</span>
            </span>
          </Link>

          <Link
            href="/cart"
            className={`${styles.mobileNavLink} ${isActive('/cart') ? styles.mobileNavLinkActive : ''}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
              <span>Cart</span>
            </span>
            <span className={styles.cartBadge}>{totalCount}</span>
          </Link>

          <Link
            href="/orders"
            className={`${styles.mobileNavLink} ${isActive('/orders') ? styles.mobileNavLinkActive : ''}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <span>Orders</span>
            </span>
          </Link>

          <Link
            href="/profile"
            className={`${styles.mobileNavLink} ${isActive('/profile') ? styles.mobileNavLinkActive : ''}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>Profile</span>
            </span>
          </Link>

          {/* Mobile PWA Download Button (Suppressed on Admin/Rider) */}
          {mounted && !isAdminOrRider && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                triggerInstall();
              }}
              className={styles.mobilePwaDownloadBtn}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isInstalled ? (
                  <polyline points="20 6 9 17 4 12"></polyline>
                ) : (
                  <>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </>
                )}
              </svg>
              <span>{isInstalled ? 'Buyora App Installed ✓' : 'Download Buyora App'}</span>
            </button>
          )}

          <div className={styles.mobileDivider}></div>

          <div className={styles.mobileAuthSection} suppressHydrationWarning>
            {mounted && isAuthenticated ? (
              <>
                <div className={styles.mobileUserBadge}>
                  <div className={styles.userAvatarMini}>
                    {(displayName || 'U')[0].toUpperCase()}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9' }}>
                      {displayName}
                    </span>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      {user?.email || ''}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className={styles.mobileLogoutBtn}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  <span>Log Out</span>
                </button>
              </>
            ) : (
              <Link href="/login" className={styles.mobileLoginBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                  <polyline points="10 17 15 12 10 7"></polyline>
                  <line x1="15" y1="12" x2="3" y2="12"></line>
                </svg>
                <span>Login / Register</span>
              </Link>
            )}
          </div>
        </nav>
      )}
      {/* Customer Location & Availability Modal */}
      <CustomerLocationModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
      />

      {/* Customer PWA Install Guided Modal (Suppressed on Admin/Rider) */}
      {mounted && !isAdminOrRider && (
        <PwaInstallModal
          isOpen={isInstallModalOpen}
          onClose={() => setIsInstallModalOpen(false)}
          platform={platform}
          hasNativePrompt={!!deferredPrompt}
          onNativePrompt={triggerInstall}
        />
      )}
    </header>
  );
}
