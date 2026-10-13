const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const DeliveryZone = require('../models/DeliveryZone');
const { authenticateUser, optionalAuth } = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/aclMiddleware');
const { uploadProductImage, deleteLocalImage } = require('../middleware/uploadMiddleware');

// Helper function to validate MongoDB ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper for reverse geocoding coordinates to area name
async function reverseGeocodeArea(lat, lng) {
  try {
    const url = `https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AdminPanelMapApp/1.0',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        const props = data.features[0].properties || {};
        const parts = [
          props.name,
          props.district,
          props.city || props.town || props.village || props.county,
          props.state,
          props.country,
        ].filter(Boolean);
        const uniqueLabel = parts.filter((item, idx, arr) => arr.indexOf(item) === idx).join(', ');
        return uniqueLabel || props.name || '';
      }
    }
  } catch (e) {
    // Non-blocking fallback
  }
  return '';
}

// Create a new product with optional image upload
router.post(
  '/',
  authenticateUser,
  checkPermission('products:create'),
  uploadProductImage,
  async (req, res, next) => {
    let uploadedFilePath = null;
    try {
      if (req.file) {
        uploadedFilePath = `/uploads/products/${req.file.filename}`;
      }

      const { title, description, image, price, quantity, category, status } = req.body;

      // 1. Validate required fields
      if (!title || !title.trim()) {
        if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
        return res.status(400).json({
          success: false,
          message: 'Please provide a product title',
        });
      }

      if (price === undefined || price === null || isNaN(price) || Number(price) < 0) {
        if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
        return res.status(400).json({
          success: false,
          message: 'Price is required and must be a non-negative number',
        });
      }

      if (quantity === undefined || quantity === null || isNaN(quantity) || Number(quantity) < 0) {
        if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
        return res.status(400).json({
          success: false,
          message: 'Quantity is required and must be a non-negative number',
        });
      }

      // 2. Validate status if provided
      let normalizedStatus = 'active';
      if (status) {
        normalizedStatus = status.toLowerCase().trim();
        if (!['active', 'inactive'].includes(normalizedStatus)) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: "Status must be either 'active' or 'inactive'",
          });
        }
      }

      // 3. Validate and build location (GeoJSON Point: [longitude, latitude])
      let location = undefined;
      let latVal = req.body.latitude;
      let lngVal = req.body.longitude;
      let locationName = req.body.locationName || (req.body.location && req.body.location.name) || (req.body.location && req.body.location.displayName) || '';

      // Also support location object if passed directly as { location: { coordinates: [lng, lat] } }
      if (
        (latVal === undefined || latVal === null || String(latVal).trim() === '') &&
        req.body.location &&
        Array.isArray(req.body.location.coordinates) &&
        req.body.location.coordinates.length === 2
      ) {
        lngVal = req.body.location.coordinates[0];
        latVal = req.body.location.coordinates[1];
      }

      const hasLatitude = latVal !== undefined && latVal !== null && String(latVal).trim() !== '';
      const hasLongitude = lngVal !== undefined && lngVal !== null && String(lngVal).trim() !== '';

      if (hasLatitude || hasLongitude) {
        if (!hasLatitude || isNaN(Number(latVal))) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Latitude is required and must be a valid number between -90 and 90',
          });
        }

        if (!hasLongitude || isNaN(Number(lngVal))) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Longitude is required and must be a valid number between -180 and 180',
          });
        }

        const lat = Number(latVal);
        const lng = Number(lngVal);

        if (lat < -90 || lat > 90) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Latitude must be between -90 and 90',
          });
        }

        if (lng < -180 || lng > 180) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Longitude must be between -180 and 180',
          });
        }

        // Auto reverse-geocode if area name is missing
        if (!locationName) {
          locationName = await reverseGeocodeArea(lat, lng);
        }

        location = {
          type: 'Point',
          coordinates: [lng, lat],
          name: locationName || '',
          address: locationName || '',
        };
      }

      // 4. Image priority: uploaded file > body image string > empty string
      const finalImage = uploadedFilePath || (image ? image.trim() : '');

      // 5. Create product record in MongoDB
      const productData = {
        title: title.trim(),
        description: description ? description.trim() : '',
        image: finalImage,
        price: Number(price),
        quantity: Number(quantity),
        category: category ? category.trim() : 'General',
        status: normalizedStatus,
      };

      if (location) {
        productData.location = location;
      }

      const newProduct = await Product.create(productData);

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: newProduct,
      });
    } catch (error) {
      if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
      next(error);
    }
  }
);

// Get all products with optional search, category/status filtering, and pagination
router.get(
  '/',
  optionalAuth,
  async (req, res, next) => {
    try {
      const { search, category, status, page, limit, latitude, longitude, zoneId } = req.query;
      const query = {};

      // Filter by search query across title and description
      if (search && search.trim()) {
        const searchRegex = new RegExp(search.trim(), 'i');
        query.$or = [
          { title: searchRegex },
          { description: searchRegex },
        ];
      }

      // Filter by category
      if (category && category !== 'ALL') {
        query.category = new RegExp(`^${category.trim()}$`, 'i');
      }

      // Check if requester is Admin
      const isAdmin =
        req.user &&
        (req.user.role === 'ADMIN' ||
          (Array.isArray(req.user.permissions) && req.user.permissions.includes('*')));

      // Customers (guests or non-admin users) should only see active products
      if (!isAdmin) {
        query.status = 'active';
      } else if (status && status !== 'ALL') {
        query.status = status.toLowerCase().trim();
      }

      // Customer Location & Delivery Zone Detection & Product Availability
      let detectedZone = null;
      let isServiceable = true;
      let matchingZones = [];

      if (
        latitude !== undefined &&
        longitude !== undefined &&
        String(latitude).trim() !== '' &&
        String(longitude).trim() !== '' &&
        !isNaN(Number(latitude)) &&
        !isNaN(Number(longitude))
      ) {
        const lat = Number(latitude);
        const lng = Number(longitude);

        // Geospatial point intersection with active delivery zones
        matchingZones = await DeliveryZone.find({
          status: 'active',
          boundary: {
            $geoIntersects: {
              $geometry: {
                type: 'Point',
                coordinates: [lng, lat],
              },
            },
          },
        });

        // 1. If not strictly intersecting boundary polygon, check if location or address is in Mohali or Chandigarh
        if (matchingZones.length === 0) {
          const isMohaliOrChandigarhCoords =
            lat >= 30.60 && lat <= 30.82 && lng >= 76.60 && lng <= 76.88;

          if (isMohaliOrChandigarhCoords) {
            const tricityZones = await DeliveryZone.find({
              status: 'active',
              $or: [
                { name: { $regex: /mohali/i } },
                { name: { $regex: /chandigarh/i } },
              ],
            });
            if (tricityZones.length > 0) {
              matchingZones = tricityZones;
            }
          }
        }

        // 2. If any address is stored through backend, that area is also serviceable
        if (matchingZones.length === 0) {
          const allActiveZones = await DeliveryZone.find({ status: 'active' });
          for (const z of allActiveZones) {
            const ring = z.boundary?.coordinates?.[0] || [];
            if (ring.length > 0) {
              const lats = ring.map((p) => p[1]);
              const lngs = ring.map((p) => p[0]);
              const minLat = Math.min(...lats) - 0.12;
              const maxLat = Math.max(...lats) + 0.12;
              const minLng = Math.min(...lngs) - 0.12;
              const maxLng = Math.max(...lngs) + 0.12;
              if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
                matchingZones = [z];
                break;
              }
            }
          }

          if (matchingZones.length === 0) {
            const productsWithLoc = await Product.find({
              status: 'active',
              'location.coordinates': { $exists: true, $ne: [] },
            });
            for (const prod of productsWithLoc) {
              if (Array.isArray(prod.location?.coordinates) && prod.location.coordinates.length === 2) {
                const [pLng, pLat] = prod.location.coordinates;
                const dist = Math.sqrt(Math.pow(lat - pLat, 2) + Math.pow(lng - pLng, 2));
                if (dist < 0.25 && allActiveZones.length > 0) {
                  matchingZones = [allActiveZones[0]];
                  break;
                }
              }
            }
          }
        }

        if (matchingZones.length === 0) {
          isServiceable = false;
          return res.status(200).json({
            success: true,
            serviceable: false,
            unreachable: true,
            status: 'service_unreachable',
            message: 'Service Unreachable: We currently only deliver across Mohali and Chandigarh coverage areas, and backend configured zones.',
            zone: null,
            count: 0,
            total: 0,
            data: [],
          });
        }

        // Pick primary zone with lowest delivery charge
        detectedZone = matchingZones.reduce((prev, curr) =>
          curr.deliveryCharge < prev.deliveryCharge ? curr : prev
        );

        // Handle overlapping delivery zones:
        // If ANY overlapping zone has assignmentType === 'all', all products are eligible for delivery
        const hasAllAccess = matchingZones.some((z) => z.assignmentType === 'all');
        if (!hasAllAccess) {
          const eligibleCategories = [
            ...new Set(
              matchingZones
                .filter((z) => z.assignmentType === 'categories')
                .flatMap((z) => z.assignedCategories || [])
            ),
          ];
          const eligibleProductIds = [
            ...new Set(
              matchingZones
                .filter((z) => z.assignmentType === 'products')
                .flatMap((z) => z.assignedProducts || [])
            ),
          ];

          const orConditions = [];
          if (eligibleCategories.length > 0) {
            orConditions.push({ category: { $in: eligibleCategories } });
          }
          if (eligibleProductIds.length > 0) {
            orConditions.push({ _id: { $in: eligibleProductIds } });
          }

          if (orConditions.length > 0) {
            if (query.$or) {
              query.$and = [{ $or: query.$or }, { $or: orConditions }];
              delete query.$or;
            } else {
              query.$or = orConditions;
            }
          } else {
            // No categories or products assigned in these restricted zones
            query._id = { $in: [] };
          }
        }
      } else if (zoneId && isValidObjectId(zoneId)) {
        detectedZone = await DeliveryZone.findById(zoneId);
        if (detectedZone && detectedZone.status === 'active') {
          if (detectedZone.assignmentType === 'categories') {
            query.category = { $in: detectedZone.assignedCategories };
          } else if (detectedZone.assignmentType === 'products') {
            query._id = { $in: detectedZone.assignedProducts };
          }
        }
      }

      const totalCount = await Product.countDocuments(query);
      let queryExec = Product.find(query).sort({ createdAt: -1 });

      if (page || limit) {
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 10);
        const skip = (pageNum - 1) * limitNum;
        queryExec = queryExec.skip(skip).limit(limitNum);
      }

      const products = await queryExec;

      res.status(200).json({
        success: true,
        serviceable: isServiceable,
        zone: detectedZone
          ? {
              id: detectedZone._id,
              name: detectedZone.name,
              deliveryCharge: detectedZone.deliveryCharge,
              minOrderAmount: detectedZone.minOrderAmount,
              estimatedDeliveryTime: detectedZone.estimatedDeliveryTime,
              color: detectedZone.color,
              assignmentType: detectedZone.assignmentType,
            }
          : null,
        overlappingZones: Array.isArray(matchingZones)
          ? matchingZones.map((z) => ({
              id: z._id,
              name: z.name,
              deliveryCharge: z.deliveryCharge,
              minOrderAmount: z.minOrderAmount,
              estimatedDeliveryTime: z.estimatedDeliveryTime,
            }))
          : [],
        count: products.length,
        total: totalCount,
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Geocode area / address search
router.get(
  '/geocode',
  async (req, res, next) => {
    try {
      const { query, q } = req.query;
      const searchQuery = (query || q || '').trim();

      if (!searchQuery) {
        return res.status(400).json({
          success: false,
          message: 'Search query is required (use ?query=... or ?q=...)',
        });
      }

      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(searchQuery)}&bbox=68.1113,6.5546,97.3956,35.6745&limit=6`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'AdminPanelMapApp/1.0',
        },
      });

      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message: 'Geocoding service unavailable',
        });
      }

      const data = await response.json();
      const features = Array.isArray(data.features) ? data.features : [];

      const results = features
        .filter((f) => f && f.geometry && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2)
        .map((f) => {
          const props = f.properties || {};
          const coords = f.geometry.coordinates; // [lng, lat]
          const labelParts = [
            props.name,
            props.street ? `${props.housenumber || ''} ${props.street}`.trim() : null,
            props.district,
            props.city || props.town || props.village || props.county,
            props.state,
            props.country,
          ].filter(Boolean);

          // Deduplicate adjacent identical terms in label
          const uniqueLabel = labelParts.filter((item, idx, arr) => arr.indexOf(item) === idx).join(', ');

          return {
            label: uniqueLabel || props.name || 'Unknown Location',
            name: props.name || '',
            city: props.city || props.town || props.district || '',
            state: props.state || '',
            country: props.country || '',
            lat: Number(coords[1]),
            lng: Number(coords[0]),
          };
        });

      res.status(200).json({
        success: true,
        count: results.length,
        data: results,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get products nearby customer's location
router.get(
  '/nearby',
  optionalAuth,
  async (req, res, next) => {
    try {
      const { latitude, longitude, radius } = req.query;

      // 1. Validate latitude
      if (latitude === undefined || latitude === null || String(latitude).trim() === '' || isNaN(Number(latitude))) {
        return res.status(400).json({
          success: false,
          message: 'Latitude is required and must be a valid number between -90 and 90',
        });
      }

      const lat = Number(latitude);
      if (lat < -90 || lat > 90) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be between -90 and 90',
        });
      }

      // 2. Validate longitude
      if (longitude === undefined || longitude === null || String(longitude).trim() === '' || isNaN(Number(longitude))) {
        return res.status(400).json({
          success: false,
          message: 'Longitude is required and must be a valid number between -180 and 180',
        });
      }

      const lng = Number(longitude);
      if (lng < -180 || lng > 180) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be between -180 and 180',
        });
      }

      // 3. Validate radius (allowed values: 5, 10, 25 km)
      const allowedRadii = [5, 10, 25];
      const parsedRadius = Number(radius);

      if (
        radius === undefined ||
        radius === null ||
        String(radius).trim() === '' ||
        isNaN(parsedRadius) ||
        !allowedRadii.includes(parsedRadius)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid radius. Allowed radius values are: 5, 10, 25 (km)',
        });
      }

      const maxDistanceMeters = parsedRadius * 1000;

      // 4. Geospatial search using MongoDB $geoNear aggregation
      const products = await Product.aggregate([
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: [lng, lat], // GeoJSON order: [longitude, latitude]
            },
            distanceField: 'distanceMeters',
            maxDistance: maxDistanceMeters,
            spherical: true,
            query: { status: 'active' },
          },
        },
        {
          $addFields: {
            distanceKm: {
              $round: [{ $divide: ['$distanceMeters', 1000] }, 2],
            },
          },
        },
        {
          $project: {
            distanceMeters: 0,
          },
        },
      ]);

      res.status(200).json({
        success: true,
        count: products.length,
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get single product by ID
router.get(
  '/:id',
  optionalAuth,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Product ID format',
        });
      }

      const product = await Product.findById(id);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found',
        });
      }

      const isAdmin =
        req.user &&
        (req.user.role === 'ADMIN' ||
          (Array.isArray(req.user.permissions) && req.user.permissions.includes('*')));

      if (!isAdmin && product.status !== 'active') {
        return res.status(404).json({
          success: false,
          message: 'Product not found or is currently unavailable',
        });
      }

      res.status(200).json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update product by ID with optional image replacement
router.put(
  '/:id',
  authenticateUser,
  checkPermission('products:update'),
  uploadProductImage,
  async (req, res, next) => {
    let uploadedFilePath = null;
    try {
      const { id } = req.params;

      if (req.file) {
        uploadedFilePath = `/uploads/products/${req.file.filename}`;
      }

      if (!isValidObjectId(id)) {
        if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
        return res.status(400).json({
          success: false,
          message: 'Invalid Product ID format',
        });
      }

      const product = await Product.findById(id);

      if (!product) {
        if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
        return res.status(404).json({
          success: false,
          message: 'Product not found',
        });
      }

      const { title, description, image, price, quantity, category, status } = req.body;

      // Validate updated fields if provided
      if (title !== undefined) {
        if (!title.trim()) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Product title cannot be empty',
          });
        }
        product.title = title.trim();
      }

      if (description !== undefined) {
        product.description = description.trim();
      }

      if (price !== undefined) {
        if (isNaN(price) || Number(price) < 0) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Price must be a non-negative number',
          });
        }
        product.price = Number(price);
      }

      if (quantity !== undefined) {
        if (isNaN(quantity) || Number(quantity) < 0) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Quantity must be a non-negative number',
          });
        }
        product.quantity = Number(quantity);
      }

      if (category !== undefined) {
        product.category = category.trim() || 'General';
      }


      if (status !== undefined) {
        const normalizedStatus = status.toLowerCase().trim();
        if (!['active', 'inactive'].includes(normalizedStatus)) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: "Status must be either 'active' or 'inactive'",
          });
        }
        product.status = normalizedStatus;
      }

      // Validate and update location if coordinates are provided
      let latVal = req.body.latitude;
      let lngVal = req.body.longitude;

      // Also support location object if passed directly as { location: { coordinates: [lng, lat] } }
      if (
        (latVal === undefined || latVal === null || String(latVal).trim() === '') &&
        req.body.location &&
        Array.isArray(req.body.location.coordinates) &&
        req.body.location.coordinates.length === 2
      ) {
        lngVal = req.body.location.coordinates[0];
        latVal = req.body.location.coordinates[1];
      }

      const hasLatitude = latVal !== undefined && latVal !== null && String(latVal).trim() !== '';
      const hasLongitude = lngVal !== undefined && lngVal !== null && String(lngVal).trim() !== '';

      if (hasLatitude || hasLongitude) {
        if (!hasLatitude || isNaN(Number(latVal))) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Latitude is required and must be a valid number between -90 and 90',
          });
        }

        if (!hasLongitude || isNaN(Number(lngVal))) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Longitude is required and must be a valid number between -180 and 180',
          });
        }

        const lat = Number(latVal);
        const lng = Number(lngVal);

        if (lat < -90 || lat > 90) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Latitude must be between -90 and 90',
          });
        }

        if (lng < -180 || lng > 180) {
          if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
          return res.status(400).json({
            success: false,
            message: 'Longitude must be between -180 and 180',
          });
        }

        let locationName = req.body.locationName || (req.body.location && req.body.location.name) || (req.body.location && req.body.location.displayName) || '';
        if (!locationName) {
          locationName = await reverseGeocodeArea(lat, lng);
        }

        product.location = {
          type: 'Point',
          coordinates: [lng, lat],
          name: locationName || (product.location && product.location.name) || '',
          address: locationName || (product.location && product.location.address) || '',
        };
      }

      // Handle image replacement
      let oldImageToDelete = null;
      if (uploadedFilePath) {
        // A new file was uploaded: mark previous image for deletion if different
        oldImageToDelete = product.image;
        product.image = uploadedFilePath;
      } else if (image !== undefined) {
        // String image URL was provided
        if (product.image && product.image !== image.trim()) {
          oldImageToDelete = product.image;
        }
        product.image = image.trim();
      }

      const updatedProduct = await product.save();

      // Safely delete previous local image if it was replaced
      if (oldImageToDelete && oldImageToDelete !== product.image) {
        deleteLocalImage(oldImageToDelete);
      }

      res.status(200).json({
        success: true,
        message: 'Product updated successfully',
        data: updatedProduct,
      });
    } catch (error) {
      if (uploadedFilePath) deleteLocalImage(uploadedFilePath);
      next(error);
    }
  }
);

// Delete product by ID and remove its local image from disk
router.delete(
  '/:id',
  authenticateUser,
  checkPermission('products:delete'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Product ID format',
        });
      }

      const product = await Product.findById(id);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found',
        });
      }

      // Clean up product image file from disk if stored locally
      if (product.image) {
        deleteLocalImage(product.image);
      }

      await Product.findByIdAndDelete(id);

      res.status(200).json({
        success: true,
        message: 'Product deleted successfully',
        data: { id },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
