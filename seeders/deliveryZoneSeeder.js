const DeliveryZone = require('../models/DeliveryZone');
const Product = require('../models/Product');

const sampleZones = [
  {
    name: 'Mohali All-Sectors Express Zone',
    description: 'Complete express delivery covering all Mohali Sectors (55-127), Phases 1-11, Sector 70-75, 91, 117-119, and Industrial Area 8A/8B.',
    status: 'active',
    color: '#3b82f6', // Bright Blue
    deliveryCharge: 49.00,
    minOrderAmount: 199.00,
    estimatedDeliveryTime: '20-35 mins',
    assignmentType: 'all',
    // Polygon covering entire Mohali SAS Nagar metropolitan region [longitude, latitude]
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [76.6300, 30.6400],
          [76.7550, 30.6400],
          [76.7550, 30.7600],
          [76.6300, 30.7600],
          [76.6300, 30.6400], // closed ring
        ],
      ],
    },
    assignedCategories: ['Electronics', 'Wearables', 'Groceries'],
  },
  {
    name: 'Chandigarh City Express Zone',
    description: 'Comprehensive 25-40 min delivery coverage across all Chandigarh Sectors (1-63), Sector 17 Plaza, Sector 35, Sector 43, Manimajra, and IT Park.',
    status: 'active',
    color: '#8b5cf6', // Vivid Violet
    deliveryCharge: 59.00,
    minOrderAmount: 249.00,
    estimatedDeliveryTime: '25-40 mins',
    assignmentType: 'all',
    // Polygon covering entire Chandigarh UT [longitude, latitude]
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [76.7200, 30.6800],
          [76.8500, 30.6800],
          [76.8500, 30.7850],
          [76.7200, 30.7850],
          [76.7200, 30.6800], // closed ring
        ],
      ],
    },
    assignedCategories: ['Electronics', 'Wearables'],
  },
  {
    name: 'Mohali Aerocity & IT City Hub',
    description: 'Fast delivery for Aerocity, IT City, JLPL Industrial Area, Sector 82, and Airport Road corridor.',
    status: 'active',
    color: '#10b981', // Emerald Green
    deliveryCharge: 69.00,
    minOrderAmount: 299.00,
    estimatedDeliveryTime: '30-45 mins',
    assignmentType: 'all',
    // Polygon covering Aerocity / IT City / Sector 82 / Airport Road [longitude, latitude]
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [76.7300, 30.6200],
          [76.8100, 30.6200],
          [76.8100, 30.6900],
          [76.7300, 30.6900],
          [76.7300, 30.6200], // closed ring
        ],
      ],
    },
    assignedCategories: ['Electronics', 'Wearables'],
  },
];

const seedDeliveryZones = async () => {
  try {
    // If any old Ludhiana zones exist (longitude < 76.0), remove them
    await DeliveryZone.deleteMany({
      'boundary.coordinates.0.0.0': { $lt: 76.0 },
    });

    // Remove old narrower Mohali zones if present so they are upgraded to full coverage
    await DeliveryZone.deleteMany({
      name: { $in: ['Mohali Central Express Zone', 'Mohali Sector 82 & Airport City Zone'] },
    });

    for (const z of sampleZones) {
      const existing = await DeliveryZone.findOne({ name: z.name });
      if (!existing) {
        await DeliveryZone.create(z);
        console.log(`Created delivery zone: ${z.name}`);
      } else {
        existing.boundary = z.boundary;
        existing.status = 'active';
        existing.deliveryCharge = z.deliveryCharge;
        existing.minOrderAmount = z.minOrderAmount;
        existing.estimatedDeliveryTime = z.estimatedDeliveryTime;
        existing.assignmentType = z.assignmentType;
        await existing.save();
        console.log(`Updated delivery zone: ${z.name}`);
      }
    }
  } catch (error) {
    console.warn(`Delivery zones seeder notice: ${error.message}`);
  }
};

if (require.main === module) {
  const dotenv = require('dotenv');
  const connectDB = require('../config/db');
  dotenv.config();
  connectDB().then(async () => {
    await seedDeliveryZones();
    console.log('Delivery zone seeder process complete.');
    process.exit(0);
  });
}

module.exports = seedDeliveryZones;
