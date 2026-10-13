'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CustomerNavbar from '../../components/CustomerNavbar';
import styles from './profile.module.css';
import { useCustomerAuth } from '../../utils/auth';

export default function CustomerProfilePage() {
  const router = useRouter();
  const { user, token, isAuthenticated, isLoading, logout } = useCustomerAuth();
  const [profileData, setProfileData] = useState(null);
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);

  // Fetch updated profile info from backend
  useEffect(() => {
    if (token) {
      setIsFetchingProfile(true);
      fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.user) {
            setProfileData(data.user);
          }
        })
        .catch((err) => {
          console.warn('Could not fetch backend profile:', err);
        })
        .finally(() => {
          setIsFetchingProfile(false);
        });
    }
  }, [token]);

  const activeUser = profileData || user;

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        <CustomerNavbar />
        <main className={styles.mainContainer}>
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b', fontWeight: 600 }}>
            Verifying customer profile...
          </div>
        </main>
      </div>
    );
  }

  // 2. Unauthorized State (Customer not authenticated)
  if (!isAuthenticated || !token) {
    return (
      <div className={styles.pageContainer}>
        <CustomerNavbar />
        <main className={styles.mainContainer}>
          <div className={styles.centerCard}>
            <div className={styles.iconCircle}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h2 className={styles.stateTitle}>Sign In to View Profile</h2>
            <p className={styles.stateDesc}>
              This profile area is protected. Please log in with your customer account to view your account details and
              manage your orders.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link href="/login?redirect=/profile" className={styles.primaryBtn}>
                Sign In
              </Link>
              <Link href="/products" className={styles.secondaryBtn}>
                Browse Products
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // 3. Authenticated Profile View
  const initial = (activeUser?.name || activeUser?.email || 'C')[0].toUpperCase();

  return (
    <div className={styles.pageContainer}>
      <CustomerNavbar />

      <main className={styles.mainContainer}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Customer Profile</h1>
          <p className={styles.pageSubtitle}>
            Manage your personal account details, monitor previous orders, and manage checkout preferences.
          </p>
        </div>

        {/* Profile Overview Card */}
        <div className={styles.profileCard}>
          <div className={styles.profileCardHeader}>
            <div className={styles.avatarCircle}>{initial}</div>
            <div>
              <h2 className={styles.userName}>{activeUser?.name || 'Customer Member'}</h2>
              <p className={styles.userEmail}>{activeUser?.email || 'N/A'}</p>
              <div className={styles.roleBadge}>
                <span>●</span>
                <span>{activeUser?.role || 'Customer'}</span>
              </div>
            </div>
          </div>

          <div className={styles.profileCardBody}>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <div className={styles.infoLabel}>Account Full Name</div>
                <div className={styles.infoValue}>{activeUser?.name || 'Customer'}</div>
              </div>

              <div className={styles.infoItem}>
                <div className={styles.infoLabel}>Email Address</div>
                <div className={styles.infoValue}>{activeUser?.email || 'N/A'}</div>
              </div>

              <div className={styles.infoItem}>
                <div className={styles.infoLabel}>Account Status</div>
                <div className={styles.infoValue} style={{ color: '#16a34a' }}>
                  ✓ Active & Verified
                </div>
              </div>

              <div className={styles.infoItem}>
                <div className={styles.infoLabel}>Member Access</div>
                <div className={styles.infoValue}>
                  {activeUser?.role === 'ADMIN' ? 'Store Administrator' : 'Verified Customer'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '8px' }}>
              <button
                type="button"
                onClick={handleLogout}
                className={styles.secondaryBtn}
                style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Navigation Tiles */}
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '16px' }}>
          Quick Navigation
        </h3>

        <div className={styles.quickActionsGrid}>
          {/* Orders Tile */}
          <Link href="/orders" className={styles.actionTile}>
            <div className={styles.actionTileIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
            </div>
            <div className={styles.actionTileTitle}>My Orders</div>
            <div className={styles.actionTileDesc}>
              Track previous purchases, payment statuses, and shipment details.
            </div>
          </Link>

          {/* Cart Tile */}
          <Link href="/cart" className={styles.actionTile}>
            <div className={styles.actionTileIcon} style={{ background: '#f0fdf4', color: '#16a34a' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
            </div>
            <div className={styles.actionTileTitle}>Shopping Cart</div>
            <div className={styles.actionTileDesc}>
              Review chosen items, adjust quantities, and proceed to checkout.
            </div>
          </Link>

          {/* Catalog Tile */}
          <Link href="/products" className={styles.actionTile}>
            <div className={styles.actionTileIcon} style={{ background: '#faf5ff', color: '#9333ea' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
            </div>
            <div className={styles.actionTileTitle}>Browse Products</div>
            <div className={styles.actionTileDesc}>
              Discover new arrivals, view product specifications, and check live stock.
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
