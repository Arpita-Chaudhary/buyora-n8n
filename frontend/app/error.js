'use client';
import { useEffect } from 'react';
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('App Error Boundary caught:', error);
  }, [error]);
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '80vh',
      padding: '24px',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#1e293b',
      textAlign: 'center'
    }}>
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '40px',
        maxWidth: '480px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)'
      }}>
        <div style={{
          fontSize: '48px',
          marginBottom: '16px'
        }}>⚠️</div>
        <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px', color: '#0f172a' }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px', lineHeight: 1.5 }}>
          {error?.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <button
          onClick={() => reset ? reset() : window.location.reload()}
          style={{
            background: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 24px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
