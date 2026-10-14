const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
    },
    title: {
      type: String,
      required: [true, 'Product title snapshot is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Price snapshot is required'],
      min: [0, 'Price snapshot cannot be negative'],
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
    },
    subtotal: {
      type: Number,
      required: [true, 'Subtotal is required'],
      min: [0, 'Subtotal cannot be negative'],
    },
    image: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: 'United States' },
  },
  { _id: false }
);

const customerInfoSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },
    shippingAddress: { type: shippingAddressSchema, required: true },
  },
  { _id: false }
);

const refundRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['none', 'requested', 'approved', 'rejected'],
      default: 'none',
      index: true,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    details: {
      type: String,
      trim: true,
      default: '',
    },
    requestedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    adminNotes: {
      type: String,
      trim: true,
      default: '',
    },
    stripeRefundId: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // Customer user account ID (optional for guest checkouts)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Order items with product snapshots
    orderItems: {
      type: [orderItemSchema],
      required: [true, 'Order must contain at least one item'],
      validate: {
        validator: function (items) {
          return Array.isArray(items) && items.length > 0;
        },
        message: 'Order items cannot be empty',
      },
    },

    // Server-calculated total amount
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required'],
      min: [0, 'Total amount must be a positive number'],
    },

    // Currency
    currency: {
      type: String,
      required: true,
      default: 'inr',
      lowercase: true,
      trim: true,
    },

    // Delivery Zone Details snapshot
    deliveryZone: {
      zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryZone', default: null },
      name: { type: String, default: '' },
      deliveryCharge: { type: Number, default: 0 },
      estimatedDeliveryTime: { type: String, default: '' },
    },

    // Delivery charge snapshot
    deliveryCharge: {
      type: Number,
      default: 0,
      min: [0, 'Delivery charge cannot be negative'],
    },

    // Customer Delivery Coordinates snapshot
    deliveryCoordinates: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    // GeoJSON Point representation for geospatial analytics/queries on orders
    deliveryLocation: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },

    // Payment Status - tracked separately from order status
    paymentStatus: {
      type: String,
      enum: {
        values: ['pending', 'paid', 'failed', 'refunded'],
        message: '{VALUE} is not a valid paymentStatus',
      },
      default: 'pending',
      index: true,
    },

    // Order Status - tracked separately from payment status
    // Supports: PLACED, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED
    // Retains legacy lowercase statuses for backwards compatibility with existing order records
    orderStatus: {
      type: String,
      enum: {
        values: [
          'PLACED',
          'CONFIRMED',
          'PREPARING',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'CANCELLED',
          'placed',
          'confirmed',
          'preparing',
          'out_for_delivery',
          'delivered',
          'cancelled',
          'pending',
          'processing',
          'shipped',
        ],
        message: '{VALUE} is not a valid orderStatus',
      },
      default: 'PLACED',
      index: true,
    },

    // Stripe PaymentIntent Identifier (Unique & Indexed)
    stripePaymentIntentId: {
      type: String,
      required: [true, 'Stripe PaymentIntent ID is required'],
      unique: true,
      trim: true,
      index: true,
    },

    // Customer & Shipping information snapshot
    customer: {
      type: customerInfoSchema,
      required: [true, 'Customer details are required'],
    },

    // Inventory reduction flag (ensures stock is deducted exactly once)
    stockDeducted: {
      type: Boolean,
      default: false,
    },

    // Paid timestamp
    paidAt: {
      type: Date,
      default: null,
    },

    // Delivered timestamp
    deliveredAt: {
      type: Date,
      default: null,
    },

    // Refund Request Lifecycle Tracking
    refundRequest: {
      type: refundRequestSchema,
      default: () => ({ status: 'none' }),
    },

    // Email Dispatch Idempotency Flags (Guarantees exactly ONE mail per milestone)
    confirmationEmailSent: {
      type: Boolean,
      default: false,
    },
    paymentEmailSent: {
      type: Boolean,
      default: false,
    },
    deliveryEmailSent: {
      type: Boolean,
      default: false,
    },
    feedbackEmailSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ deliveryLocation: '2dsphere' }, { sparse: true });

module.exports = mongoose.model('Order', orderSchema);
