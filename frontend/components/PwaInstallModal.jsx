'use client';

import React from 'react';

/**
 * PwaInstallModal:
 * Displays clear step-by-step instructions for installing Buyora PWA across all devices
 * (iOS Safari, Android Chrome, and Desktop Chrome/Edge).
 */
export default function PwaInstallModal({ isOpen, onClose, platform, onNativePrompt, hasNativePrompt }) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          color: '#0f172a',
          borderRadius: '16px',
          maxWidth: '460px',
          width: '100%',
          padding: '28px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: '#f1f5f9',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#64748b',
          }}
          aria-label="Close"
        >
          ✕
        </button>

        {/* App Icon & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
            }}
          >
            <span style={{ fontSize: '26px' }}>🛍️</span>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              Download Buyora App
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
              Fast, lightweight shopping with offline mode
            </p>
          </div>
        </div>

        {/* Content based on platform */}
        {hasNativePrompt ? (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '14px', color: '#334155', lineHeight: 1.5, marginBottom: '16px' }}>
              Install Buyora directly to your device for instant access from your home screen or desktop.
            </p>
            <button
              onClick={() => {
                onNativePrompt();
                onClose();
              }}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
              }}
            >
              <span>⬇️</span> Install Now
            </button>
          </div>
        ) : platform === 'ios' ? (
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '16px',
                fontSize: '13.5px',
                lineHeight: 1.6,
                color: '#334155',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>1.</span>
                <span>Tap the <strong>Share</strong> button (📤) in Safari.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>2.</span>
                <span>Scroll down and tap <strong>Add to Home Screen</strong> (➕).</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>3.</span>
                <span>Tap <strong>Add</strong> at top right. Buyora will appear on your home screen!</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '16px',
                fontSize: '13.5px',
                lineHeight: 1.6,
                color: '#334155',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>1.</span>
                <span>Tap the <strong>Browser Menu (⋮)</strong> or the <strong>Install Icon (💻)</strong> in the address bar.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>2.</span>
                <span>Select <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong>.</span>
              </div>
            </div>
          </div>
        )}

        {/* Benefits list */}
        <div
          style={{
            borderTop: '1px solid #f1f5f9',
            paddingTop: '16px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
            fontSize: '12px',
            color: '#64748b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>⚡</span> Instant Loading
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>📶</span> Works Offline
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🔒</span> Safe & Lightweight
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🚫</span> No Play Store needed
          </div>
        </div>
      </div>
    </div>
  );
}
