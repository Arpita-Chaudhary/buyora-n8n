const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const DeliveryZone = require('../models/DeliveryZone');
const Product = require('../models/Product');
const { authenticateUser } = require('../middleware/authMiddleware');

// Helper to check valid ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Validate and clean GeoJSON Polygon coordinates
 * Coordinates should be an array of rings: [[[lng, lat], [lng, lat], ...]]
 * or raw array of points [[lng, lat], ...] that we can convert into a ring.
 */
function normalizeBoundary(rawCoordinates) {
  if (!rawCoordinates || !Array.isArray(rawCoordinates)) {
    throw new Error('Boundary coordinates must be an array');
  }

  let ring = rawCoordinates;
  // If array is nested as [[[lng, lat], ...]]
  if (Array.isArray(rawCoordinates[0]) && Array.isArray(rawCoordinates[0][0])) {
    ring = rawCoordinates[0];
  }

  if (ring.length < 3) {
    throw new Error('Delivery zone polygon must have at least 3 distinct boundary points');
  }

  // Validate each coordinate pair
  const cleanRing = ring.map((pt, idx) => {
    if (!Array.isArray(pt) || pt.length < 2) {
      throw new Error(`Invalid coordinate point at index ${idx}`);
    }
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);

    if (isNaN(lng) || lng < -180 || lng > 180) {
      throw new Error(`Longitude at point ${idx + 1} (${pt[0]}) must be between -180 and 180`);
    }
    if (isNaN(lat) || lat < -90 || lat > 90) {
      throw new Error(`Latitude at point ${idx + 1} (${pt[1]}) must be between -90 and 90`);
    }
    return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
  });

  // Ensure ring is closed (first and last point are identical)
  const first = cleanRing[0];
  const last = cleanRing[cleanRing.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleanRing.push([first[0], first[1]]);
  }

  if (cleanRing.length < 4) {
    throw new Error('A closed polygon linear ring requires at least 4 coordinate positions');
  }

  return {
    type: 'Polygon',
    coordinates: [cleanRing],
  };
}

// ========================================================
// ADMIN ENDPOINTS (Require Authentication)
// ========================================================

/**
 * GET /api/admin/delivery-zones or /api/delivery-zones/admin
 * Retrieve all delivery zones with optional search, status filtering, and summary metrics
 */
router.get(['/', '/admin'], authenticateUser, async (req, res, next) => {
  try {
    const { search, status } = req.query;
    const query = {};

    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    if (status && status !== 'all' && ['active', 'inactive'].includes(status)) {
      query.status = status;
    }

    const zones = await DeliveryZone.find(query)
      .populate('assignedProducts', 'title price category image status')
      .sort({ createdAt: -1 });

    // Aggregate summary metrics
    const totalZones = await DeliveryZone.countDocuments();
    const activeZones = await DeliveryZone.countDocuments({ status: 'active' });
    const inactiveZones = totalZones - activeZones;

    // Calculate average delivery fee
    const avgChargeResult = await DeliveryZone.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, avgFee: { $avg: '$deliveryCharge' } } },
    ]);
    const averageFee = avgChargeResult.length > 0 ? Number(avgChargeResult[0].avgFee.toFixed(2)) : 0;

    res.status(200).json({
      success: true,
      count: zones.length,
      metrics: {
        totalZones,
        activeZones,
        inactiveZones,
        averageFee,
      },
      data: zones,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/delivery-zones/:id
 * Retrieve a specific delivery zone by ID
 */
router.get(['/:id', '/admin/:id'], authenticateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Delivery Zone ID format',
      });
    }

    const zone = await DeliveryZone.findById(id).populate(
      'assignedProducts',
      'title price category image status'
    );

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Delivery Zone not found',
      });
    }

    res.status(200).json({
      success: true,
      data: zone,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/delivery-zones
 * Create a new delivery zone
 */
router.post(['/', '/admin'], authenticateUser, async (req, res, next) => {
  try {
    const {
      name,
      description,
      status,
      coordinates,
      boundary,
      color,
      deliveryCharge,
      minOrderAmount,
      estimatedDeliveryTime,
      assignmentType,
      assignedCategories,
      assignedProducts,
    } = req.body;

    // 1. Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Delivery zone name is required',
      });
    }

    // Check duplicate name
    const existing = await DeliveryZone.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A delivery zone named '${name.trim()}' already exists`,
      });
    }

    if (deliveryCharge === undefined || deliveryCharge === null || isNaN(Number(deliveryCharge)) || Number(deliveryCharge) < 0) {
      return res.status(400).json({
        success: false,
        message: 'Delivery charge is required and must be a non-negative number',
      });
    }

    if (minOrderAmount !== undefined && (isNaN(Number(minOrderAmount)) || Number(minOrderAmount) < 0)) {
      return res.status(400).json({
        success: false,
        message: 'Minimum order amount must be a non-negative number',
      });
    }

    if (!estimatedDeliveryTime || !estimatedDeliveryTime.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Estimated delivery time is required (e.g. "30-45 mins")',
      });
    }

    // 2. Validate and normalize GeoJSON Polygon Boundary
    let polygonBoundary;
    try {
      const rawCoords = coordinates || (boundary && boundary.coordinates);
      polygonBoundary = normalizeBoundary(rawCoords);
    } catch (coordErr) {
      return res.status(400).json({
        success: false,
        message: coordErr.message || 'Invalid boundary polygon coordinates',
      });
    }

    // 3. Validate product / category assignment
    const validAssignmentType = ['all', 'categories', 'products'].includes(assignmentType)
      ? assignmentType
      : 'all';

    let cleanCategories = [];
    if (validAssignmentType === 'categories' && Array.isArray(assignedCategories)) {
      cleanCategories = assignedCategories.map((c) => String(c).trim()).filter(Boolean);
    }

    let cleanProducts = [];
    if (validAssignmentType === 'products' && Array.isArray(assignedProducts)) {
      cleanProducts = assignedProducts.filter((pid) => isValidObjectId(pid));
    }

    // 4. Create Delivery Zone
    const newZone = await DeliveryZone.create({
      name: name.trim(),
      description: description ? description.trim() : '',
      status: status === 'inactive' ? 'inactive' : 'active',
      boundary: polygonBoundary,
      color: color && color.trim() ? color.trim() : '#3b82f6',
      deliveryCharge: Number(deliveryCharge),
      minOrderAmount: minOrderAmount !== undefined ? Number(minOrderAmount) : 0,
      estimatedDeliveryTime: estimatedDeliveryTime.trim(),
      assignmentType: validAssignmentType,
      assignedCategories: cleanCategories,
      assignedProducts: cleanProducts,
    });

    const populatedZone = await DeliveryZone.findById(newZone._id).populate(
      'assignedProducts',
      'title price category image status'
    );

    res.status(201).json({
      success: true,
      message: 'Delivery zone created successfully',
      data: populatedZone,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/admin/delivery-zones/:id
 * Update an existing delivery zone
 */
router.put(['/:id', '/admin/:id'], authenticateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Delivery Zone ID format',
      });
    }

    const zone = await DeliveryZone.findById(id);
    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Delivery Zone not found',
      });
    }

    const {
      name,
      description,
      status,
      coordinates,
      boundary,
      color,
      deliveryCharge,
      minOrderAmount,
      estimatedDeliveryTime,
      assignmentType,
      assignedCategories,
      assignedProducts,
    } = req.body;

    if (name && name.trim()) {
      // Check duplicate name excluding self
      const existing = await DeliveryZone.findOne({
        _id: { $ne: id },
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Another delivery zone is already named '${name.trim()}'`,
        });
      }
      zone.name = name.trim();
    }

    if (description !== undefined) {
      zone.description = description ? description.trim() : '';
    }

    if (status && ['active', 'inactive'].includes(status)) {
      zone.status = status;
    }

    if (color && color.trim()) {
      zone.color = color.trim();
    }

    if (deliveryCharge !== undefined) {
      if (isNaN(Number(deliveryCharge)) || Number(deliveryCharge) < 0) {
        return res.status(400).json({
          success: false,
          message: 'Delivery charge must be a non-negative number',
        });
      }
      zone.deliveryCharge = Number(deliveryCharge);
    }

    if (minOrderAmount !== undefined) {
      if (isNaN(Number(minOrderAmount)) || Number(minOrderAmount) < 0) {
        return res.status(400).json({
          success: false,
          message: 'Minimum order amount must be a non-negative number',
        });
      }
      zone.minOrderAmount = Number(minOrderAmount);
    }

    if (estimatedDeliveryTime && estimatedDeliveryTime.trim()) {
      zone.estimatedDeliveryTime = estimatedDeliveryTime.trim();
    }

    // Update boundary if coordinates provided
    const rawCoords = coordinates || (boundary && boundary.coordinates);
    if (rawCoords) {
      try {
        zone.boundary = normalizeBoundary(rawCoords);
      } catch (coordErr) {
        return res.status(400).json({
          success: false,
          message: coordErr.message || 'Invalid boundary polygon coordinates',
        });
      }
    }

    // Update assignment type and associations
    if (assignmentType && ['all', 'categories', 'products'].includes(assignmentType)) {
      zone.assignmentType = assignmentType;
    }

    if (Array.isArray(assignedCategories)) {
      zone.assignedCategories = assignedCategories.map((c) => String(c).trim()).filter(Boolean);
    }

    if (Array.isArray(assignedProducts)) {
      zone.assignedProducts = assignedProducts.filter((pid) => isValidObjectId(pid));
    }

    await zone.save();

    const updatedZone = await DeliveryZone.findById(zone._id).populate(
      'assignedProducts',
      'title price category image status'
    );

    res.status(200).json({
      success: true,
      message: 'Delivery zone updated successfully',
      data: updatedZone,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/admin/delivery-zones/:id
 * Delete a delivery zone
 */
router.delete(['/:id', '/admin/:id'], authenticateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Delivery Zone ID format',
      });
    }

    const zone = await DeliveryZone.findByIdAndDelete(id);
    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Delivery Zone not found',
      });
    }

    res.status(200).json({
      success: true,
      message: `Delivery zone '${zone.name}' deleted successfully`,
      data: { id: zone._id },
    });
  } catch (error) {
    next(error);
  }
});

// ========================================================
// PUBLIC / CLIENT SERVICEABILITY QUERY ENDPOINTS
// ========================================================

/**
 * POST /api/delivery-zones/check-serviceability
 * Check if a location (lat, lng) falls within any active delivery zone
 * Also checks serviceability for optional items list.
 */
router.post('/check-serviceability', async (req, res, next) => {
  try {
    const { latitude, longitude, items } = req.body;

    if (latitude === undefined || latitude === null || isNaN(Number(latitude))) {
      return res.status(400).json({
        success: false,
        message: 'Valid latitude is required',
      });
    }

    if (longitude === undefined || longitude === null || isNaN(Number(longitude))) {
      return res.status(400).json({
        success: false,
        message: 'Valid longitude is required',
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates are out of geographic range',
      });
    }

    // Geospatial query: Find active zones where polygon intersects user point
    // GeoJSON point: [lng, lat]
    let matchingZones = await DeliveryZone.find({
      status: 'active',
      boundary: {
        $geoIntersects: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        },
      },
    }).populate('assignedProducts', 'title price category image');

    // 1. If not strictly intersecting boundary polygon, check if location or address is in Mohali or Chandigarh
    if (matchingZones.length === 0) {
      const combinedText = `${req.body.address || ''} ${req.body.label || ''} ${req.body.city || ''} ${req.body.state || ''}`.toLowerCase();
      const isMohaliOrChandigarhText =
        /mohali|chandigarh|sas nagar|sahibzada ajit singh nagar|kharar|zirakpur|aerocity|sector\s*\d+|phase\s*\d+/i.test(
          combinedText
        );
      const isMohaliOrChandigarhCoords =
        lat >= 30.60 && lat <= 30.82 && lng >= 76.60 && lng <= 76.88;

      if (isMohaliOrChandigarhCoords || isMohaliOrChandigarhText) {
        // Find active Mohali or Chandigarh zone
        const tricityZones = await DeliveryZone.find({
          status: 'active',
          $or: [
            { name: { $regex: /mohali/i } },
            { name: { $regex: /chandigarh/i } },
          ],
        }).populate('assignedProducts', 'title price category image');

        if (tricityZones.length > 0) {
          matchingZones = tricityZones;
        }
      }
    }

    // 2. If any address is stored through backend, that area is also serviceable
    if (matchingZones.length === 0) {
      const allActiveZones = await DeliveryZone.find({ status: 'active' }).populate('assignedProducts', 'title price category image');
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
        // Check if any product stored through backend has coordinates near this location
        const Product = require('../models/Product');
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
      return res.status(200).json({
        success: true,
        serviceable: false,
        unreachable: true,
        status: 'service_unreachable',
        message: 'Service Unreachable: We currently only deliver across Mohali and Chandigarh coverage areas, and backend configured zones.',
        zones: [],
      });
    }

    // Pick best zone (e.g. lowest delivery fee or primary matching zone)
    const primaryZone = matchingZones.reduce((prev, curr) =>
      curr.deliveryCharge < prev.deliveryCharge ? curr : prev
    );

    // If items are passed, evaluate per-item serviceability
    let itemsEvaluation = null;
    if (Array.isArray(items) && items.length > 0) {
      itemsEvaluation = items.map((item) => {
        const productId = item.productId || item._id;
        const category = item.category;

        // Check if any matching zone covers this item
        const coveringZone = matchingZones.find((z) => {
          if (z.assignmentType === 'all') return true;
          if (z.assignmentType === 'categories' && category) {
            return z.assignedCategories.some(
              (cat) => cat.toLowerCase() === category.toLowerCase()
            );
          }
          if (z.assignmentType === 'products' && productId) {
            return z.assignedProducts.some(
              (p) => String(p._id || p) === String(productId)
            );
          }
          return false;
        });

        return {
          productId,
          title: item.title,
          category,
          serviceable: !!coveringZone,
          zoneName: coveringZone ? coveringZone.name : null,
        };
      });
    }

    res.status(200).json({
      success: true,
      serviceable: true,
      message: `Delivery available via '${primaryZone.name}'`,
      primaryZone: {
        id: primaryZone._id,
        name: primaryZone.name,
        deliveryCharge: primaryZone.deliveryCharge,
        minOrderAmount: primaryZone.minOrderAmount,
        estimatedDeliveryTime: primaryZone.estimatedDeliveryTime,
        color: primaryZone.color,
        assignmentType: primaryZone.assignmentType,
        assignedCategories: primaryZone.assignedCategories,
      },
      allMatchingZones: matchingZones.map((z) => ({
        id: z._id,
        name: z.name,
        deliveryCharge: z.deliveryCharge,
        minOrderAmount: z.minOrderAmount,
        estimatedDeliveryTime: z.estimatedDeliveryTime,
      })),
      itemsEvaluation,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/delivery-zones/public
 * Get all active delivery zones for public customer map view
 */
router.get('/public', async (req, res, next) => {
  try {
    const zones = await DeliveryZone.find({ status: 'active' }).select(
      'name description boundary color deliveryCharge minOrderAmount estimatedDeliveryTime assignmentType assignedCategories'
    );

    res.status(200).json({
      success: true,
      count: zones.length,
      data: zones,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
