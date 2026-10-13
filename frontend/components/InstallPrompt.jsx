'use client';

import { useState, useEffect } from 'react';

/**
 * InstallPrompt – Buyora Customer PWA install banner.
 *
 * Rules:
 *  - Only shown when the browser fires `beforeinstallprompt` (i.e. PWA is installable).
 *  - Only shown on Customer routes (not on /dashboard/* – the Admin layout is separate).
 *  - Once dismissed, it is suppressed for 7 days via localStorage.
 *  - Clicking "Install Buyora" triggers the native browser install flow.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Suppress on Admin Panel routes (/dashboard/*), Rider routes, and Simulator
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      if (
        p.startsWith('/dashboard') ||
        p.startsWith('/admin') ||
        p.startsWith('/rider') ||
        p.startsWith('/simulator')
      ) {
        return;
      }
    }

    // Check if user already dismissed recently (7-day cooldown)
    const dismissed = localStorage.getItem('buyora_install_dismissed');
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - dismissedAt < sevenDays) return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    const handleInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('buyora_pwa_installed', handleInstalled);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('buyora_pwa_installed', handleInstalled);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.removeItem('buyora_install_dismissed');
    }
    setDeferredPrompt(null);
    setVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('buyora_install_dismissed', Date.now().toString());
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      background: 'linear-gradient(135deg, #1976d2, #0d47a1)',
      color: '#fff',
      borderRadius: '14px',
      padding: '16px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      boxShadow: '0 8px 32px rgba(25,118,210,0.4)',
      maxWidth: '90vw',
      animation: 'buyoraSlideUp 0.3s ease',
    }}>
      <style>{`
        @keyframes buyoraSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      <span style={{ fontSize: '28px' }}>🛍️</span>

      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Install Buyora</div>
        <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>Shop faster from your home screen</div>
      </div>

      <button
        onClick={handleInstall}
        style={{
          background: '#fff',
          color: '#1976d2',
          border: 'none',
          borderRadius: '8px',
          padding: '8px 18px',
          fontWeight: 700,
          fontSize: '0.85rem',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Install
      </button>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          fontSize: '1.2rem',
          cursor: 'pointer',
          lineHeight: 1,
          padding: '4px',
        }}
      >
        ✕
      </button>
    </div>
  );
}
