'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import styles from './login.module.css';
import { setStoredAuth } from '../../utils/auth';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  // Pre-configured default demo credentials (all seeded and active in DB)
  const DEMO_ACCOUNTS = {
    ADMIN: {
      role: 'ADMIN',
      email: 'admin@example.com',
      password: 'Admin@123456',
      label: '👑 Admin (admin@example.com)',
    },
    USER: {
      role: 'USER',
      email: 'customer@example.com',
      password: 'User@123456',
      label: '👤 Customer (customer@example.com)',
    },
    USER_AARAVI: {
      role: 'USER',
      email: 'aaravipooner8424@gmail.com',
      password: 'aaravi',
      label: '👤 Aaravi (aaravipooner...)',
    },
    ADMIN_PERSONAL: {
      role: 'ADMIN',
      email: 'choudharyarpita504@gmail.com',
      password: 'Admin@123456',
      label: '👑 Arpita (Admin)',
    },
  };

  // Device detection: is user on a mobile device?
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  // Mode: 'login' | 'register'
  const [mode, setMode] = useState('login');

  // Form states - defaulted to Customer credentials on mobile, Admin on desktop
  const [name, setName] = useState('');
  const [role, setRole] = useState('USER');
  const [email, setEmail] = useState(DEMO_ACCOUNTS.USER.email);
  const [password, setPassword] = useState(DEMO_ACCOUNTS.USER.password);
  const [showPassword, setShowPassword] = useState(false);

  // Feedback states
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Detect mobile device on client mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
      const isMobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua);
      const isCapacitor = !!window.Capacitor;
      const isSmall = window.innerWidth <= 900;
      const mobileDetected = isMobileUA || isCapacitor || isSmall;

      setIsMobileDevice(mobileDetected);

      if (mobileDetected) {
        // Enforce Customer role on mobile
        setRole('USER');
        setEmail(DEMO_ACCOUNTS.USER.email);
        setPassword(DEMO_ACCOUNTS.USER.password);
      } else {
        // Default to Admin on desktop
        setRole('ADMIN');
        setEmail(DEMO_ACCOUNTS.ADMIN.email);
        setPassword(DEMO_ACCOUNTS.ADMIN.password);
      }
    }
  }, []);

  // Quick switch or select account with autofill
  const selectAccount = (accountKey) => {
    const acc = DEMO_ACCOUNTS[accountKey];
    if (acc) {
      if (isMobileDevice && acc.role === 'ADMIN') {
        setErrorMessage('Admin panel is restricted to desktop computers. Please use a desktop browser to sign in as Administrator.');
        return;
      }
      setRole(acc.role);
      setEmail(acc.email);
      setPassword(acc.password);
    } else {
      setRole(accountKey);
    }
    setErrorMessage('');
  };

  // Switch between Login and Register tabs
  const handleTabChange = (newMode) => {
    setMode(newMode);
    setErrorMessage('');
    setSuccessMessage('');
    if (newMode === 'register') {
      setEmail('');
      setPassword('');
      setName('');
    } else {
      // Re-populate selected role's credentials for quick login
      const account = DEMO_ACCOUNTS[role] || (isMobileDevice ? DEMO_ACCOUNTS.USER : DEMO_ACCOUNTS.ADMIN);
      setEmail(account.email);
      setPassword(account.password);
    }
  };

  // Submit Login
  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setLoading(true);

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    // Block Admin login attempt from mobile device
    if (isMobileDevice && (role === 'ADMIN' || cleanEmail.toLowerCase() === 'admin@example.com' || cleanEmail.toLowerCase() === 'admin@gmail.com')) {
      setErrorMessage('Admin access is strictly restricted to desktop computers. Please open Buyora from a laptop or desktop browser to sign in as Administrator.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: cleanEmail, password: cleanPassword, role }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed. Please verify credentials and role.');
      }

      // If user is Admin but attempting to use mobile device, block redirect
      if (data.user.role === 'ADMIN' && isMobileDevice) {
        throw new Error('Admin management panel is only accessible from desktop computers. Please log in from a desktop browser.');
      }

      // Save token and user in localStorage and broadcast event
      setStoredAuth(data.token, data.user);

      // Redirect based on redirect parameter or role
      if (redirectParam) {
        router.push(redirectParam);
      } else if (data.user.role === 'ADMIN') {
        router.push('/dashboard/admin');
      } else {
        router.push('/products');
      }
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Submit Register (New User)
  const handleRegister = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setLoading(true);

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();
    const cleanName = name.trim();

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: cleanName, email: cleanEmail, password: cleanPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed.');
      }

      setSuccessMessage(`Account created successfully for ${cleanEmail}! Please sign in.`);
      setMode('login');
      setRole('USER');
      setEmail(cleanEmail);
      setPassword(cleanPassword);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#64748b',
              textDecoration: 'none',
            }}
          >
            ← Back to Store
          </Link>

          {redirectParam && (
            <span style={{ fontSize: '12px', background: '#eff6ff', color: '#2563eb', padding: '3px 8px', borderRadius: '6px', fontWeight: 600 }}>
              Login to continue
            </span>
          )}
        </div>

        <h1 className={styles.title}>
          {mode === 'login'
            ? isMobileDevice ? 'Customer Sign In' : 'Welcome Back'
            : 'Create Customer Account'}
        </h1>
        <p className={styles.subtitle}>
          {mode === 'login'
            ? isMobileDevice
              ? 'Sign in to your customer account to place orders and track deliveries.'
              : 'Sign in to access your customer orders or admin management panel.'
            : 'Register a new customer account to place orders and track deliveries.'}
        </p>

        {/* Tab Navigation */}
        <div className={styles.tabContainer}>
          <button
            type="button"
            className={`${styles.tab} ${mode === 'login' ? styles.activeTab || styles.tabActive : ''}`}
            onClick={() => handleTabChange('login')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`${styles.tab} ${mode === 'register' ? styles.activeTab || styles.tabActive : ''}`}
            onClick={() => handleTabChange('register')}
          >
            Register
          </button>
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div className={styles.alertError} role="alert" style={{ color: '#dc2626', marginBottom: '16px', padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span style={{ fontWeight: 600 }}>{errorMessage}</span>
            </div>
            {errorMessage.toLowerCase().includes('invalid') && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#991b1b', lineHeight: 1.4 }}>
                💡 <strong>Quick Fix:</strong> Click one of the <em>Quick Autofill Account</em> buttons below to log in instantly, or click the <strong>Register</strong> tab if you need to create a new account first.
              </div>
            )}
          </div>
        )}

        {successMessage && (
          <div className={styles.alertSuccess} role="status" style={{ color: '#059669', marginBottom: '16px', padding: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.2" style={{ flexShrink: 0 }}>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span style={{ fontWeight: 600 }}>{successMessage}</span>
          </div>
        )}

        {/* Login Form */}
        {mode === 'login' && (
          <form onSubmit={handleLogin}>
            {/* Quick Autofill Buttons */}
            <div className={styles.autofillSection}>
              <div className={styles.autofillHeader}>
                <span>{isMobileDevice ? 'Customer Demo Accounts' : 'Verified Demo Accounts'}</span>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Click to fill</span>
              </div>
              <div className={styles.autofillGrid} style={{ gridTemplateColumns: isMobileDevice ? '1fr 1fr' : '1fr 1fr', gap: '8px' }}>
                {/* On Desktop: Show Admin Options */}
                {!isMobileDevice && (
                  <>
                    <button
                      type="button"
                      className={`${styles.autofillBtn} ${email === DEMO_ACCOUNTS.ADMIN.email ? styles.autofillBtnActive : ''}`}
                      onClick={() => selectAccount('ADMIN')}
                    >
                      <span className={styles.autofillRole}>👑 Admin</span>
                      <span className={styles.autofillEmail}>admin@example.com</span>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Admin@123456</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.autofillBtn} ${email === DEMO_ACCOUNTS.ADMIN_PERSONAL.email ? styles.autofillBtnActive : ''}`}
                      onClick={() => selectAccount('ADMIN_PERSONAL')}
                    >
                      <span className={styles.autofillRole}>👑 Arpita Admin</span>
                      <span className={styles.autofillEmail}>choudharyarpita...</span>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Admin@123456</span>
                    </button>
                  </>
                )}

                {/* Customer Options (Shown everywhere) */}
                <button
                  type="button"
                  className={`${styles.autofillBtn} ${email === DEMO_ACCOUNTS.USER.email ? styles.autofillBtnActive : ''}`}
                  onClick={() => selectAccount('USER')}
                >
                  <span className={styles.autofillRole}>👤 Customer</span>
                  <span className={styles.autofillEmail}>customer@example.com</span>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>User@123456</span>
                </button>
                <button
                  type="button"
                  className={`${styles.autofillBtn} ${email === DEMO_ACCOUNTS.USER_AARAVI.email ? styles.autofillBtnActive : ''}`}
                  onClick={() => selectAccount('USER_AARAVI')}
                >
                  <span className={styles.autofillRole}>👤 Aaravi</span>
                  <span className={styles.autofillEmail}>aaravipooner8424...</span>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>aaravi</span>
                </button>
              </div>
            </div>

            {/* Portal Access: Hide or restrict Admin on mobile */}
            {!isMobileDevice ? (
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="login-role">
                  Select Portal Access
                </label>
                <select
                  id="login-role"
                  name="role"
                  className={styles.select}
                  value={role}
                  onChange={(e) => {
                    const newRole = e.target.value;
                    setRole(newRole);
                    if (newRole === 'ADMIN' && role !== 'ADMIN') {
                      selectAccount('ADMIN');
                    } else if (newRole === 'USER' && role !== 'USER') {
                      selectAccount('USER');
                    }
                  }}
                >
                  <option value="ADMIN">Administrator (ADMIN)</option>
                  <option value="USER">Customer / User (USER)</option>
                </select>
              </div>
            ) : (
              <div style={{ marginBottom: '14px', padding: '8px 12px', background: '#f1f5f9', borderRadius: '8px', fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🔒</span>
                <span>Mobile App is restricted to <strong>Customer Accounts</strong> only.</span>
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="login-email">
                Email Address
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                className={styles.input}
                placeholder="Enter Email (e.g. customer@example.com)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className={styles.label} htmlFor="login-password">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                    marginBottom: '7px',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'} Password
                </button>
              </div>
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className={styles.input}
                placeholder="Enter Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>

            <div className={styles.switchPrompt}>
              Don&apos;t have an account yet?
              <button
                type="button"
                className={styles.switchLink}
                onClick={() => handleTabChange('register')}
              >
                Create Account
              </button>
            </div>
          </form>
        )}

        {/* Register Form */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} autoComplete="off">
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="register-name">
                Full Name
              </label>
              <input
                id="register-name"
                name="register_name_clean"
                type="text"
                className={styles.input}
                placeholder="Enter Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="register-email">
                Email Address
              </label>
              <input
                id="register-email"
                name="register_email_clean"
                type="email"
                className={styles.input}
                placeholder="Enter Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>

            <div className={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className={styles.label} htmlFor="register-password">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                    marginBottom: '7px',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'} Password
                </button>
              </div>
              <input
                id="register-password"
                name="register_password_clean"
                type={showPassword ? 'text' : 'password'}
                className={styles.input}
                placeholder="Enter Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="register-role">
                Assigned Role
              </label>
              <input
                id="register-role"
                type="text"
                className={styles.readOnlyInput}
                value="User (Customer Account)"
                readOnly
              />
              <p className={styles.helperText}>
                New self-registered accounts are automatically assigned the Customer role.
              </p>
            </div>

            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Customer Account'}
            </button>

            <div className={styles.switchPrompt}>
              Already have an account?
              <button
                type="button"
                className={styles.switchLink}
                onClick={() => handleTabChange('login')}
              >
                Sign In
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: '60px' }}>Loading Portal...</div>}>
      <LoginFormContent />
    </Suspense>
  );
}
