require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const orders = await Order.find({});
  let updatedCount = 0;

  for (const o of orders) {
    const addr = String(o.customer?.shippingAddress?.address || '').toLowerCase();
    let targetLat = 30.7094;
    let targetLng = 76.7131;

    if (addr.includes('rosewood') || addr.includes('phase 8') || addr.includes('sector 55') || addr.includes('160055')) {
      targetLat = 30.7188;
      targetLng = 76.7299;
    } else if (addr.includes('chandigarh') || addr.includes('oak') || addr.includes('sector 17') || addr.includes('160017')) {
      targetLat = 30.7333;
      targetLng = 76.7794;
    } else {
      // Default to Mohali Phase 7 (central test location)
      targetLat = 30.7094;
      targetLng = 76.7131;
    }

    // Only update if not already set or null or different
    if (
      !o.deliveryCoordinates ||
      o.deliveryCoordinates.latitude !== targetLat ||
      o.deliveryCoordinates.longitude !== targetLng
    ) {
      o.deliveryCoordinates = { latitude: targetLat, longitude: targetLng };
      await o.save();
      updatedCount++;
    }
  }

  console.log(`Successfully verified and synchronized ${updatedCount} orders to consistent doorstep coordinates!`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
