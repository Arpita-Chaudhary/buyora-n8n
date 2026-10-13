const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a product title'],
      trim: true,
      maxlength: [200, 'Product title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    image: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: [true, 'Please provide a product price'],
      min: [0, 'Price must be a positive number or zero'],
    },
    quantity: {
      type: Number,
      required: [true, 'Please provide a product quantity'],
      min: [0, 'Quantity cannot be negative'],
      default: 0,
    },
    category: {
      type: String,
      trim: true,
      default: 'General',
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
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      },
      name: {
        type: String,
        trim: true,
        default: '',
      },
      address: {
        type: String,
        trim: true,
        default: '',
      },
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
  }
);

// Ensure location is safely undefined if valid coordinates are not provided (prevents 2dsphere index extraction errors on products without location)
productSchema.pre('validate', function (next) {
  if (
    this.location &&
    (!this.location.coordinates ||
      !Array.isArray(this.location.coordinates) ||
      this.location.coordinates.length < 2 ||
      this.location.coordinates[0] === null ||
      this.location.coordinates[1] === null)
  ) {
    this.location = undefined;
  } else if (this.location && Array.isArray(this.location.coordinates) && this.location.coordinates.length >= 2) {
    this.location.type = 'Point';
  }
  next();
});

// Indexes for high-efficiency querying, filtering, and sorting
productSchema.index({ location: '2dsphere' });
productSchema.index({ title: 'text', description: 'text' });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);
