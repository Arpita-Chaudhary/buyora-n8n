'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Sidebar from './components/Sidebar';
import styles from './layout.module.css';

export default function DashboardLayout({ children }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobileBlocked, setIsMobileBlocked] = useState(false);
  const [checkingDevice, setCheckingDevice] = useState(true);

  // Strictly block mobile devices and mobile PWA/Capacitor apps from accessing Admin panel
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
      const isMobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua);
      const isCapacitor = !!window.Capacitor;
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
      const isSmallScreen = window.innerWidth <= 900;

      if (isMobileUA || isCapacitor || isStandalone || isSmallScreen) {
        setIsMobileBlocked(true);
      }
      setCheckingDevice(false);
    }
  }, []);

  if (checkingDevice) {
    return <div style={{ minHeight: '100vh', background: '#090d16' }} />;
  }

  // Mobile Device Access Denial Screen
  if (isMobileBlocked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#090d16',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            width: '76px',
            height: '76px',
            borderRadius: '22px',
            background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '36px',
            marginBottom: '20px',
            boxShadow: '0 10px 30px -5px rgba(239, 68, 68, 0.45)',
          }}
        >
          🖥️
        </div>

        <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '12px', color: '#f8fafc', letterSpacing: '-0.02em' }}>
          Desktop Access Only
        </h1>

        <p style={{ fontSize: '15px', color: '#94a3b8', maxWidth: '400px', lineHeight: 1.6, marginBottom: '28px' }}>
          The Buyora Admin Management Panel is strictly restricted to desktop computers. Please open this page from a desktop or laptop browser to manage products, orders, and delivery zones.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '280px' }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              padding: '13px 20px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
              transition: 'background-color 0.2s',
            }}
          >
            ← Back to Customer Store
          </Link>
          <Link
            href="/products"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#cbd5e1',
              padding: '12px 20px',
              borderRadius: '10px',
              fontSize: '13.5px',
              fontWeight: 600,
              textDecoration: 'none',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
          >
            Browse Products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.dashboardShell}>
      {/* Universal Admin Panel Sidebar */}
      <Sidebar
        isOpenMobile={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Main Viewport Content Area */}
      <div className={styles.mainViewport}>
        {/* Page Content */}
        {children}
      </div>
    </div>
  );
}
