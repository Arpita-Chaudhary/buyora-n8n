const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Role = require('../models/Role');
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'User API route is operational',
  });
});
router.get('/roles', async (req, res, next) => {
  try {
    const roles = await Role.find().sort({ createdAt: 1 });
    res.status(200).json({
      success: true,
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    next(error);
  }
});
router.get('/', async (req, res, next) => {
  try {
    const users = await User.find()
      .select('-password')
      .populate('role_id', 'name displayName');
    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    next(error);
  }
});
module.exports = router;
