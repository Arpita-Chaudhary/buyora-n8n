import Link from 'next/link';
export default function NotFound() {
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
        }}>🔍</div>
        <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px', color: '#0f172a' }}>
          Page Not Found
        </h2>
        <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px', lineHeight: 1.5 }}>
          The dashboard route you requested does not exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: 'inline-block',
            background: '#2563eb',
            color: '#ffffff',
            textDecoration: 'none',
            borderRadius: '8px',
            padding: '10px 24px',
            fontSize: '14px',
            fontWeight: '600'
          }}
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
