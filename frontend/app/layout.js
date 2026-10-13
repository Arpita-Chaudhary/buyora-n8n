import { Inter } from 'next/font/google';
import './globals.css';
import PwaManager from '../components/PwaManager';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: 'Buyora & Admin Panel',
  description: 'Buyora Online Store and Admin Panel connected to Node.js backend',
  openGraph: {
    title: 'Buyora - Quick Commerce Store & Delivery',
    description: 'Products delivered in 30 minutes with live GPS order tracking.',
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://buyora.com',
    siteName: 'Buyora',
    images: [
      {
        url: '/icons/icon-512.png',
        width: 512,
        height: 512,
        alt: 'Buyora App Logo',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Buyora - Quick Commerce Store & Delivery',
    description: 'Products delivered in 30 minutes with live GPS order tracking.',
    images: ['/icons/icon-512.png'],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        {/* PWA Manager: activates manifest, meta tags, and SW strictly on Customer routes */}
        <PwaManager />
      </body>
    </html>
  );
}