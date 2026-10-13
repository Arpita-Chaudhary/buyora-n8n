const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const { ROLES } = require('../constants/roles');
const { authenticateUser } = require('../middleware/authMiddleware');
const { sendPromotionalEmails } = require('../utils/emailService');
// Helper function to check valid MongoDB ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
router.get("/me", authenticateUser, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId)
      .select("-password")
      .populate("role_id", "name displayName");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
});
router.get(
  '/dashboard',
  authenticateUser,
  async (req, res, next) => {
    try {
      const totalUsers = await User.countDocuments();
      const roleStats = await User.aggregate([
        {
          $group: {
            _id: '$role_id',
            count: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: 'roles',
            localField: '_id',
            foreignField: '_id',
            as: 'roleDetails',
          },
        },
        {
          $unwind: '$roleDetails',
        },
        {
          $project: {
            _id: 0,
            roleName: '$roleDetails.name',
            displayName: '$roleDetails.displayName',
            count: 1,
          },
        },
      ]);
      const roleCounts = {};
      roleStats.forEach((item) => {
        roleCounts[item.roleName] = item.count;
      });
      const Order = require('../models/Order');
      const totalPendingRefunds = await Order.countDocuments({ 'refundRequest.status': 'requested' });
      res.status(200).json({
        success: true,
        message: 'Admin dashboard metrics retrieved successfully',
        data: {
          totalUsers,
          totalAdmins: roleCounts[ROLES.ADMIN] || 0,
          totalRegularUsers: roleCounts[ROLES.USER] || 0,
          totalCustomers: roleCounts['CUSTOMER'] || 0,
          totalRiders: roleCounts['RIDER'] || 0,
          totalStaff: roleCounts['STAFF'] || 0,
          totalPendingRefunds,
          roleBreakdown: roleStats,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
router.get(
  '/users',
  authenticateUser,
  async (req, res, next) => {
    try {
      const users = await User.find()
        .select('-password')
        .populate('role_id', 'name displayName')
        .sort({ createdAt: -1 });
      res.status(200).json({
        success: true,
        count: users.length,
        data: users,
      });
    } catch (error) {
      next(error);
    }
  }
);
router.get(
  '/users/:id',
  authenticateUser,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid User ID format',
        });
      }
      const user = await User.findById(id)
        .select('-password')
        .populate('role_id', 'name displayName');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }
      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);
router.post(
  '/users',
  authenticateUser,
  async (req, res, next) => {
    try {
      const { name, email, password, role, isEmailVerified } = req.body;
      // 1. Validate required input
      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Please provide name, email, and password',
        });
      }
      // 2. Check for duplicate email
      const normalizedEmail = email.toLowerCase().trim();
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email address',
        });
      }
      // 3. Find specified role from Role collection
      const targetRoleName = (role || ROLES.USER).toUpperCase().trim();
      const roleDoc = await Role.findOne({ name: targetRoleName });
      if (!roleDoc) {
        return res.status(400).json({
          success: false,
          message: `Role '${targetRoleName}' does not exist in system`,
        });
      }
      // 4. Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      // 5. Create user
      const newUser = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role_id: roleDoc._id,
        isEmailVerified: isEmailVerified === true,
      });
      // 6. Fetch created user without password
      const createdUser = await User.findById(newUser._id)
        .select('-password')
        .populate('role_id', 'name displayName');
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: createdUser,
      });
    } catch (error) {
      next(error);
    }
  }
);
router.patch(
  '/users/:id',
  authenticateUser,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { name, email, password, role, isEmailVerified } = req.body;
      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid User ID format',
        });
      }
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }
      // Update fields if provided
      if (name) user.name = name.trim();
      if (email && email.toLowerCase().trim() !== user.email) {
        const emailExists = await User.findOne({ email: email.toLowerCase().trim() });
        if (emailExists) {
          return res.status(400).json({
            success: false,
            message: 'Another user already exists with this email address',
          });
        }
        user.email = email.toLowerCase().trim();
      }
      if (password) {
        if (password.length < 6) {
          return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters long',
          });
        }
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
      }
      if (role) {
        const targetRoleName = role.toUpperCase().trim();
        const roleDoc = await Role.findOne({ name: targetRoleName });
        if (!roleDoc) {
          return res.status(400).json({
            success: false,
            message: `Role '${targetRoleName}' does not exist in system`,
          });
        }
        user.role_id = roleDoc._id;
      }
      if (typeof isEmailVerified === 'boolean') {
        user.isEmailVerified = isEmailVerified;
      }
      await user.save();
      const updatedUser = await User.findById(user._id)
        .select('-password')
        .populate('role_id', 'name displayName');
      res.status(200).json({
        success: true,
        message: 'User updated successfully',
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }
);
router.delete(
  '/users/:id',
  authenticateUser,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid User ID format',
        });
      }
      const userToDelete = await User.findById(id).populate('role_id');
      if (!userToDelete) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }
      // Single-Admin Safety Protection: Prevent deleting the only ADMIN account
      if (userToDelete.role_id && userToDelete.role_id.name === ROLES.ADMIN) {
        const adminRole = await Role.findOne({ name: ROLES.ADMIN });
        const adminCount = await User.countDocuments({ role_id: adminRole._id });
        if (adminCount <= 1) {
          return res.status(400).json({
            success: false,
            message: 'Action denied. Cannot delete the only admin account in the system.',
          });
        }
      }
      await User.findByIdAndDelete(id);
      res.status(200).json({
        success: true,
        message: 'User deleted successfully',
        data: { id },
      });
    } catch (error) {
      next(error);
    }
  }
);
router.get('/promotions/send', (req, res) => {
  res.status(405).json({
    success: false,
    message: "Method Not Allowed: Please change HTTP Method from GET to POST in Postman to send promotions.",
  });
});
router.post(
  '/promotions/send',
  authenticateUser,
  async (req, res, next) => {
    try {
      const { subject, htmlContent, recipientEmails, selectAll } = req.body;
      if (!subject || !subject.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Subject line is required',
        });
      }
      if (!htmlContent || !htmlContent.trim()) {
        return res.status(400).json({
          success: false,
          message: 'HTML content is required',
        });
      }
      let targetEmails = [];
      if (selectAll === true) {
        // Fetch all customer emails (role USER)
        const userRole = await Role.findOne({ name: ROLES.USER });
        if (userRole) {
          const customers = await User.find({ role_id: userRole._id }).select('email');
          targetEmails = customers.map((c) => c.email);
        }
      } else if (Array.isArray(recipientEmails) && recipientEmails.length > 0) {
        targetEmails = recipientEmails;
      }
      // Deduplicate emails
      targetEmails = [...new Set(targetEmails.map((e) => e.trim().toLowerCase()))];
      if (targetEmails.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No recipients selected for promotion',
        });
      }
      const result = await sendPromotionalEmails({
        recipients: targetEmails,
        subject: subject.trim(),
        htmlContent,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);
module.exports = router;
