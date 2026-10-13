'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './productDetails.module.css';
import { useCart } from '../../../utils/cart';
import CustomerNavbar from '../../../components/CustomerNavbar';
import { getStoredAuth } from '../../../utils/auth';

export default function ProductDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  // Quantity selector state (min: 1, max: product.quantity)
  const [selectedQuantity, setSelectedQuantity] = useState(1);

  // Customer Cart from shared hook
  const { cart, totalCount, addItem, updateQty, removeItem } = useCart();
  const [isCartOpen, setIsCartOpen] = useState(false);

  // UI feedback states
  const [toastMessage, setToastMessage] = useState(null);
  const [isAddedFeedback, setIsAddedFeedback] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // 1. Load user session on mount
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

  // 2. Fetch single product by ID from existing backend API
  const fetchProductDetails = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const token = typeof window !== 'undefined' ? getStoredAuth().token : null;
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/products/${id}`, {
        headers,
      });

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Failed to load product (HTTP ${res.status})`);
      }

      const data = await res.json();
      if (data.success && data.data) {
        setProduct(data.data);
        setSelectedQuantity(data.data.quantity > 0 ? 1 : 0);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred while loading product details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProductDetails();
  }, [fetchProductDetails]);

  // Toast feedback helper
  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // 3. Quantity Selector Controls
  // Minimum quantity = 1, Maximum quantity = available stock
  const handleDecrement = () => {
    if (!product || product.quantity <= 0) return;
    setSelectedQuantity((prev) => Math.max(1, prev - 1));
  };

  const handleIncrement = () => {
    if (!product || product.quantity <= 0) return;
    setSelectedQuantity((prev) => Math.min(product.quantity, prev + 1));
  };

  const handleQuantityInputChange = (e) => {
    if (!product || product.quantity <= 0) return;
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1) {
      setSelectedQuantity(1);
    } else {
      setSelectedQuantity(Math.min(product.quantity, Math.max(1, val)));
    }
  };

  // 4. Add to Cart Handler (supports multiple distinct products)
  const handleAddToCart = () => {
    if (!product || product.quantity <= 0) return;

    const qtyToAdd = Math.max(1, Math.min(selectedQuantity, product.quantity));
    addItem(product, qtyToAdd);
    setIsAddedFeedback(true);
    setTimeout(() => setIsAddedFeedback(null), 1400);
    showToast(`Added ${qtyToAdd} × "${product.title}" to cart!`);
  };

  // Cart Drawer actions
  const handleCartQtyChange = (productId, delta) => {
    const newCart = cart
      .map((item) => {
        if (item._id === productId) {
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) return null;
          return {
            ...item,
            quantity: Math.min(nextQty, item.maxStock || 999),
          };
        }
        return item;
      })
      .filter(Boolean);

    updateCart(newCart);
  };

  const handleRemoveFromCart = (productId) => {
    const newCart = cart.filter((item) => item._id !== productId);
    updateCart(newCart);
  };

  const totalCartCount = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.quantity, 0);
  }, [cart]);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  }, [cart]);

  const isOutOfStock = !product || !product.quantity || product.quantity <= 0;
  const isLowStock = !isOutOfStock && product.quantity <= 5;

  return (
    <div className={styles.pageContainer}>
      {/* ------------------------------------------------------------------
          1. Storefront Navigation Bar
          ------------------------------------------------------------------ */}
      <CustomerNavbar />

      {/* ------------------------------------------------------------------
          2. Breadcrumbs & "Back to Products" Navigation
          ------------------------------------------------------------------ */}
      <div className={styles.topNavContainer}>
        <Link href="/products" className={styles.backButton}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Back to Products</span>
        </Link>

        <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
          <Link href="/products" className={styles.breadcrumbLink}>
            Store
          </Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          <Link href="/products" className={styles.breadcrumbLink}>
            Products
          </Link>
          {product && (
            <>
              <span className={styles.breadcrumbSeparator}>/</span>
              <span className={styles.breadcrumbActive}>{product.title}</span>
            </>
          )}
        </nav>
      </div>

      {/* ------------------------------------------------------------------
          3. Main Showcase Area
          ------------------------------------------------------------------ */}
      <main className={styles.mainShowcase}>
        {/* Loading State Skeleton */}
        {loading && (
          <div className={styles.skeletonCard}>
            <div className={styles.skeletonImage} />
            <div className={styles.skeletonInfo}>
              <div className={styles.skeletonLine} style={{ width: '30%' }} />
              <div className={styles.skeletonLine} style={{ width: '70%', height: '32px' }} />
              <div className={styles.skeletonLine} style={{ width: '40%', height: '28px' }} />
              <div className={styles.skeletonLine} style={{ width: '90%' }} />
              <div className={styles.skeletonLine} style={{ width: '85%' }} />
              <div className={styles.skeletonLine} style={{ width: '60%' }} />
              <div style={{ marginTop: 'auto', display: 'flex', gap: '16px' }}>
                <div className={styles.skeletonLine} style={{ width: '120px', height: '44px' }} />
                <div className={styles.skeletonLine} style={{ flex: 1, height: '44px' }} />
              </div>
            </div>
          </div>
        )}

        {/* Product Not Found State */}
        {!loading && notFound && (
          <div className={styles.stateContainer}>
            <div className={`${styles.stateIcon} ${styles.stateIconNotFound}`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h1 className={styles.stateTitle}>Product Not Found</h1>
            <p className={styles.stateMessage}>
              The product you are looking for does not exist, has been removed, or is currently unavailable to customers.
            </p>
            <Link href="/products" className={styles.actionButton}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Explore All Products</span>
            </Link>
          </div>
        )}

        {/* Error State */}
        {!loading && !notFound && error && (
          <div className={styles.stateContainer}>
            <div className={`${styles.stateIcon} ${styles.stateIconError}`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h1 className={styles.stateTitle}>Unable to Load Product</h1>
            <p className={styles.stateMessage}>{error}</p>
            <button type="button" className={styles.actionButton} onClick={fetchProductDetails}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              <span>Try Again</span>
            </button>
          </div>
        )}

        {/* Product Details Presentation */}
        {!loading && !notFound && !error && product && (
          <article className={styles.detailsCard}>
            {/* Gallery Column */}
            <div className={styles.gallerySection}>
              {product.category && (
                <span className={styles.categoryFloatingTag}>{product.category}</span>
              )}
              <div className={styles.imageFrame}>
                {product.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.image}
                    alt={product.title}
                    className={styles.heroImage}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}

                {/* Fallback Placeholder */}
                <div
                  className={styles.imagePlaceholder}
                  style={{ display: product.image ? 'none' : 'flex' }}
                >
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                  <span>No Product Image</span>
                </div>
              </div>
            </div>

            {/* Info & Purchase Column */}
            <div className={styles.infoSection}>
              {/* Badges Row */}
              <div className={styles.headerBadgesRow}>
                {product.category && (
                  <span className={styles.categoryBadge}>{product.category}</span>
                )}
                <span
                  className={
                    product.status === 'active'
                      ? styles.statusBadgeActive
                      : styles.statusBadgeInactive
                  }
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: product.status === 'active' ? '#16a34a' : '#dc2626',
                    }}
                  />
                  {product.status === 'active' ? 'Active Product' : 'Inactive'}
                </span>
              </div>

              {/* Title */}
              <h1 className={styles.productTitle}>{product.title}</h1>

              {/* Price */}
              <div className={styles.priceContainer}>
                <span className={styles.priceLabel}>Price:</span>
                <span className={styles.priceValue}>
                  ₹{Number(product.price).toFixed(2)}
                </span>
              </div>

              {/* Stock Status Panel */}
              <div className={styles.stockPanel}>
                <span className={styles.stockStatusLabel}>Availability:</span>
                <span
                  className={`${styles.stockStatusValue} ${
                    isOutOfStock
                      ? styles.stockZero
                      : isLowStock
                      ? styles.stockLowAlert
                      : styles.stockPositive
                  }`}
                >
                  <span
                    className={`${styles.stockDot} ${
                      isOutOfStock
                        ? styles.dotRed
                        : isLowStock
                        ? styles.dotAmber
                        : styles.dotGreen
                    }`}
                  />
                  {isOutOfStock
                    ? 'Out of Stock (0 units)'
                    : isLowStock
                    ? `Low Stock: Only ${product.quantity} remaining!`
                    : `In Stock (${product.quantity} units available)`}
                </span>
              </div>

              {/* Description */}
              <div className={styles.descriptionBox}>
                <div className={styles.sectionHeading}>Product Description</div>
                <div className={styles.fullDescription}>
                  {product.description || 'No detailed description available for this item.'}
                </div>
              </div>

              {/* Purchase Controls: Quantity Selector & Add to Cart */}
              <div className={styles.purchaseControls}>
                {/* Quantity Row */}
                <div className={styles.qtyRow}>
                  <label htmlFor="quantity-input" className={styles.qtyLabel}>
                    Quantity:
                  </label>
                  <div className={styles.qtySelector}>
                    <button
                      type="button"
                      className={styles.qtyBtn}
                      onClick={handleDecrement}
                      disabled={isOutOfStock || selectedQuantity <= 1}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <input
                      id="quantity-input"
                      type="number"
                      className={styles.qtyInput}
                      value={isOutOfStock ? 0 : selectedQuantity}
                      min="1"
                      max={product.quantity}
                      onChange={handleQuantityInputChange}
                      disabled={isOutOfStock}
                    />
                    <button
                      type="button"
                      className={styles.qtyBtn}
                      onClick={handleIncrement}
                      disabled={isOutOfStock || selectedQuantity >= product.quantity}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Maximum Stock Note */}
                {!isOutOfStock && product.quantity > 0 && (
                  <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'right' }}>
                    Max quantity allowed: <strong>{product.quantity}</strong>
                  </div>
                )}

                {/* Action Buttons */}
                <div className={styles.actionButtonsContainer}>
                  <button
                    type="button"
                    className={`${styles.addToCartButton} ${
                      isAddedFeedback ? styles.addedSuccess : ''
                    }`}
                    disabled={isOutOfStock}
                    onClick={handleAddToCart}
                  >
                    {isAddedFeedback ? (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Added to Cart!</span>
                      </>
                    ) : isOutOfStock ? (
                      <span>Out of Stock</span>
                    ) : (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1"></circle>
                          <circle cx="20" cy="21" r="1"></circle>
                          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                        </svg>
                        <span>
                          Add {selectedQuantity > 1 ? `${selectedQuantity} items` : 'to Cart'} • ₹{(
                            product.price * selectedQuantity
                          ).toFixed(2)}
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {/* Trust Signals */}
                <div className={styles.trustBar}>
                  <div className={styles.trustItem}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
                      <rect x="1" y="3" width="15" height="13"></rect>
                      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                      <circle cx="5.5" cy="18.5" r="2.5"></circle>
                      <circle cx="18.5" cy="18.5" r="2.5"></circle>
                    </svg>
                    <div><span>Fast Shipping</span><br />Direct Delivery</div>
                  </div>
                  <div className={styles.trustItem}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                    <div><span>Verified Stock</span><br />Real-time Sync</div>
                  </div>
                  <div className={styles.trustItem}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </svg>
                    <div><span>Easy Returns</span><br />30-Day Guarantee</div>
                  </div>
                </div>
              </div>
            </div>
          </article>
        )}
      </main>

      {/* ------------------------------------------------------------------
          4. Slide-Out Shopping Cart Drawer
          ------------------------------------------------------------------ */}
      {isCartOpen && (
        <div className={styles.drawerBackdrop} onClick={() => setIsCartOpen(false)}>
          <div className={styles.cartDrawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div className={styles.drawerTitle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="9" cy="21" r="1"></circle>
                  <circle cx="20" cy="21" r="1"></circle>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
                <span>Your Cart ({totalCartCount})</span>
              </div>
              <button
                type="button"
                className={styles.drawerCloseBtn}
                onClick={() => setIsCartOpen(false)}
                aria-label="Close cart"
              >
                ✕
              </button>
            </div>

            <div className={styles.drawerBody}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: '#64748b' }}>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                  </svg>
                  <p style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b' }}>Your cart is empty</p>
                  <p style={{ fontSize: '13px', marginTop: '4px' }}>
                    Browse our products and add your favorite items to get started.
                  </p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item._id} className={styles.cartItem}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image || '/placeholder.png'}
                      alt={item.title}
                      className={styles.cartItemImg}
                      onError={(e) => {
                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" fill="%23e2e8f0"><rect width="60" height="60"/></svg>';
                      }}
                    />
                    <div className={styles.cartItemDetails}>
                      <div className={styles.cartItemTitle}>{item.title}</div>
                      <div className={styles.cartItemPrice}>
                        ₹{(item.price * item.quantity).toFixed(2)}
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, marginLeft: '6px' }}>
                          (₹{Number(item.price).toFixed(2)} ea)
                        </span>
                      </div>
                      <div className={styles.cartItemQtyControl}>
                        <button
                          type="button"
                          className={styles.drawerQtyBtn}
                          onClick={() => handleCartQtyChange(item._id, -1)}
                        >
                          −
                        </button>
                        <span className={styles.drawerQtyNumber}>{item.quantity}</span>
                        <button
                          type="button"
                          className={styles.drawerQtyBtn}
                          disabled={item.quantity >= item.maxStock}
                          onClick={() => handleCartQtyChange(item._id, 1)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className={styles.cartItemRemove}
                          onClick={() => handleRemoveFromCart(item._id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className={styles.drawerFooter}>
                <div className={styles.subtotalRow}>
                  <span>Subtotal:</span>
                  <span>₹{cartSubtotal.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  className={styles.checkoutBtn}
                  onClick={() => {
                    showToast('Proceeding to checkout...');
                  }}
                >
                  Checkout (₹{cartSubtotal.toFixed(2)})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          5. Toast Notification
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
