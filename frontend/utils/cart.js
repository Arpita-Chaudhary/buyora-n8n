'use client';

import { useState, useEffect } from 'react';

const CART_STORAGE_KEY = 'customer_cart';
const CART_EVENT_NAME = 'customer_cart_updated';

/**
 * Retrieve cart items from localStorage safely.
 */
export function getCart() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to parse cart from storage:', e);
    return [];
  }
}

/**
 * Save cart items to localStorage and notify all listeners.
 */
export function saveCart(cart) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    // Dispatch custom event for same-tab updates
    window.dispatchEvent(new CustomEvent(CART_EVENT_NAME, { detail: cart }));
  } catch (e) {
    console.error('Failed to save cart to storage:', e);
  }
}

/**
 * Add product with quantity to cart. Supports multiple distinct products.
 * Calculates individual item subtotal.
 */
export function addToCart(product, quantityToAdd = 1) {
  if (!product || !product._id) return getCart();
  const maxStock = typeof product.quantity === 'number' ? product.quantity : 999;
  if (maxStock <= 0) return getCart(); // Cannot add out of stock items

  const currentCart = getCart();
  const existingIndex = currentCart.findIndex((item) => item._id === product._id);
  const qty = Math.max(1, quantityToAdd);

  let newCart;
  if (existingIndex > -1) {
    newCart = [...currentCart];
    const existingItem = newCart[existingIndex];
    const newQty = Math.min(existingItem.quantity + qty, maxStock);
    newCart[existingIndex] = {
      ...existingItem,
      price: Number(product.price) || existingItem.price,
      maxStock: maxStock,
      quantity: newQty,
      subtotal: (Number(product.price) || existingItem.price) * newQty,
    };
  } else {
    const itemPrice = Number(product.price) || 0;
    const initialQty = Math.min(qty, maxStock);
    newCart = [
      ...currentCart,
      {
        _id: product._id,
        title: product.title,
        price: itemPrice,
        image: product.image || '',
        category: product.category || 'General',
        maxStock: maxStock,
        quantity: initialQty,
        subtotal: itemPrice * initialQty,
      },
    ];
  }

  saveCart(newCart);
  return newCart;
}

/**
 * Update quantity for a specific product in the cart.
 * Enforces: min = 1, max = available stock.
 */
export function updateCartQuantity(productId, newQuantity) {
  const currentCart = getCart();
  const newCart = currentCart
    .map((item) => {
      if (item._id === productId) {
        const maxStock = item.maxStock || 999;
        const clampedQty = Math.max(1, Math.min(newQuantity, maxStock));
        return {
          ...item,
          quantity: clampedQty,
          subtotal: item.price * clampedQty,
        };
      }
      return item;
    })
    .filter(Boolean);

  saveCart(newCart);
  return newCart;
}

/**
 * Remove an item from the cart by its ID.
 */
export function removeFromCart(productId) {
  const currentCart = getCart();
  const newCart = currentCart.filter((item) => item._id !== productId);
  saveCart(newCart);
  return newCart;
}

/**
 * Empty the entire cart.
 */
export function clearCart() {
  saveCart([]);
  return [];
}

/**
 * Calculate total cart count (sum of all item quantities).
 * E.g., Product A (2) + Product B (1) = 3.
 */
export function getCartTotalCount(cart) {
  if (!Array.isArray(cart)) return 0;
  return cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

/**
 * Calculate total cart amount (sum of price * quantity for all items).
 */
export function getCartTotalAmount(cart) {
  if (!Array.isArray(cart)) return 0;
  return cart.reduce((sum, item) => {
    const price = Number(item.price) || 0;
    const qty = Number(item.quantity) || 0;
    return sum + price * qty;
  }, 0);
}

/**
 * Custom React hook for live cart synchronization across components and tabs.
 */
export function useCart() {
  const [cart, setCart] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Initial hydration from localStorage
    setCart(getCart());
    setIsLoaded(true);

    const handleUpdate = () => {
      setCart(getCart());
    };

    window.addEventListener(CART_EVENT_NAME, handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener(CART_EVENT_NAME, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const totalCount = getCartTotalCount(cart);
  const totalAmount = getCartTotalAmount(cart);

  return {
    cart,
    isLoaded,
    totalCount,
    totalAmount,
    addItem: addToCart,
    updateQty: updateCartQuantity,
    removeItem: removeFromCart,
    clear: clearCart,
  };
}
