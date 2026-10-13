'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminDeliveryZonesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/admin?tab=ZONES');
  }, [router]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        color: '#64748b',
        fontSize: '15px',
        fontWeight: 500,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            border: '3px solid #e2e8f0',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p>Loading Delivery Zones Management...</p>
      </div>
    </div>
  );
}
