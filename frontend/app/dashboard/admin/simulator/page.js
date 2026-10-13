'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import DeliverySimulator from '../components/DeliverySimulator';
export default function DeliverySimulatorPage() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Strictly block Admin / Simulator from running inside the standalone PWA app window
    if (typeof window !== 'undefined') {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

      if (isStandalone) {
        window.location.href = '/';
        return;
      }
    }

    try {
      const adminToken = localStorage.getItem('admin_token');
      const adminUserRaw = localStorage.getItem('admin_user');
      if (adminToken) {
        setToken(adminToken);
        setUser(adminUserRaw ? JSON.parse(adminUserRaw) : null);
      } else {
        const auth = getStoredAuth();
        if (auth.token) {
          setToken(auth.token);
          setUser(auth.user);
        }
      }
    } catch (e) {
      console.warn('Session verification error:', e);
    }
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      {/* Clean Admin-Only Header - NO Customer Navbar or PWA */}
      <header
        style={{
          background: '#1e293b',
          borderBottom: '1px solid #334155',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: '16px', color: '#f8fafc' }}>
            Buyora Admin • Live Delivery Simulator
          </span>
        </div>
        <Link
          href="/dashboard/admin"
          style={{
            fontSize: '13px',
            color: '#38bdf8',
            textDecoration: 'none',
            fontWeight: 600,
            padding: '6px 14px',
            borderRadius: '6px',
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
          }}
        >
          ← Return to Dashboard
        </Link>
      </header>

      <main style={{ flex: 1, padding: '20px 16px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link
            href="/dashboard/admin?tab=REFUNDS"
            style={{
              fontSize: '13px',
              color: '#475569',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
            }}
          >
            <span>←</span>
            <span>Back to Admin Dashboard</span>
          </Link>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Blinkit Live Tracking Development Tool
          </span>
        </div>

        <DeliverySimulator token={token} />
      </main>
    </div>
  );
}
