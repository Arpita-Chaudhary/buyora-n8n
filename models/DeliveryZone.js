const mongoose = require('mongoose');

const deliveryZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a delivery zone name'],
      trim: true,
      unique: true,
      maxlength: [100, 'Zone name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive'],
        message: '{VALUE} is not a valid status. Allowed values are: active, inactive',
      },
      default: 'active',
      lowercase: true,
      trim: true,
    },
    boundary: {
      type: {
        type: String,
        enum: ['Polygon'],
        required: [true, 'Boundary type must be Polygon'],
        default: 'Polygon',
      },
      // GeoJSON Polygon: array of linear rings (first ring is the exterior boundary)
      // Coordinates order: [longitude, latitude]
      coordinates: {
        type: [[[Number]]],
        required: [true, 'Boundary coordinates are required'],
      },
    },
    color: {
      type: String,
      trim: true,
      default: '#3b82f6', // Tailwind blue-500
    },
    deliveryCharge: {
      type: Number,
      required: [true, 'Please configure a delivery charge'],
      min: [0, 'Delivery charge cannot be negative'],
      default: 0,
    },
    minOrderAmount: {
      type: Number,
      min: [0, 'Minimum order amount cannot be negative'],
      default: 0,
    },
    estimatedDeliveryTime: {
      type: String,
      required: [true, 'Please configure an estimated delivery time (e.g. 30-45 mins)'],
      trim: true,
      default: '30-45 mins',
    },
    assignmentType: {
      type: String,
      enum: ['all', 'categories', 'products'],
      default: 'all',
    },
    assignedCategories: [
      {
        type: String,
        trim: true,
      },
    ],
    assignedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Ensure GeoJSON polygon linear ring is closed (first and last coordinate must be identical)
deliveryZoneSchema.pre('validate', function (next) {
  if (this.boundary && Array.isArray(this.boundary.coordinates) && this.boundary.coordinates.length > 0) {
    this.boundary.type = 'Polygon';
    const ring = this.boundary.coordinates[0];
    if (Array.isArray(ring) && ring.length >= 3) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        // Append first vertex to close ring
        ring.push([first[0], first[1]]);
      }
    }
  }
  next();
});

// 2dsphere index for MongoDB geospatial queries ($geoIntersects, $geoWithin)
deliveryZoneSchema.index({ boundary: '2dsphere' });
deliveryZoneSchema.index({ status: 1 });
deliveryZoneSchema.index({ createdAt: -1 });

module.exports = mongoose.model('DeliveryZone', deliveryZoneSchema);
