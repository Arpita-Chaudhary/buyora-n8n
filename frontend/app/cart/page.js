'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './cart.module.css';
import {
  getCart,
  saveCart,
  updateCartQuantity,
  removeFromCart,
  clearCart,
  getCartTotalCount,
  getCartTotalAmount,
  useCart,
} from '../../utils/cart';
import CustomerNavbar from '../../components/CustomerNavbar';
import { getStoredAuth } from '../../utils/auth';
import { useDeliveryLocation } from '../../utils/deliveryLocation';
import CustomerLocationModal from '../../components/CustomerLocationModal';

export default function CartPage() {
  const router = useRouter();
  const { cart, isLoaded, totalCount, totalAmount, updateQty, removeItem, clear } = useCart();
  const { address, zone, loading: zoneLoading } = useDeliveryLocation();
  const [isLocModalOpen, setIsLocModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState({});
  const [toastMessage, setToastMessage] = useState(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // 1. Load user profile on mount
  useEffect(() => {
    try {
      const auth = getStoredAuth();
      if (auth && auth.user) {
        setCurrentUser(auth.user);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }, []);

  // Toast feedback helper
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  // 2. Validate live stock and availability against backend Product API
  const validateCartItems = useCallback(async () => {
    const currentItems = getCart();
    if (currentItems.length === 0) return;

    setIsValidating(true);
    const warnings = {};
    let cartModified = false;
    let updatedCart = [...currentItems];

    try {
      // Fetch latest active products from backend
      const res = await fetch('/api/products?status=active');
      if (res.ok) {
        const data = await res.json();
        const activeProducts = Array.isArray(data.data) ? data.data : [];
        const activeProductMap = new Map(activeProducts.map((p) => [p._id, p]));

        updatedCart = currentItems.map((item) => {
          const liveProduct = activeProductMap.get(item._id);

          // Case A: Product no longer exists or is inactive in store
          if (!liveProduct) {
            warnings[item._id] = 'This product is currently inactive or no longer available.';
            return {
              ...item,
              isUnavailable: true,
              maxStock: 0,
            };
          }

          // Case B: Product is completely out of stock
          if (liveProduct.quantity <= 0) {
            warnings[item._id] = 'This product is now out of stock.';
            return {
              ...item,
              isUnavailable: true,
              maxStock: 0,
            };
          }

          // Case C: Stock is less than current cart quantity
          if (item.quantity > liveProduct.quantity) {
            warnings[item._id] = `Quantity adjusted to maximum available stock (${liveProduct.quantity}).`;
            cartModified = true;
            return {
              ...item,
              price: liveProduct.price,
              maxStock: liveProduct.quantity,
              quantity: liveProduct.quantity,
              subtotal: liveProduct.price * liveProduct.quantity,
              isUnavailable: false,
            };
          }

          // Case D: Live price or stock update
          if (item.price !== liveProduct.price || item.maxStock !== liveProduct.quantity) {
            cartModified = true;
            return {
              ...item,
              price: liveProduct.price,
              maxStock: liveProduct.quantity,
              subtotal: liveProduct.price * item.quantity,
              isUnavailable: false,
            };
          }

          return {
            ...item,
            isUnavailable: false,
          };
        });

        if (cartModified) {
          saveCart(updatedCart);
        }
      }
    } catch (e) {
      console.warn('Cart live validation failed (offline or network):', e);
    } finally {
      setValidationWarnings(warnings);
      setIsValidating(false);
    }
  }, []);

  useEffect(() => {
    if (isLoaded) {
      validateCartItems();
    }
  }, [isLoaded, validateCartItems]);

  // 3. Handlers for Quantity Modification
  // Minimum: 1, Maximum: available stock
  const handleIncrease = (item) => {
    if (item.isUnavailable) return;
    const maxStock = item.maxStock || 999;
    if (item.quantity >= maxStock) {
      showToast(`Cannot add more. Maximum available stock is ${maxStock}.`);
      return;
    }
    updateQty(item._id, item.quantity + 1);
  };

  const handleDecrease = (item) => {
    if (item.quantity <= 1) {
      // Don't decrease below 1
      return;
    }
    updateQty(item._id, item.quantity - 1);
  };

  const handleRemove = (item) => {
    removeItem(item._id);
    showToast(`Removed "${item.title}" from cart.`);
  };

  const handleClearCart = () => {
    if (window.confirm('Are you sure you want to clear your entire cart?')) {
      clear();
      showToast('Shopping cart cleared.');
    }
  };

  // Delivery fee & Minimum order amount derived from customer's active zone
  const deliveryCharge = useMemo(() => {
    if (zone?.serviceable && zone?.primaryZone) {
      return Number(zone.primaryZone.deliveryCharge) || 0;
    }
    return 0;
  }, [zone]);

  const minOrderAmount = useMemo(() => {
    if (zone?.serviceable && zone?.primaryZone) {
      return Number(zone.primaryZone.minOrderAmount) || 0;
    }
    return 0;
  }, [zone]);

  const isMinOrderMet = useMemo(() => {
    if (minOrderAmount <= 0) return true;
    return totalAmount >= minOrderAmount;
  }, [totalAmount, minOrderAmount]);

  const grandTotal = useMemo(() => {
    return totalAmount + deliveryCharge;
  }, [totalAmount, deliveryCharge]);

  // 4. Checkout Handler - Navigate to customer /checkout page
  const handleProceedToCheckout = () => {
    // Check if cart is empty
    if (cart.length === 0) {
      alert('Your cart is empty. Add products before checking out.');
      return;
    }
    // Check if any unavailable or out-of-stock items exist in cart
    const hasUnavailable = cart.some(
      (i) => i.isUnavailable || (i.maxStock !== undefined && i.maxStock <= 0) || (i.maxStock !== undefined && i.quantity > i.maxStock)
    );
    if (hasUnavailable) {
      alert('Please remove unavailable items or adjust quantities that exceed available stock before proceeding to checkout.');
      return;
    }

    // Check delivery zone serviceability
    if (zone && !zone.serviceable) {
      alert('Service Unreachable: Your selected delivery address is outside our delivery zones. Please select an address within Mohali, Chandigarh, or backend configured zones to proceed.');
      setIsLocModalOpen(true);
      return;
    }

    // Check minimum order amount for this zone
    if (!isMinOrderMet) {
      alert(
        `Minimum order amount for ${zone?.primaryZone?.name || 'this zone'} is ₹${minOrderAmount.toFixed(
          2
        )}. Please add ₹${(minOrderAmount - totalAmount).toFixed(2)} more to proceed.`
      );
      return;
    }

    router.push('/checkout');
  };

  // Check if checkout button should be disabled
  const hasUnavailableItems = useMemo(() => {
    return cart.some((i) => i.isUnavailable || (i.maxStock !== undefined && i.maxStock <= 0));
  }, [cart]);

  return (
    <div className={styles.pageContainer}>
      {/* ------------------------------------------------------------------
          1. Storefront Navigation Bar
          ------------------------------------------------------------------ */}
      <CustomerNavbar />



      {/* ------------------------------------------------------------------
          2. Top Navigation & Action Bar
          ------------------------------------------------------------------ */}
      <div className={styles.topNavContainer}>
        <Link href="/products" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Continue Shopping</span>
        </Link>

        {cart.length > 0 && (
          <button type="button" className={styles.clearCartButton} onClick={handleClearCart}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Clear Cart</span>
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------------
          3. Main Cart View
          ------------------------------------------------------------------ */}
      <main className={styles.mainContainer}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Your Shopping Cart</h1>
          <p className={styles.pageSubtitle}>
            Review your selected products, update quantities, and proceed securely to checkout.
          </p>
        </div>

        {/* Loading State Skeleton */}
        {!isLoaded && (
          <div className={styles.skeletonContainer}>
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        )}

        {/* Empty Cart State */}
        {isLoaded && cart.length === 0 && (
          <div className={styles.emptyCartCard}>
            <div className={styles.emptyIcon}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
            </div>
            <h2 className={styles.emptyTitle}>Your cart is currently empty</h2>
            <p className={styles.emptyMessage}>
              You haven&apos;t added any products to your cart yet. Explore our collection and add your favorite items.
            </p>
            <Link href="/products" className={styles.browseButton}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>Explore Products</span>
            </Link>
          </div>
        )}

        {/* Multiple Products Cart Grid */}
        {isLoaded && cart.length > 0 && (
          <div className={styles.cartGrid}>
            {/* Left Column: Cart Items List */}
            <div className={styles.itemsSection}>
              <div className={styles.itemsHeader}>
                <span className={styles.itemsHeaderTitle}>Cart Items</span>
                <span className={styles.itemsHeaderCount}>
                  {cart.length} distinct {cart.length === 1 ? 'product' : 'products'} ({totalCount} total units)
                </span>
              </div>

              <div className={styles.itemsList}>
                {cart.map((item) => {
                  const subtotal = (Number(item.price) || 0) * (Number(item.quantity) || 0);
                  const isMax = item.maxStock ? item.quantity >= item.maxStock : false;
                  const warning = validationWarnings[item._id];

                  return (
                    <div key={item._id} className={styles.cartItemRow}>
                      {/* Media Group: Image + Info */}
                      <div className={itemMediaGroupStyle(item)}>
                        {/* Thumbnail */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.image || '/placeholder.png'}
                          alt={item.title}
                          className={styles.itemThumbnail}
                          onError={(e) => {
                            e.target.src =
                              'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="%23e2e8f0"><rect width="80" height="80"/></svg>';
                          }}
                        />

                        {/* Title, Category & Product ID */}
                        <div className={styles.itemInfo}>
                          <Link href={`/products/${item._id}`} className={styles.itemTitle}>
                            {item.title}
                          </Link>
                          <span className={styles.itemCategory}>{item.category || 'General'}</span>
                          <span className={styles.itemIdTag}>ID: {item._id}</span>
                          <span className={styles.unitPrice}>
                            ₹{Number(item.price).toFixed(2)} each
                          </span>

                          {/* Graceful alerts for unavailable products or stock reductions */}
                          {item.isUnavailable && (
                            <div className={styles.unavailableAlert}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                              </svg>
                              <span>{warning || 'Product is currently unavailable or out of stock'}</span>
                            </div>
                          )}

                          {!item.isUnavailable && warning && (
                            <div className={styles.stockNoticeAlert}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                              </svg>
                              <span>{warning}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Controls Group: Quantity Controls + Individual Subtotal + Remove */}
                      <div className={styles.itemControlsGroup}>
                        {/* Quantity Controls */}
                        <div className={styles.qtyControl}>
                          <button
                            type="button"
                            className={styles.qtyButton}
                            onClick={() => handleDecrease(item)}
                            disabled={item.quantity <= 1 || item.isUnavailable}
                            aria-label={`Decrease quantity of ${item.title}`}
                          >
                            −
                          </button>
                          <span key={item.quantity} className={styles.qtyDisplay}>
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className={styles.qtyButton}
                            onClick={() => handleIncrease(item)}
                            disabled={isMax || item.isUnavailable}
                            aria-label={`Increase quantity of ${item.title}`}
                          >
                            +
                          </button>
                        </div>

                        {/* Individual Subtotal (price × quantity) */}
                        <div className={styles.subtotalContainer}>
                          <span className={styles.subtotalLabel}>Subtotal</span>
                          <span className={styles.subtotalValue}>
                            ₹{subtotal.toFixed(2)}
                          </span>
                        </div>

                        {/* Remove Button */}
                        <button
                          type="button"
                          className={styles.removeButton}
                          onClick={() => handleRemove(item)}
                          aria-label={`Remove ${item.title} from cart`}
                          title="Remove item"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Order Summary & Checkout */}
            <aside className={styles.summarySection}>
              <h2 className={styles.summaryTitle}>Order Summary</h2>

              {/* Delivery Zone Details Banner */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>
                    Delivery Destination
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsLocModalOpen(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Change
                  </button>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  📍 {address?.label || address?.city || 'Selected Address'}
                </div>

                {zone?.serviceable && zone?.primaryZone ? (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '12px', color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>⚡</span>
                      <span>{zone.primaryZone.name} ({zone.primaryZone.estimatedDeliveryTime || '20-35 mins'})</span>
                    </div>
                    {minOrderAmount > 0 && (
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Min order amount: ₹{minOrderAmount.toFixed(0)}
                      </div>
                    )}
                  </div>
                ) : zone && !zone.serviceable ? (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>
                    ⚠️ Service Unreachable in this location.
                  </div>
                ) : null}
              </div>

              {/* Minimum Order Warning Alert */}
              {zone?.serviceable && !isMinOrderMet && (
                <div style={{
                  background: '#fffbeb',
                  border: '1px solid #fef3c7',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '16px',
                  fontSize: '12.5px',
                  color: '#92400e',
                  lineHeight: '1.4',
                }}>
                  <strong>⚠️ Minimum Order: ₹{minOrderAmount.toFixed(0)}</strong>
                  <div>
                    Add <strong>₹{(minOrderAmount - totalAmount).toFixed(2)}</strong> more to your cart to deliver to {zone.primaryZone.name}.
                  </div>
                </div>
              )}

              {/* Unserviceable Warning Alert */}
              {zone && !zone.serviceable && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fee2e2',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '16px',
                  fontSize: '12.5px',
                  color: '#991b1b',
                  lineHeight: '1.4',
                }}>
                  <strong>⚠️ Service Unreachable</strong>
                  <div>
                    Please select an address within our delivery zones (Mohali, Chandigarh, or backend configured zones) to place your order.
                  </div>
                </div>
              )}

              <div className={styles.summaryRows}>
                <div className={styles.summaryRow}>
                  <span>Total Items</span>
                  <strong>{totalCount} units</strong>
                </div>

                <div className={styles.summaryRow}>
                  <span>Item Subtotal</span>
                  <span>₹{totalAmount.toFixed(2)}</span>
                </div>

                <div className={styles.summaryRow}>
                  <span>Delivery Charge</span>
                  <span style={{ color: deliveryCharge === 0 ? '#16a34a' : '#0f172a', fontWeight: 600 }}>
                    {deliveryCharge === 0 ? 'FREE' : `₹${deliveryCharge.toFixed(2)}`}
                  </span>
                </div>

                <div className={styles.summaryRow}>
                  <span>Estimated Delivery</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>
                    {zone?.primaryZone?.estimatedDeliveryTime || '20-35 mins'}
                  </span>
                </div>

                <div className={styles.summaryRow}>
                  <span>Taxes</span>
                  <span>Calculated at checkout</span>
                </div>

                {/* Grand Total Amount */}
                <div className={styles.summaryRowTotal}>
                  <span>Grand Total</span>
                  <span className={styles.totalAmount}>₹{grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Checkout Action Button */}
              <button
                type="button"
                className={styles.checkoutButton}
                disabled={
                  cart.length === 0 ||
                  hasUnavailableItems ||
                  isCheckingOut ||
                  (zone && !zone.serviceable) ||
                  !isMinOrderMet
                }
                onClick={handleProceedToCheckout}
              >
                {isCheckingOut ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                      <line x1="1" y1="10" x2="23" y2="10"></line>
                    </svg>
                    <span>
                      {zone && !zone.serviceable
                        ? 'Service Unreachable'
                        : !isMinOrderMet
                        ? `Min Order ₹${minOrderAmount.toFixed(0)} Required`
                        : `Proceed to Checkout • ₹${grandTotal.toFixed(2)}`}
                    </span>
                  </>
                )}
              </button>

              {/* Continue Shopping Action */}
              <Link href="/products" className={styles.continueShoppingBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>Continue Shopping</span>
              </Link>
            </aside>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------------
          4. Feedback Toast
          ------------------------------------------------------------------ */}
      {toastMessage && (
        <div className={styles.toast}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
}

function itemMediaGroupStyle(item) {
  return `${styles.itemMediaGroup} ${item.isUnavailable ? styles.itemUnavailableMuted : ''}`;
}
