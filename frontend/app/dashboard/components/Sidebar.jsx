'use client';
import { useState, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import styles from './Sidebar.module.css';
import { hasPermission, PERMISSIONS } from '../../../utils/acl';

export default function Sidebar({ isOpenMobile, onCloseMobile }) {
  const router = useRouter();
  const pathname = usePathname();

  const [currentUser, setCurrentUser] = useState(null);
  const [currentTab, setCurrentTab] = useState('USERS');
  const [pendingRefundsCount, setPendingRefundsCount] = useState(0);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
    const storedUser = typeof window !== 'undefined' ? localStorage.getItem('admin_user') : null;

    if (storedUser) {
      try {
        setCurrentUser(JSON.parse(storedUser));
      } catch (e) {
        // Ignore parse error
      }
    }

    // Refresh from backend to guarantee latest dynamic permissions
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.user) {
            setCurrentUser(data.user);
            localStorage.setItem('admin_user', JSON.stringify(data.user));
          }
        })
        .catch(() => {
          // Token expired or invalid
        });
    }

    // Sync tab from current URL
    const syncTabFromUrl = () => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab') || 'USERS';
        setCurrentTab(tab);
      }
    };

    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    window.addEventListener('dashboard-tab-change', syncTabFromUrl);

    // Fetch initial pending refunds count for badge
    if (token) {
      fetch('/api/payments/admin/refunds?status=requested', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.metrics?.pendingRefunds !== undefined) {
            setPendingRefundsCount(data.metrics.pendingRefunds);
          }
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('popstate', syncTabFromUrl);
      window.removeEventListener('dashboard-tab-change', syncTabFromUrl);
    };
  }, []);

  // Compute user role & permissions
  const roleName = (currentUser?.role || currentUser?.role_id?.name || 'USER').toUpperCase();
  const isAdmin = roleName === 'ADMIN';

  const canViewUsers = isAdmin || hasPermission(currentUser, PERMISSIONS.USERS_READ) || hasPermission(currentUser, 'users.view');
  const canViewPromotions = isAdmin || hasPermission(currentUser, PERMISSIONS.PROMOTIONS_SEND) || hasPermission(currentUser, 'promotions.view');
  const canViewProducts = isAdmin || hasPermission(currentUser, PERMISSIONS.PRODUCTS_READ) || hasPermission(currentUser, 'products.view');
  const canViewDeliveryZones = isAdmin || hasPermission(currentUser, PERMISSIONS.DELIVERY_ZONES_READ) || hasPermission(currentUser, 'delivery_zones.view');

  // Navigation action
  const handleNav = (targetPath, tabParam = null) => {
    if (onCloseMobile) onCloseMobile();

    if (tabParam) {
      if (pathname === '/dashboard/admin') {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tabParam);
        window.history.pushState(null, '', url.toString());
        setCurrentTab(tabParam);
        window.dispatchEvent(new Event('dashboard-tab-change'));
      } else {
        router.push(`/dashboard/admin?tab=${tabParam}`);
      }
    } else {
      router.push(targetPath);
    }
  };

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
    }
    router.push('/login');
  };

  // Get user initials
  const initials = useMemo(() => {
    if (!currentUser?.name) return 'A';
    const parts = currentUser.name.trim().split(' ');
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }, [currentUser]);

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div className={styles.mobileBackdrop} onClick={onCloseMobile} />
      )}

      <aside className={`${styles.sidebarContainer} ${isOpenMobile ? styles.sidebarOpen : ''}`}>
        {/* Top Brand / Logo */}
        <div>
          <div className={styles.brandHeader}>
            <div className={styles.brandLeft}>
              <div className={styles.brandLogo}>⚡</div>
              <div className={styles.brandText}>
                <span className={styles.brandTitle}>Admin Panel</span>
                <span className={styles.brandSubtitle}>
                  <span className={styles.statusIndicator} />
                  Live System
                </span>
              </div>
            </div>
          </div>

          {/* User Profile Snippet */}
          <div className={styles.userProfileCard}>
            <div className={styles.userAvatar}>{initials}</div>
            <div className={styles.userInfo}>
              <div className={styles.userName} title={currentUser?.name || 'Administrator'}>
                {currentUser?.name || 'Administrator'}
              </div>
              <span className={`${styles.userRoleBadge} ${isAdmin ? styles.roleAdmin : styles.roleUser}`}>
                {roleName}
              </span>
            </div>
          </div>

          {/* Navigation Items */}
          <div className={styles.navScrollArea}>
            {/* MANAGEMENT SECTION (Guarded by Permissions) */}
            {(canViewUsers || canViewPromotions || canViewProducts || canViewDeliveryZones || isAdmin) && (
              <div className={styles.navSection}>
                <span className={styles.sectionLabel}>Management</span>
                <ul className={styles.navList}>
                  {canViewUsers && (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleNav('/dashboard/admin', 'USERS')}
                        className={`${styles.navItem} ${
                          pathname === '/dashboard/admin' && currentTab === 'USERS'
                            ? styles.navItemActive
                            : ''
                        }`}
                      >
                        <div className={styles.navItemLeft}>
                          <span className={styles.navIcon}>👥</span>
                          <span>Users Directory</span>
                        </div>
                      </button>
                    </li>
                  )}

                  {canViewPromotions && (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleNav('/dashboard/admin', 'PROMOTIONS')}
                        className={`${styles.navItem} ${
                          pathname === '/dashboard/admin' && currentTab === 'PROMOTIONS'
                            ? styles.navItemActive
                            : ''
                        }`}
                      >
                        <div className={styles.navItemLeft}>
                          <span className={styles.navIcon}>📢</span>
                          <span>Promotions</span>
                        </div>
                      </button>
                    </li>
                  )}

                  {/* PRODUCTS NAVIGATION ITEM */}
                  {canViewProducts && (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleNav('/dashboard/admin', 'PRODUCTS')}
                        className={`${styles.navItem} ${
                          pathname === '/dashboard/admin/products' ||
                          (pathname === '/dashboard/admin' && currentTab === 'PRODUCTS')
                            ? styles.navItemActive
                            : ''
                        }`}
                      >
                        <div className={styles.navItemLeft}>
                          <span className={styles.navIcon}>📦</span>
                          <span>Products</span>
                        </div>
                      </button>
                    </li>
                  )}

                  {/* DELIVERY ZONES NAVIGATION ITEM */}
                  {canViewDeliveryZones && (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleNav('/dashboard/admin', 'ZONES')}
                        className={`${styles.navItem} ${
                          pathname === '/dashboard/admin/zones' ||
                          (pathname === '/dashboard/admin' && currentTab === 'ZONES')
                            ? styles.navItemActive
                            : ''
                        }`}
                      >
                        <div className={styles.navItemLeft}>
                          <span className={styles.navIcon}>🗺️</span>
                          <span>Delivery Zones</span>
                        </div>
                      </button>
                    </li>
                  )}

                  {/* REFUND REQUESTS NAVIGATION ITEM */}
                  {isAdmin && (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleNav('/dashboard/admin', 'REFUNDS')}
                        className={`${styles.navItem} ${
                          pathname === '/dashboard/admin' && currentTab === 'REFUNDS'
                            ? styles.navItemActive
                            : ''
                        }`}
                      >
                        <div className={styles.navItemLeft}>
                          <span className={styles.navIcon}>💳</span>
                          <span>Refund Requests</span>
                        </div>
                        {pendingRefundsCount > 0 && (
                          <span
                            style={{
                              background: '#f59e0b',
                              color: '#ffffff',
                              fontSize: '11px',
                              fontWeight: 800,
                              padding: '2px 7px',
                              borderRadius: '999px',
                            }}
                          >
                            {pendingRefundsCount}
                          </span>
                        )}
                      </button>
                    </li>
                  )}

                  {/* GPS SIMULATOR NAVIGATION ITEM */}
                  {isAdmin && (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleNav('/dashboard/admin', 'SIMULATOR')}
                        className={`${styles.navItem} ${
                          pathname === '/dashboard/admin/simulator' ||
                          (pathname === '/dashboard/admin' && currentTab === 'SIMULATOR')
                            ? styles.navItemActive
                            : ''
                        }`}
                      >
                        <div className={styles.navItemLeft}>
                          <span className={styles.navIcon}>🛵</span>
                          <span>GPS Simulator</span>
                        </div>
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* ACCOUNT (Available for non-admin or profile view) */}
            {!isAdmin && (
              <div className={styles.navSection}>
                <span className={styles.sectionLabel}>Account</span>
                <ul className={styles.navList}>
                  <li>
                    <button
                      type="button"
                      onClick={() => handleNav('/dashboard/user')}
                      className={`${styles.navItem} ${
                        pathname === '/dashboard/user' ? styles.navItemActive : ''
                      }`}
                    >
                      <div className={styles.navItemLeft}>
                        <span className={styles.navIcon}>👤</span>
                        <span>My Profile</span>
                      </div>
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer & Logout */}
        <div className={styles.sidebarFooter}>
          <button type="button" onClick={handleLogout} className={styles.logoutBtn}>
            <span>🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
