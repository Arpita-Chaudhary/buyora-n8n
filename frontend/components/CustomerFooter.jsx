'use client';

import React from 'react';
import Link from 'next/link';
import styles from './CustomerFooter.module.css';

export default function CustomerFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footerWrapper}>
      <div className={styles.footerContainer}>
        <div className={styles.footerTop}>
          <div className={styles.brandGroup}>
            <div className={styles.brandName}>
              <span>⚡</span>
              <span>Buyora</span>
            </div>
            <p className={styles.brandTagline}>
              Premium online shopping, delivered straight to your door with real-time tracking.
            </p>
          </div>

          <div className={styles.linksSection}>
            <Link href="/" className={styles.navLink}>Home</Link>
            <Link href="/products" className={styles.navLink}>All Products</Link>
            <Link href="/cart" className={styles.navLink}>My Cart</Link>
            <Link href="/orders" className={styles.navLink}>Orders</Link>
            <Link href="/profile" className={styles.navLink}>Account</Link>
          </div>
        </div>

        <div className={styles.footerDivider} />

        <div className={styles.footerBottom}>
          <div className={styles.paymentNotice}>
            <span>🔒 Secure Card Checkout Powered by</span>
            <span className={styles.stripeBadge}>Stripe</span>
          </div>
          <div>
            © {currentYear} Buyora Inc. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}
