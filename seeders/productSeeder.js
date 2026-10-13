const mongoose = require('mongoose');
const Product = require('../models/Product');

const initialProducts = [
  {
    _id: new mongoose.Types.ObjectId('6ab37b10fab706db6dc20ef1'),
    title: 'Keyboard',
    description: 'Tactile blue switches with per-key RGB backlighting and aluminum frame.',
    image: '/uploads/products/product-1790668484417-632255764.jpg',
    price: 29.99,
    quantity: 36,
    category: 'Electronics',
    status: 'active',
    location: {
      type: 'Point',
      coordinates: [76.725556, 30.705178],
      name: 'Sector 60, Mohali, Punjab, India',
      address: 'Sector 60, Mohali, Punjab, India',
    },
  },
  {
    _id: new mongoose.Types.ObjectId('6ab4b4e66f9e7f11ef15f18e'),
    title: 'Wireless-Mouse',
    description: 'A wireless mouse is a convenient computer accessory that provides smooth and flexible control without the need for cables.',
    image: '/uploads/products/product-1790668469313-7359626.webp',
    price: 77.99,
    quantity: 22,
    category: 'Electronics',
    status: 'active',
    location: {
      type: 'Point',
      coordinates: [76.725556, 30.705178],
      name: 'Sector 60, Mohali, Punjab, India',
      address: 'Sector 60, Mohali, Punjab, India',
    },
  },
  {
    _id: new mongoose.Types.ObjectId('6abb5f68059ce6d782b53b82'),
    title: 'Smart Watch',
    description: 'A smartwatch is a wearable device that combines timekeeping with smart features like fitness tracking, notifications, calls, and health monitoring.',
    image: '/uploads/products/product-1790668459023-387075689.webp',
    price: 399,
    quantity: 14,
    category: 'Wearables',
    status: 'active',
    location: {
      type: 'Point',
      coordinates: [76.725556, 30.705178],
      name: 'Sector 60, Mohali, Punjab, India',
      address: 'Sector 60, Mohali, Punjab, India',
    },
  },
  {
    _id: new mongoose.Types.ObjectId('6abb5f68059ce6d782b53b85'),
    title: 'Wireless Mouse',
    description: 'A wireless mouse is a convenient computer accessory that allows you to control your device without using a physical cable.',
    image: '/uploads/products/product-1790668429169-404731056.jpeg',
    price: 999,
    quantity: 32,
    category: 'Electronics',
    status: 'active',
    location: {
      type: 'Point',
      coordinates: [76.725556, 30.705178],
      name: 'Sector 60, Mohali, Punjab, India',
      address: 'Sector 60, Mohali, Punjab, India',
    },
  },
  {
    _id: new mongoose.Types.ObjectId('6abe383d96467c43f8814048'),
    title: 'Watch',
    description: 'Watch helps you to calculate your daily steps.',
    image: '/uploads/products/product-1790851401868-248488524.jpg',
    price: 799,
    quantity: 29,
    category: 'Electronics',
    status: 'active',
    location: {
      type: 'Point',
      coordinates: [76.727905, 30.704686],
      name: 'Sector 62, Mohali, Punjab, India',
      address: 'Sector 62, Mohali, Punjab, India',
    },
  },
];

const seedProducts = async () => {
  try {
    for (const prod of initialProducts) {
      await Product.findByIdAndUpdate(prod._id, prod, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });
    }
    console.log(`Product seeder synced ${initialProducts.length} backend products.`);
  } catch (error) {
    console.error('Error seeding products:', error.message);
  }
};

module.exports = seedProducts;
