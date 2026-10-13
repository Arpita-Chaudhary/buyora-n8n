'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import InstallPrompt from './InstallPrompt';

/**
 * PwaManager:
 * Strictly manages PWA assets and Service Worker registration.
 *
 * CUSTOMER PANEL:
 *   - Injects /manifest.json link
 *   - Injects apple & theme meta tags
 *   - Registers /sw.js service worker
 *   - Displays InstallPrompt banner
 *
 * ADMIN & RIDER PANELS (/dashboard/*, /rider/*, /simulator/*):
 *   - Removes any manifest link so Chrome treats them as a normal website
 *   - Never registers any service worker
 *   - Never displays InstallPrompt
 */
export default function PwaManager() {
  const pathname = usePathname();
  const [isCustomer, setIsCustomer] = useState(false);

  useEffect(() => {
    if (!pathname) return;

    const isAdminOrRider =
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/rider') ||
      pathname.startsWith('/simulator');

    if (isAdminOrRider) {
      setIsCustomer(false);

      // Remove manifest links so Chrome treats Admin as a normal website
      document.querySelectorAll('link[rel="manifest"]').forEach((el) => el.remove());

      // Remove PWA and Apple mobile web app meta tags
      document
        .querySelectorAll('meta[data-pwa="true"], meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]')
        .forEach((el) => el.remove());

      // Immediately unregister all Service Workers when viewing Admin / Dashboard
      // This ensures Chrome never treats the Admin Panel as installable or part of the PWA
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            reg.unregister();
          }
        });
      }
      return;
    }

    // Customer route: activate PWA tags
    setIsCustomer(true);

    // 1. Ensure Manifest link is present
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = '/manifest.json';
      document.head.appendChild(link);
    }

    // 2. Ensure PWA meta tags are present
    const metaTags = [
      { name: 'theme-color', content: '#1976d2' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Buyora' },
    ];

    metaTags.forEach(({ name, content }) => {
      if (!document.querySelector(`meta[name="${name}"]`)) {
        const meta = document.createElement('meta');
        meta.name = name;
        meta.content = content;
        meta.setAttribute('data-pwa', 'true');
        document.head.appendChild(meta);
      }
    });

    // 3. Register Service Worker for Customer store
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => {
          console.warn('[SW] Registration failed:', err);
        });
    }
  }, [pathname]);

  return isCustomer ? <InstallPrompt /> : null;
}
