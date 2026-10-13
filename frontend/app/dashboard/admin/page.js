'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import styles from './adminDashboard.module.css';
import ProductsManager from './components/ProductsManager';
import RefundsManager from './components/RefundsManager';
import DeliveryZoneManager from './components/DeliveryZoneManager';
import DeliverySimulator from './components/DeliverySimulator';
import { hasPermission, PERMISSIONS } from '../../../utils/acl';
// Pre-built email templates for fast selection
const EMAIL_TEMPLATES = {
  sale: {
    name: 'Flash Sale (30% Off)',
    subject: '🔥 Exclusive Weekend Flash Sale - 30% Off Storewide!',
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
  <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 30px 20px; text-align: center; color: #ffffff;">
    <h1 style="margin: 0; font-size: 26px;">Weekend Flash Sale!</h1>
    <p style="margin-top: 8px; font-size: 16px; opacity: 0.9;">Save 30% on all products this weekend only.</p>
  </div>
  <div style="padding: 24px; color: #334155; line-height: 1.6;">
    <p>Hello valued customer,</p>
    <p>We are thrilled to bring you our biggest promotional offer yet. Use the exclusive coupon code below at checkout:</p>
    <div style="background-color: #f1f5f9; border: 2px dashed #94a3b8; border-radius: 8px; padding: 14px; text-align: center; font-size: 22px; font-weight: bold; color: #1e293b; letter-spacing: 2px; margin: 20px 0;">
      FLASH30
    </div>
    <div style="text-align: center; margin-top: 24px;">
      <a href="http://localhost:3000" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 15px;">Shop Now</a>
    </div>
  </div>
  <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
    You received this email because you are a registered member.
  </div>
</div>`,
  },
  welcome: {
    name: 'Welcome Offer (15% Off)',
    subject: '🎉 Welcome to Our Community! Enjoy 15% Off Your First Order',
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
  <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px 20px; text-align: center; color: #ffffff;">
    <h1 style="margin: 0; font-size: 26px;">Welcome Aboard!</h1>
    <p style="margin-top: 8px; font-size: 15px; opacity: 0.9;">Thank you for joining our platform.</p>
  </div>
  <div style="padding: 24px; color: #334155; line-height: 1.6;">
    <p>Hi there,</p>
    <p>We are super excited to have you with us! As a token of our appreciation, here is a special 15% discount for your first purchase:</p>
    <div style="background-color: #ecfdf5; border: 2px dashed #059669; border-radius: 8px; padding: 14px; text-align: center; font-size: 20px; font-weight: bold; color: #047857; letter-spacing: 2px; margin: 20px 0;">
      WELCOME15
    </div>
    <p>Feel free to explore our portal and discover all features available to you.</p>
  </div>
</div>`,
  },
  announcement: {
    name: 'Product Update',
    subject: '🚀 Important Announcement: New Features Are Live!',
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
  <div style="background: #0f172a; padding: 26px 20px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 24px;">New Features Released</h2>
  </div>
  <div style="padding: 24px; color: #334155; line-height: 1.6;">
    <p>Dear Customer,</p>
    <p>We have just released exciting updates to improve your customer experience with faster speeds and improved security.</p>
    <ul style="padding-left: 20px;">
      <li>Enhanced dashboard navigation</li>
      <li>Instant email notifications</li>
      <li>Faster checkout and account management</li>
    </ul>
    <p>Log in today to explore what is new!</p>
  </div>
</div>`,
  },
};
export default function AdminDashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState('');
  const [productsCount, setProductsCount] = useState(0);
  const [pendingRefundsCount, setPendingRefundsCount] = useState(0);
  // Tab State: 'USERS' | 'PROMOTIONS' | 'PRODUCTS' | 'REFUNDS'
  const [activeTab, setActiveTab] = useState('USERS');

  // Permission flags based on currentUser
  const roleName = (currentUser?.role || currentUser?.role_id?.name || 'USER').toUpperCase();
  const isAdmin = roleName === 'ADMIN';

  const canViewUsers = isAdmin || hasPermission(currentUser, PERMISSIONS.USERS_READ) || hasPermission(currentUser, 'users.view');
  const canViewPromotions = isAdmin || hasPermission(currentUser, PERMISSIONS.PROMOTIONS_SEND) || hasPermission(currentUser, 'promotions.view');
  const canViewProducts = isAdmin || hasPermission(currentUser, PERMISSIONS.PRODUCTS_READ) || hasPermission(currentUser, 'products.view');
  const canViewDeliveryZones = isAdmin || hasPermission(currentUser, PERMISSIONS.DELIVERY_ZONES_READ) || hasPermission(currentUser, 'delivery_zones.view');

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location);
      url.searchParams.set('tab', newTab);
      window.history.replaceState(null, '', url.toString());
      window.dispatchEvent(new Event('dashboard-tab-change'));
    }
  };

  useEffect(() => {
    const syncTab = () => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        if (tab === 'PROMOTIONS' || tab === 'USERS' || tab === 'PRODUCTS' || tab === 'REFUNDS' || tab === 'ZONES' || tab === 'SIMULATOR') {
          setActiveTab(tab);
        }
      }
    };
    syncTab();
    window.addEventListener('popstate', syncTab);
    window.addEventListener('dashboard-tab-change', syncTab);
    return () => {
      window.removeEventListener('popstate', syncTab);
      window.removeEventListener('dashboard-tab-change', syncTab);
    };
  }, []);
  // Filter & Search States for Users Table
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  // Feedback alert state
  const [alert, setAlert] = useState(null);
  // Floating Toaster Notification State
  const [toast, setToast] = useState(null);
  const triggerToast = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  // Modal State for adding new user
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'USER',
  });
  const [submittingUser, setSubmittingUser] = useState(false);
  // ==========================================
  // PROMOTIONS MODULE STATE
  // ==========================================
  const [promoSubject, setPromoSubject] = useState(EMAIL_TEMPLATES.sale.subject);
  const [promoHtml, setPromoHtml] = useState(EMAIL_TEMPLATES.sale.html);
  const [editorView, setEditorView] = useState('code'); // 'code' | 'preview'
  const [selectedEmails, setSelectedEmails] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [sendingPromo, setSendingPromo] = useState(false);
  // Fetch registered users list from backend
  const fetchUsers = async (token, isManual = false) => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/admin/users', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error('Failed to fetch registered users list');
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setUsers(data.data);
        if (isManual) {
          triggerToast(`Data refreshed! ${data.data.length} registered users loaded.`, 'success');
        }
      }
    } catch (err) {
      if (isManual) {
        triggerToast(err.message || 'Error refreshing users list', 'error');
      } else {
        setAlert({ type: 'error', message: err.message || 'Error loading users' });
      }
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    const storedUser = localStorage.getItem('admin_user');
    if (!token) {
      router.push('/login');
      return;
    }
    setToken(token);
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        if (parsed.role !== 'ADMIN') {
          router.push('/dashboard/user');
          return;
        }
        setCurrentUser(parsed);
      } catch (e) {
        // Fallback
      }
    }
    // Verify session & role with backend
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then((data) => {
        if (data.user) {
          const roleName = data.user.role || (data.user.role_id && data.user.role_id.name);
          if (roleName !== 'ADMIN') {
            const currentLocalUser = JSON.parse(localStorage.getItem('admin_user') || '{}');
            if (currentLocalUser.role === 'ADMIN') {
              return;
            }
            router.push('/dashboard/user');
            return;
          }
          setCurrentUser(data.user);
        }
      })
      .catch(() => {
        if (!storedUser) {
          localStorage.removeItem('admin_token');
          router.push('/login');
        }
      });
    // Fetch live users
    fetchUsers(token).finally(() => setLoading(false));
  }, [router]);

  // Fetch pending refunds count badge
  useEffect(() => {
    if (token) {
      fetch('/api/payments/admin/refunds?status=requested', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.metrics?.pendingRefunds !== undefined) {
            setPendingRefundsCount(data.metrics.pendingRefunds);
          }
        })
        .catch(() => {});
    }
  }, [token]);
  // Handle Logout
  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };
  // Handle Delete User
  const handleDeleteUser = async (userId, userName) => {
    if (!confirm(`Are you sure you want to delete user "${userName}"?`)) {
      return;
    }
    const token = localStorage.getItem('admin_token');
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to delete user');
      }
      setUsers((prev) => prev.filter((u) => u._id !== userId));
      setSelectedEmails((prev) => prev.filter((email) => email !== data.email));
      triggerToast(`User "${userName}" was deleted successfully.`, 'success');
    } catch (err) {
      triggerToast(err.message || 'Failed to delete user', 'error');
    }
  };
  // Handle Create New User
  const handleCreateUser = async (e) => {
    e.preventDefault();
    setSubmittingUser(true);
    const token = localStorage.getItem('admin_token');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newUserForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to register new user');
      }
      setUsers((prev) => [data.data, ...prev]);
      setIsAddModalOpen(false);
      setNewUserForm({ name: '', email: '', password: '', role: 'USER' });
      triggerToast(`New user "${data.data.name}" added successfully.`, 'success');
    } catch (err) {
      triggerToast(err.message || 'Failed to add user', 'error');
    } finally {
      setSubmittingUser(false);
    }
  };
  // ==========================================
  // CUSTOMER RECIPIENTS COMPUTATION
  // ==========================================
  // All customers (users with role USER)
  const customers = useMemo(() => {
    return users.filter((u) => {
      const r = (u.role_id?.name || u.role || 'USER').toUpperCase();
      return r === 'USER' || r === 'CUSTOMER';
    });
  }, [users]);
  // Filtered recipients in Promotions sidebar
  const filteredRecipients = useMemo(() => {
    if (!recipientSearch) return customers;
    const q = recipientSearch.toLowerCase();
    return customers.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
    );
  }, [customers, recipientSearch]);
  // Check if all filtered customers are selected
  const isAllSelected =
    filteredRecipients.length > 0 &&
    filteredRecipients.every((c) => selectedEmails.includes(c.email));
  // Toggle Select All customers
  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      // Unselect all in current filtered view
      const filteredSet = new Set(filteredRecipients.map((c) => c.email));
      setSelectedEmails((prev) => prev.filter((e) => !filteredSet.has(e)));
    } else {
      // Add all in current filtered view
      const allFilteredEmails = filteredRecipients.map((c) => c.email);
      setSelectedEmails((prev) => [...new Set([...prev, ...allFilteredEmails])]);
    }
  };
  // Toggle single customer selection
  const handleToggleRecipient = (email) => {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  };
  // Load a pre-built template
  const handleApplyTemplate = (key) => {
    const tmpl = EMAIL_TEMPLATES[key];
    if (tmpl) {
      setPromoSubject(tmpl.subject);
      setPromoHtml(tmpl.html);
    }
  };
  // Submit & Dispatch Promotional Email
  const handleSendPromotion = async () => {
    if (selectedEmails.length === 0) {
      triggerToast('Please select at least one customer to receive this email.', 'error');
      return;
    }
    if (!promoSubject.trim()) {
      triggerToast('Please provide an email subject.', 'error');
      return;
    }
    if (!promoHtml.trim()) {
      triggerToast('Please provide HTML content for the email.', 'error');
      return;
    }
    if (!confirm(`Are you ready to send this promotional email to ${selectedEmails.length} customer(s)?`)) {
      return;
    }
    setSendingPromo(true);
    const token = localStorage.getItem('admin_token');
    try {
      const res = await fetch('/api/admin/promotions/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: promoSubject,
          htmlContent: promoHtml,
          recipientEmails: selectedEmails,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to send promotion');
      }
      triggerToast(data.message || `Promotion sent successfully to ${selectedEmails.length} customer(s)!`, 'success');
    } catch (err) {
      triggerToast(err.message || 'Failed to send email promotion.', 'error');
    } finally {
      setSendingPromo(false);
    }
  };
  // Filtered Users table computation
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const roleName = (user.role_id?.name || user.role || '').toUpperCase();
      const matchesRole =
        roleFilter === 'ALL' ||
        (roleFilter === 'CUSTOMER' && (roleName === 'USER' || roleName === 'CUSTOMER')) ||
        (roleFilter === 'ADMIN' && roleName === 'ADMIN');
      const matchesSearch =
        !searchQuery ||
        user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesRole && matchesSearch;
    });
  }, [users, roleFilter, searchQuery]);
  // Metric counts
  const totalCount = users.length;
  const customerCount = customers.length;
  const adminCount = users.filter((u) => {
    const r = (u.role_id?.name || u.role || '').toUpperCase();
    return r === 'ADMIN';
  }).length;
  if (loading && !currentUser) {
    return (
      <div className={styles.container}>
        <div className={styles.card} style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
          Loading Admin Dashboard & Modules...
        </div>
      </div>
    );
  }
  return (
    <div className={styles.container}>
      {/* Floating Toaster */}
      {toast && (
        <div className={styles.toastContainer}>
          <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : toast.type === 'info' ? styles.toastInfo : styles.toastSuccess}`}>
            <div className={styles.toastLeft}>
              <div className={`${styles.toastIcon} ${toast.type === 'error' ? styles.toastIconError : toast.type === 'info' ? styles.toastIconInfo : styles.toastIconSuccess}`}>
                {toast.type === 'error' ? '✕' : toast.type === 'info' ? 'ℹ' : '✓'}
              </div>
              <span className={styles.toastMessage}>{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className={styles.toastCloseBtn}
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className={styles.card}>
        {/* Top Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.headerTitle}>Admin Panel</h1>
            <span className={styles.adminBadge}>Super Admin</span>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.adminInfo}>
              <div className={styles.adminName}>{currentUser?.name || 'Administrator'}</div>
              <div>{currentUser?.email}</div>
            </div>
            <button type="button" onClick={handleLogout} className={styles.logoutButton}>
              Logout
            </button>
          </div>
        </div>
        {/* Module Tabs Navigation */}
        <div className={styles.tabsNav}>
          {canViewUsers && (
            <button
              type="button"
              onClick={() => handleTabChange('USERS')}
              className={`${styles.tabBtn} ${activeTab === 'USERS' ? styles.tabBtnActive : ''}`}
            >
              👥 Users Directory
              <span className={styles.tabBadge}>{totalCount}</span>
            </button>
          )}
          {canViewPromotions && (
            <button
              type="button"
              onClick={() => handleTabChange('PROMOTIONS')}
              className={`${styles.tabBtn} ${activeTab === 'PROMOTIONS' ? styles.tabBtnActive : ''}`}
            >
              📢 Promotions & Marketing
              <span className={styles.tabBadge}>{customerCount} Customers</span>
            </button>
          )}
          {canViewProducts && (
            <button
              type="button"
              onClick={() => handleTabChange('PRODUCTS')}
              className={`${styles.tabBtn} ${activeTab === 'PRODUCTS' ? styles.tabBtnActive : ''}`}
            >
              📦 Products Management
              <span className={styles.tabBadge}>{productsCount}</span>
            </button>
          )}

          {canViewDeliveryZones && (
            <button
              type="button"
              onClick={() => handleTabChange('ZONES')}
              className={`${styles.tabBtn} ${activeTab === 'ZONES' ? styles.tabBtnActive : ''}`}
            >
              🗺️ Delivery Zones
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => handleTabChange('REFUNDS')}
              className={`${styles.tabBtn} ${activeTab === 'REFUNDS' ? styles.tabBtnActive : ''}`}
            >
              📦 Orders & Refunds
              {pendingRefundsCount > 0 ? (
                <span
                  className={styles.tabBadge}
                  style={{ background: '#f59e0b', color: '#ffffff', fontWeight: 800 }}
                >
                  {pendingRefundsCount} Pending
                </span>
              ) : (
                <span className={styles.tabBadge}>0</span>
              )}
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => handleTabChange('SIMULATOR')}
              className={`${styles.tabBtn} ${activeTab === 'SIMULATOR' ? styles.tabBtnActive : ''}`}
            >
              🛵 GPS Simulator
            </button>
          )}
        </div>
        {/* Body Content */}
        <div className={styles.body}>
          {/* Notification Alert Banner */}
          {alert && (
            <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
              <span>{alert.message}</span>
              <button onClick={() => setAlert(null)} className={styles.alertClose}>×</button>
            </div>
          )}
          {/* TAB 1: USERS DIRECTORY */}
          {activeTab === 'USERS' && (
            <>
              {/* Quick Metrics */}
              <div className={styles.statsGrid}>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Total Registered</div>
                  <div className={`${styles.statValue} ${styles.statValueBlue}`}>{totalCount}</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Customers / Users</div>
                  <div className={`${styles.statValue} ${styles.statValueGreen}`}>{customerCount}</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Administrators</div>
                  <div className={`${styles.statValue} ${styles.statValuePurple}`}>{adminCount}</div>
                </div>
              </div>
              {/* Users Header & Toolbar */}
              <div className={styles.moduleHeader}>
                <div className={styles.moduleTitleSection}>
                  <h2 className={styles.moduleTitle}>Registered Customers & Users Directory</h2>
                  <span className={styles.countPill}>{filteredUsers.length}</span>
                </div>
                <div className={styles.toolbar}>
                  {/* Search Bar */}
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={styles.searchInput}
                  />
                  {/* Role Filter */}
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className={styles.selectFilter}
                  >
                    <option value="ALL">All Roles</option>
                    <option value="CUSTOMER">Customers (Users)</option>
                    <option value="ADMIN">Admins Only</option>
                  </select>
                  {/* Refresh Button */}
                  <button
                    type="button"
                    onClick={() => fetchUsers(localStorage.getItem('admin_token'), true)}
                    disabled={refreshing}
                    className={styles.secondaryBtn}
                    title="Refresh list"
                  >
                    {refreshing ? 'Refreshing...' : '↻ Refresh'}
                  </button>
                  {/* Add Customer Button */}
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(true)}
                    className={styles.primaryBtn}
                  >
                    + Add Customer
                  </button>
                </div>
              </div>
              {/* Data Table */}
              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Customer / User</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Verification</th>
                      <th>Joined Date</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className={styles.emptyState}>
                            <div className={styles.emptyTitle}>No registered users found</div>
                            <div className={styles.emptyDesc}>
                              {searchQuery || roleFilter !== 'ALL'
                                ? 'Try clearing your search query or role filter.'
                                : 'Registered customers will automatically appear here.'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const roleName = (u.role_id?.name || u.role || 'USER').toUpperCase();
                        const isSuperAdmin = roleName === 'ADMIN';
                        const createdDate = u.createdAt
                          ? new Date(u.createdAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                          : 'N/A';
                        return (
                          <tr key={u._id}>
                            <td className={styles.userName}>{u.name}</td>
                            <td className={styles.userEmail}>{u.email}</td>
                            <td>
                              <span className={isSuperAdmin ? styles.roleAdmin : styles.roleUser}>
                                {isSuperAdmin ? 'ADMIN' : 'CUSTOMER'}
                              </span>
                            </td>
                            <td>
                              {u.isEmailVerified ? (
                                <span className={styles.statusVerified}>Verified</span>
                              ) : (
                                <span className={styles.statusPending}>Pending</span>
                              )}
                            </td>
                            <td style={{ color: '#64748b' }}>{createdDate}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u._id, u.name)}
                                className={styles.deleteBtn}
                                title="Delete User"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {/* TAB 2: PROMOTIONS MODULE */}
          {activeTab === 'PROMOTIONS' && (
            <div className={styles.promoContainer}>
              <div className={styles.promoHeader}>
                <div>
                  <h2 className={styles.promoTitle}>Customer Promotions & Email Broadcasts</h2>
                  <div className={styles.promoSubtitle}>
                    Compose rich HTML marketing emails and deliver them to all or selected registered customers.
                  </div>
                </div>
              </div>
              <div className={styles.promoGrid}>
                {/* Left Column: Email Composer */}
                <div className={styles.editorCard}>
                  {/* Subject Input */}
                  <label className={styles.formLabel}>Email Subject</label>
                  <input
                    type="text"
                    placeholder="Enter email subject line..."
                    value={promoSubject}
                    onChange={(e) => setPromoSubject(e.target.value)}
                    className={styles.subjectInput}
                  />
                  {/* Header row with templates */}
                  <div className={styles.editorHeaderRow}>
                    <label className={styles.formLabel} style={{ marginBottom: 0 }}>
                      Email Body Content
                    </label>
                    <div className={styles.templatePills}>
                      <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center' }}>Presets:</span>
                      <button
                        type="button"
                        onClick={() => handleApplyTemplate('sale')}
                        className={styles.templatePill}
                      >
                        Flash Sale
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyTemplate('welcome')}
                        className={styles.templatePill}
                      >
                        Welcome Offer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyTemplate('announcement')}
                        className={styles.templatePill}
                      >
                        Announcement
                      </button>
                    </div>
                  </div>
                  {/* Toggle View: HTML Code vs Live Preview */}
                  <div className={styles.viewToggleBar}>
                    <button
                      type="button"
                      onClick={() => setEditorView('code')}
                      className={`${styles.viewToggleBtn} ${editorView === 'code' ? styles.viewToggleBtnActive : ''}`}
                    >
                      &lt;/&gt; HTML Code Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorView('preview')}
                      className={`${styles.viewToggleBtn} ${editorView === 'preview' ? styles.viewToggleBtnActive : ''}`}
                    >
                      👁 Live Email Preview
                    </button>
                  </div>
                  {/* Editor or Preview Pane */}
                  {editorView === 'code' ? (
                    <textarea
                      value={promoHtml}
                      onChange={(e) => setPromoHtml(e.target.value)}
                      placeholder="Paste or write your HTML template here..."
                      className={styles.htmlTextarea}
                    />
                  ) : (
                    <div
                      className={styles.previewFrame}
                      dangerouslySetInnerHTML={{ __html: promoHtml }}
                    />
                  )}
                </div>
                {/* Right Column: Customer Checklist & Multi-Selector */}
                <div className={styles.recipientsCard}>
                  <div className={styles.recipientsHeader}>
                    <h3 className={styles.recipientsTitle}>Target Customers</h3>
                    <span className={styles.selectionCountBadge}>
                      {selectedEmails.length} of {customers.length} Selected
                    </span>
                  </div>
                  {/* Quick search customers */}
                  <input
                    type="text"
                    placeholder="Search customers to add..."
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                    className={styles.recipientFilterInput}
                  />
                  {/* Select All Row */}
                  <div className={styles.selectAllContainer}>
                    <label className={styles.selectAllLabel}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleToggleSelectAll}
                        className={styles.selectAllCheckbox}
                      />
                      <span>Select All Customers ({filteredRecipients.length})</span>
                    </label>
                    {selectedEmails.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedEmails([])}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {/* Scrollable Recipients List */}
                  <div className={styles.recipientsScrollArea}>
                    {filteredRecipients.length === 0 ? (
                      <div style={{ padding: '30px 16px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                        No registered customers match your search.
                      </div>
                    ) : (
                      filteredRecipients.map((customer) => {
                        const isSelected = selectedEmails.includes(customer.email);
                        const initial = (customer.name || 'C')[0].toUpperCase();
                        return (
                          <div
                            key={customer._id}
                            onClick={() => handleToggleRecipient(customer.email)}
                            className={styles.recipientRow}
                          >
                            <div className={styles.recipientInfo}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => { }} // Handled by row click
                                className={styles.selectAllCheckbox}
                              />
                              <div className={styles.recipientAvatar}>{initial}</div>
                              <div className={styles.recipientDetails}>
                                <span className={styles.recipientName}>{customer.name}</span>
                                <span className={styles.recipientEmail}>{customer.email}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {/* Send Mail Action */}
                  <div className={styles.sendActionBar}>
                    <button
                      type="button"
                      onClick={handleSendPromotion}
                      disabled={sendingPromo || selectedEmails.length === 0}
                      className={styles.sendBtn}
                    >
                      {sendingPromo ? 'Sending Promotion...' : `✉ Send Mail (${selectedEmails.length})`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* TAB 3: PRODUCTS MANAGEMENT */}
          {activeTab === 'PRODUCTS' && canViewProducts && (
            <ProductsManager
              token={token}
              triggerToast={triggerToast}
              onCountChange={setProductsCount}
            />
          )}

          {/* TAB 4: REFUND REQUESTS & STRIPE REFUNDS */}
          {activeTab === 'REFUNDS' && isAdmin && (
            <RefundsManager
              token={token}
              triggerToast={triggerToast}
              onPendingCountChange={setPendingRefundsCount}
            />
          )}

          {/* TAB 5: DELIVERY ZONE MANAGEMENT */}
          {activeTab === 'ZONES' && canViewDeliveryZones && (
            <DeliveryZoneManager
              token={token}
              triggerToast={triggerToast}
            />
          )}

          {/* TAB 6: DELIVERY GPS SIMULATOR (DEV TOOL) */}
          {activeTab === 'SIMULATOR' && isAdmin && (
            <DeliverySimulator token={token} />
          )}
        </div>
      </div>
      {/* Add User Modal */}
      {isAddModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsAddModalOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Register New Customer</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className={styles.modalClose}
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={handleCreateUser}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <div className={styles.modalBody}>
                <div className={styles.modalFormGroup}>
                  <label className={styles.modalLabel}>Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    value={newUserForm.name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                    className={styles.modalInput}
                  />
                </div>
                <div className={styles.modalFormGroup}>
                  <label className={styles.modalLabel}>Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. customer@example.com"
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                    className={styles.modalInput}
                  />
                </div>
                <div className={styles.modalFormGroup}>
                  <label className={styles.modalLabel}>Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Minimum 6 characters"
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    className={styles.modalInput}
                  />
                </div>
                <div className={styles.modalFormGroup}>
                  <label className={styles.modalLabel}>Assigned Role</label>
                  <select
                    value={newUserForm.role}
                    onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                    className={styles.modalSelect}
                  >
                    <option value="USER">Customer / Regular User</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className={styles.secondaryBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className={styles.primaryBtn}
                >
                  {submittingUser ? 'Registering...' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
