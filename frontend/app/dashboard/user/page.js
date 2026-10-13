'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './userDashboard.module.css';
export default function UserDashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    const storedUser = localStorage.getItem('admin_user');
    if (!token) {
      router.push('/login');
      return;
    }
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setCurrentUser(parsed);
      } catch (e) {
        // Ignore
      }
    }
    // Fetch latest profile from backend
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then((data) => {
        if (data.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {
        if (!storedUser) {
          localStorage.removeItem('admin_token');
          router.push('/login');
        }
      })
      .finally(() => setLoading(false));
  }, [router]);
  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };
  if (loading && !currentUser) {
    return (
      <div className={styles.container}>
        <div className={styles.card} style={{ padding: '40px', textAlign: 'center' }}>
          Loading Dashboard...
        </div>
      </div>
    );
  }
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>User Dashboard</h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className={styles.userBadge}>User</span>
          </div>
        </div>
        {/* Body */}
        <div className={styles.body}>
          {/* Mild Attractive Greeting */}
          <div className={styles.welcomeBanner}>
            <h2 className={styles.welcomeHeading}>
              Welcome back, {currentUser?.name || 'Member'}!
            </h2>
            <p className={styles.welcomeText}>
              This is your user dashboard. You are successfully authenticated with standard member privileges.
            </p>
          </div>
          {/* User Profile Fields with Placeholders */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Name</label>
            <input
              type="text"
              className={styles.readOnlyInput}
              placeholder="Enter Name"
              value={currentUser?.name || ''}
              readOnly
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Email</label>
            <input
              type="email"
              className={styles.readOnlyInput}
              placeholder="Enter Email"
              value={currentUser?.email || ''}
              readOnly
            />
          </div>
          {/* Mild Attractive Status Note */}
          <div className={styles.statusBox}>
            <div className={styles.statusDot} />
            <div className={styles.statusContent}>
              <div className={styles.statusTitle}>Session Active & Verified</div>
              <p className={styles.statusDescription}>
                Your account is in good standing. You can review your profile or logout securely below.
              </p>
            </div>
          </div>
          {/* Actions: Browse Products and Logout */}
          <div className={styles.buttonContainer} style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Link
              href="/products"
              style={{
                padding: '10px 24px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
              <span>Browse Products</span>
            </Link>
            <button type="button" onClick={handleLogout} className={styles.logoutButton}>
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
