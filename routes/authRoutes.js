const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Role = require('../models/Role');
const { ROLES } = require('../constants/roles');
const { authenticateUser } = require('../middleware/authMiddleware');
const { encryptToken } = require('../utils/encryption');
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    // 1. Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }
    // 2. Normalize role input (default to USER if not specified)
    const requestedRoleName = (role || ROLES.USER).toUpperCase().trim();
    // 3. Prevent registration as ADMIN via public registration API
    if (requestedRoleName === ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        message: 'Registration as ADMIN is not allowed',
      });
    }
    // 4. Ensure only USER role is allowed for public registration
    if (requestedRoleName !== ROLES.USER) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Public registration is only permitted for USER role',
      });
    }
    // 5. Check if email already exists in database
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email address',
      });
    }
    // 6. Find USER role from MongoDB Role collection
    const roleDoc = await Role.findOne({ name: ROLES.USER });
    if (!roleDoc) {
      return res.status(400).json({
        success: false,
        message: 'USER role does not exist in system database. Please run role seeder first.',
      });
    }
    // 7. Hash password using bcryptjs
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    // 8. Save user with role_id reference and isEmailVerified: false
    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role_id: roleDoc._id,
      isEmailVerified: false,
    });
    // 9. Return clean JSON response without exposing the password
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role_id: newUser.role_id,
        isEmailVerified: newUser.isEmailVerified,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, role } = req.body;
    // 1. Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }
    // 2. Find user by email and populate role_id details
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).populate('role_id');
    // 3. Handle invalid email
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }
    // 4. Compare entered password with stored bcrypt hash (with trimmed fallback)
    const isPasswordMatch =
      (await bcrypt.compare(password, user.password)) ||
      (typeof password === 'string' && password.trim() !== password && (await bcrypt.compare(password.trim(), user.password)));
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }
    // 5. Verify role if specified from frontend dropdown
    const userRole = user.role_id ? user.role_id.name : ROLES.USER;
    if (role) {
      const selectedRole = role.toUpperCase().trim();
      if (selectedRole === ROLES.ADMIN && userRole !== ROLES.ADMIN) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This account does not have Admin privileges.',
        });
      }
    }
    // 6. Extract role permissions
    const permissions = (user.role_id && Array.isArray(user.role_id.permissions)) ? user.role_id.permissions : [];
    // 7. Generate JWT payload containing userId, role, and permissions
    const payload = {
      userId: user._id,
      role: userRole,
      permissions,
    };
    // 8. Sign JWT token with 1 day expiration
    const rawToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });
    // 9. Encrypt the signed JWT token with AES-256-GCM
    const token = encryptToken(rawToken);
    // 10. Return success response with encrypted token and user info (excluding password)
    res.status(200).json({
      success: true,
      message: `${userRole === ROLES.ADMIN ? 'Admin' : 'User'} logged in successfully`,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: userRole,
        permissions,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});
router.get('/me', authenticateUser, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-password')
      .populate('role_id', 'name displayName permissions');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }
    const permissions = user.role_id?.permissions || req.user.permissions || [];
    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role_id?.name || req.user.role,
        role_id: user.role_id,
        permissions,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});
module.exports = router;
