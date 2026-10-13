/**
 * Comprehensive Automated Test Suite for Delivery Zones & Order Management
 *
 * Tests:
 * 1. Locations Inside Delivery Zones (Mohali, Chandigarh, Aerocity)
 * 2. Locations Outside Delivery Zones (Delhi, Mumbai, far out of bounds)
 * 3. Overlapping Zones (Points falling in multiple active zones & fee resolution)
 * 4. Boundary Coordinates (Vertex and edge points of polygons)
 * 5. Unavailable Products & Stock Restrictions
 * 6. Invalid Location Inputs (NaN, out-of-range, empty strings, missing coordinates)
 * 7. Verification of Returned Delivery Charges & Product Availability
 */

const BASE_URL = 'http://localhost:5000';

async function runTestSuite() {
  console.log('================================================================');
  console.log('   DELIVERY ZONE & ORDER MANAGEMENT TEST SUITE EXECUTION');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
      console.log(` ✅ PASS: [Test ${totalTests}] ${testName}`);
      if (details) console.log(`         ${details}`);
      passedTests++;
    } else {
      console.error(` ❌ FAIL: [Test ${totalTests}] ${testName}`);
      if (details) console.error(`         ${details}`);
    }
  }

  try {
    // -------------------------------------------------------------------------
    // SUITE 1: Locations Inside Delivery Zones
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 1: Locations Inside Delivery Zones ---');

    // 1.1 Mohali Center
    const mohaliRes = await fetch(`${BASE_URL}/api/products?latitude=30.7046&longitude=76.6800`);
    const mohaliData = await mohaliRes.json();
    assert(
      mohaliRes.status === 200 && mohaliData.serviceable === true && mohaliData.zone?.name?.includes('Mohali'),
      'Customer location inside Mohali zone is recognized as serviceable',
      `Zone: "${mohaliData.zone?.name}", Delivery Charge: ₹${mohaliData.zone?.deliveryCharge}`
    );

    // 1.2 Chandigarh Center
    const chdRes = await fetch(`${BASE_URL}/api/products?latitude=30.7400&longitude=76.8000`);
    const chdData = await chdRes.json();
    assert(
      chdRes.status === 200 && chdData.serviceable === true && chdData.zone?.name?.includes('Chandigarh'),
      'Customer location inside Chandigarh zone is recognized as serviceable',
      `Zone: "${chdData.zone?.name}", Delivery Charge: ₹${chdData.zone?.deliveryCharge}`
    );

    // 1.3 Aerocity Hub
    const aeroRes = await fetch(`${BASE_URL}/api/products?latitude=30.6400&longitude=76.7800`);
    const aeroData = await aeroRes.json();
    assert(
      aeroRes.status === 200 && aeroData.serviceable === true && aeroData.zone !== null,
      'Customer location in Aerocity / IT City Hub is serviceable',
      `Zone: "${aeroData.zone?.name}", Delivery Charge: ₹${aeroData.zone?.deliveryCharge}`
    );

    // -------------------------------------------------------------------------
    // SUITE 2: Locations Outside Delivery Zones
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 2: Locations Outside Delivery Zones ---');

    // 2.1 Far location (Delhi)
    const delhiRes = await fetch(`${BASE_URL}/api/products?latitude=28.6139&longitude=77.2090`);
    const delhiData = await delhiRes.json();
    assert(
      delhiData.serviceable === false && (delhiData.unreachable === true || delhiData.status === 'service_unreachable'),
      'Location outside delivery zones (Delhi) returns service unreachable',
      `Status: ${delhiData.status}, Message: "${delhiData.message}"`
    );

    // 2.2 Far location (Mumbai)
    const mumbaiRes = await fetch(`${BASE_URL}/api/products?latitude=18.9220&longitude=72.8347`);
    const mumbaiData = await mumbaiRes.json();
    assert(
      mumbaiData.serviceable === false && mumbaiData.data?.length === 0,
      'Location outside delivery zones (Mumbai) returns 0 products and unserviceable',
      `Serviceable: ${mumbaiData.serviceable}, Count: ${mumbaiData.count}`
    );

    // 2.3 Checkout rejection for unserviceable address
    const unservCheckout = await fetch(`${BASE_URL}/api/payments/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: mohaliData.data?.[0]?._id, quantity: 10 }],
        customer: {
          fullName: 'Outside User',
          email: 'outside@example.com',
          phone: '9999999999',
          shippingAddress: {
            address: 'Marine Lines',
            city: 'Mumbai',
            state: 'Maharashtra',
            postalCode: '400020',
            country: 'India',
          },
        },
        latitude: 18.9220,
        longitude: 72.8347,
      }),
    });
    const unservCheckoutData = await unservCheckout.json();
    assert(
      unservCheckout.status === 400 && unservCheckoutData.serviceable === false,
      'Checkout attempt from unserviceable location is strictly rejected with 400 Bad Request',
      `HTTP ${unservCheckout.status} - Message: "${unservCheckoutData.message}"`
    );

    // -------------------------------------------------------------------------
    // SUITE 3: Overlapping Delivery Zones
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Overlapping Delivery Zones ---');

    // 3.1 Point overlapping Mohali Express and Chandigarh Express (lat: 30.7100, lng: 76.7400)
    const overlapRes = await fetch(`${BASE_URL}/api/products?latitude=30.7100&longitude=76.7400`);
    const overlapData = await overlapRes.json();
    assert(
      overlapRes.status === 200 && Array.isArray(overlapData.overlappingZones) && overlapData.overlappingZones.length >= 2,
      'Detects all intersecting overlapping zones for coordinate in junction',
      `Overlapping zones count: ${overlapData.overlappingZones?.length} (${overlapData.overlappingZones?.map(z => z.name).join(', ')})`
    );

    // 3.2 Lowest delivery charge applied among overlapping zones
    const minCharge = Math.min(...overlapData.overlappingZones.map(z => z.deliveryCharge));
    assert(
      overlapData.zone?.deliveryCharge === minCharge,
      'Primary zone assigned has lowest delivery charge among overlapping zones',
      `Assigned zone charge: ₹${overlapData.zone?.deliveryCharge} (min among overlapping: ₹${minCharge})`
    );

    // -------------------------------------------------------------------------
    // SUITE 4: Boundary Coordinates
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 4: Boundary Coordinates ---');

    // 4.1 Exact vertex of Mohali Polygon (30.64, 76.63)
    const vertexRes = await fetch(`${BASE_URL}/api/products?latitude=30.6400&longitude=76.6300`);
    const vertexData = await vertexRes.json();
    assert(
      vertexRes.status === 200 && vertexData.serviceable === true,
      'Exact boundary vertex coordinate is treated as serviceable',
      `Zone: "${vertexData.zone?.name}"`
    );

    // 4.2 Point on boundary edge (30.76, 76.70)
    const edgeRes = await fetch(`${BASE_URL}/api/products?latitude=30.7600&longitude=76.7000`);
    const edgeData = await edgeRes.json();
    assert(
      edgeRes.status === 200 && edgeData.serviceable === true,
      'Boundary edge coordinate is treated as serviceable',
      `Zone: "${edgeData.zone?.name}"`
    );

    // -------------------------------------------------------------------------
    // SUITE 5: Unavailable Products & Stock Restrictions
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 5: Unavailable Products & Stock Restrictions ---');

    // 5.1 Non-existent product ID checkout rejection
    const nonExistentCheckout = await fetch(`${BASE_URL}/api/payments/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: '600000000000000000000000', quantity: 1 }],
        customer: {
          fullName: 'Test User',
          email: 'test@example.com',
          phone: '9999999999',
          shippingAddress: {
            address: 'Sector 62',
            city: 'Mohali',
            state: 'Punjab',
            postalCode: '160062',
            country: 'India',
          },
        },
        latitude: 30.7046,
        longitude: 76.7179,
      }),
    });
    const nonExistentData = await nonExistentCheckout.json();
    assert(
      nonExistentCheckout.status === 404 && nonExistentData.success === false,
      'Checkout fails with 404 when product is not found in database catalog',
      `Message: "${nonExistentData.message}"`
    );

    // 5.2 Minimum order amount restriction in zone
    const cheapProd = mohaliData.data.find((p) => p.price < 100) || mohaliData.data[0];
    const belowMinOrderCheckout = await fetch(`${BASE_URL}/api/payments/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: cheapProd._id, quantity: 1 }], // e.g. ₹29.99 is below ₹199 min order
        customer: {
          fullName: 'Test User',
          email: 'test@example.com',
          phone: '9999999999',
          shippingAddress: {
            address: 'Sector 62',
            city: 'Mohali',
            state: 'Punjab',
            postalCode: '160062',
            country: 'India',
          },
        },
        latitude: 30.7046,
        longitude: 76.7179,
      }),
    });
    const belowMinData = await belowMinOrderCheckout.json();
    assert(
      belowMinOrderCheckout.status === 400 && belowMinData.message?.includes('Minimum order amount'),
      'Checkout enforces delivery zone minimum order threshold',
      `Message: "${belowMinData.message}"`
    );

    // -------------------------------------------------------------------------
    // SUITE 6: Invalid Location Inputs
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 6: Invalid Location Inputs ---');

    // 6.1 Non-numeric strings for coordinates
    const nanRes = await fetch(`${BASE_URL}/api/products?latitude=invalid_lat&longitude=invalid_lng`);
    const nanData = await nanRes.json();
    assert(
      nanRes.status === 200 && nanData.success === true && Array.isArray(nanData.data),
      'Handles non-numeric latitude/longitude gracefully without crashing',
      `Count: ${nanData.count}, Zone: ${nanData.zone}`
    );

    // 6.2 Nearby API with out-of-bounds coordinates (> 90 / > 180)
    const outOfBoundsNearby = await fetch(`${BASE_URL}/api/products/nearby?latitude=999&longitude=999`);
    const outOfBoundsData = await outOfBoundsNearby.json();
    assert(
      outOfBoundsNearby.status === 400 && outOfBoundsData.success === false,
      'Nearby API validates coordinate bounds (-90 to 90, -180 to 180) and returns 400 Bad Request',
      `Message: "${outOfBoundsData.message}"`
    );

    // 6.3 Empty string coordinates
    const emptyCoordRes = await fetch(`${BASE_URL}/api/products?latitude=&longitude=`);
    const emptyCoordData = await emptyCoordRes.json();
    assert(
      emptyCoordRes.status === 200 && emptyCoordData.success === true,
      'Empty string coordinates fall back gracefully to default catalog',
      `Success: ${emptyCoordData.success}, Products: ${emptyCoordData.count}`
    );

    // -------------------------------------------------------------------------
    // SUITE 7: Verification of Delivery Charges & Product Availability
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 7: Verification of Delivery Charges & Product Availability ---');

    // 7.1 Successful checkout calculation and order snapshot
    const activeProd = mohaliData.data?.[0];
    const qty = activeProd.price < 50 ? 10 : 2; // Ensure subtotal >= 199
    const expectedSubtotal = Number((activeProd.price * qty).toFixed(2));
    const expectedTotal = Number((expectedSubtotal + 49).toFixed(2));

    const validCheckout = await fetch(`${BASE_URL}/api/payments/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: activeProd._id, quantity: qty }],
        customer: {
          fullName: 'Arpita Choudhary',
          email: 'arpita.test@example.com',
          phone: '9876543210',
          shippingAddress: {
            address: 'House #450, Phase 7',
            city: 'Mohali',
            state: 'Punjab',
            postalCode: '160062',
            country: 'India',
          },
        },
        latitude: 30.7046,
        longitude: 76.7179,
      }),
    });
    const validCheckoutData = await validCheckout.json();
    assert(
      validCheckout.status === 200 &&
        validCheckoutData.success === true &&
        validCheckoutData.summary?.deliveryCharge === 49 &&
        validCheckoutData.summary?.total === expectedTotal,
      'Checkout calculates correct total (subtotal + delivery fee) and attaches zone snapshot',
      `Subtotal: ₹${validCheckoutData.summary?.subtotal}, Delivery Fee: ₹${validCheckoutData.summary?.deliveryCharge}, Grand Total: ₹${validCheckoutData.summary?.total}`
    );

    // Verify order in database
    if (validCheckoutData.orderId) {
      const Order = require('../models/Order');
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect('mongodb://localhost:27017/admin_panel');
      }
      const orderInDb = await Order.findById(validCheckoutData.orderId);
      assert(
        orderInDb.deliveryCoordinates?.latitude === 30.7046 &&
          orderInDb.deliveryCoordinates?.longitude === 76.7179 &&
          orderInDb.deliveryCharge === 49 &&
          orderInDb.deliveryZone?.name === 'Mohali All-Sectors Express Zone',
        'Order record in MongoDB stores customer coordinates, delivery charge, and zone name snapshot',
        `Coordinates: [${orderInDb.deliveryCoordinates?.latitude}, ${orderInDb.deliveryCoordinates?.longitude}], Stored Fee: ₹${orderInDb.deliveryCharge}`
      );

      // Clean up test order
      await Order.findByIdAndDelete(validCheckoutData.orderId);
    }

    console.log('\n================================================================');
    console.log(`   TEST SUITE SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log('================================================================\n');

    process.exit(passedTests === totalTests ? 0 : 1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTestSuite();
