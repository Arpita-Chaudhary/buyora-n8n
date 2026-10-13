'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import CustomerNavbar from '../components/CustomerNavbar';
import { useCart } from '../utils/cart';
import { useDeliveryLocation } from '../utils/deliveryLocation';
import CustomerLocationModal from '../components/CustomerLocationModal';

export default function HomePage() {
  const { addItem, totalCount } = useCart();
  const { address, zone, loading: zoneLoading } = useDeliveryLocation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState({});
  const [isLocModalOpen, setIsLocModalOpen] = useState(false);

  useEffect(() => {
    let retries = 0;
    const loadProducts = () => {
      setLoading(true);
      const url =
        address?.lat && address?.lng
          ? `/api/products?status=active&latitude=${address.lat}&longitude=${address.lng}`
          : '/api/products?status=active';

      fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.success && Array.isArray(data.data)) {
            // Display products deliverable to this location
            setProducts(data.data.slice(0, 8));
            setLoading(false);
          } else if (retries < 2) {
            retries++;
            setTimeout(loadProducts, 1000);
          } else {
            setProducts([]);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (retries < 2) {
            retries++;
            setTimeout(loadProducts, 1000);
          } else {
            console.error('Failed to load products:', err);
            setLoading(false);
          }
        });
    };
    loadProducts();
  }, [address?.lat, address?.lng]);

  const handleAddToCart = (product) => {
    addItem(product, 1);
    setAddedIds((prev) => ({ ...prev, [product._id]: true }));
    setTimeout(() => {
      setAddedIds((prev) => ({ ...prev, [product._id]: false }));
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col text-slate-900">
      {/* 1. Clean Navigation Bar */}
      <CustomerNavbar />

      {/* 2. Engaging Hero Section */}
      <section className="bg-gradient-to-b from-blue-50/70 via-blue-50/30 to-white border-b border-slate-200 py-14 px-5 text-center">
        <div className="max-w-3xl mx-auto flex flex-col items-center gap-4">
          <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
            Your Next Favorite Find Is One Scroll Away
          </h1>
          <p className="text-base sm:text-lg text-slate-500 leading-relaxed max-w-xl">
            Hand-curated products at unbeatable prices — from trending essentials to hidden gems you won&apos;t find anywhere else. Real-time stock. Instant checkout. Delivered to your door.
          </p>
          <div className="flex gap-3.5 mt-2.5 flex-wrap justify-center">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 text-sm sm:text-base rounded-lg shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              <span>Explore the Collection</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </Link>
            <Link
              href="/cart"
              className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-800 font-semibold py-3 px-6 text-sm sm:text-base rounded-lg border border-slate-300 shadow-sm hover:shadow transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
              <span>View Cart ({totalCount})</span>
            </Link>
          </div>
        </div>
      </section>



      {/* 3. Products Section */}
      <main className="max-w-6xl mx-auto px-5 py-11 pb-16 w-full flex-1">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Featured Products</h2>
          <Link
            href="/products"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 transition-transform hover:translate-x-0.5"
          >
            <span>View All Products</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-14 px-5 bg-white border border-slate-200 rounded-xl text-slate-500 shadow-sm">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-sm font-medium">Loading products...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-14 px-5 bg-white border border-slate-200 rounded-xl text-slate-500 shadow-sm">
            <p className="text-base font-medium mb-3">No products available yet.</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 text-sm rounded-lg shadow-sm transition-all"
            >
              Check Catalog
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {products.map((product) => {
              const inStock = product.quantity > 0;
              const isAdded = addedIds[product._id];

              return (
                <div
                  key={product._id}
                  className="group bg-white border border-slate-200 hover:border-slate-300 rounded-xl overflow-hidden flex flex-col shadow-sm hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1"
                >
                  {/* Product Image */}
                  <Link
                    href={`/products/${product._id}`}
                    className="w-full h-48 bg-slate-100 flex items-center justify-center relative overflow-hidden border-b border-slate-200 block"
                  >
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="text-slate-400 flex flex-col items-center gap-1.5 text-xs font-medium">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span>No Image</span>
                      </div>
                    )}
                  </Link>

                  {/* Card Body */}
                  <div className="p-4 flex flex-col flex-1">
                    {product.category && (
                      <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider mb-1">
                        {product.category}
                      </span>
                    )}

                    <Link
                      href={`/products/${product._id}`}
                      className="text-base font-bold text-slate-900 hover:text-blue-600 line-clamp-2 transition-colors mb-2 leading-snug"
                    >
                      {product.title}
                    </Link>

                    <div className="flex justify-between items-center mt-auto pt-3 border-t border-dashed border-slate-200">
                      <span className="text-lg font-extrabold text-slate-900">
                        ₹{Number(product.price || 0).toFixed(2)}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${
                          inStock
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {inStock ? `${product.quantity} in stock` : 'Out of Stock'}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-3.5">
                      <button
                        type="button"
                        onClick={() => handleAddToCart(product)}
                        disabled={!inStock}
                        className={`flex-1 rounded-md py-2 px-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                          isAdded
                            ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                            : inStock
                            ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-[0.98]'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200 shadow-none'
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            <span>Added!</span>
                          </>
                        ) : (
                          <>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <line x1="12" y1="5" x2="12" y2="19"></line>
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                            <span>Add to Cart</span>
                          </>
                        )}
                      </button>

                      <Link
                        href={`/products/${product._id}`}
                        className="py-2 px-3.5 text-xs font-semibold text-blue-600 bg-white hover:bg-blue-50 border border-blue-200 hover:border-blue-300 rounded-md inline-flex items-center justify-center transition-colors"
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 4. Simple Footer */}
      <footer className="mt-auto w-full bg-slate-900 border-t border-slate-800 py-7 px-5 text-center text-xs text-slate-400">
        <div className="flex justify-center gap-6 mb-2.5">
          <Link href="/" className="text-slate-400 hover:text-sky-400 transition-colors font-medium">Home</Link>
          <Link href="/products" className="text-slate-400 hover:text-sky-400 transition-colors font-medium">Products</Link>
          <Link href="/cart" className="text-slate-400 hover:text-sky-400 transition-colors font-medium">Cart</Link>
          <Link href="/orders" className="text-slate-400 hover:text-sky-400 transition-colors font-medium">Orders</Link>
          <Link href="/profile" className="text-slate-400 hover:text-sky-400 transition-colors font-medium">Profile</Link>
        </div>
        <div>Buyora &copy; {new Date().getFullYear()} — Simple & Secure E-Commerce</div>
      </footer>
    </div>
  );
}
