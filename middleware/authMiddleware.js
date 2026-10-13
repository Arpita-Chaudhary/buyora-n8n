const jwt = require('jsonwebtoken');
const { decryptToken } = require('../utils/encryption');
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    // 1. Reject requests missing the Authorization header or not using Bearer scheme
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No authentication token provided.',
      });
    }
    // 2. Extract encrypted token string after 'Bearer '
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Token missing from authorization header.',
      });
    }
    // 3. Decrypt AES-256-GCM encrypted token back into raw JWT
    let rawToken;
    try {
      rawToken = decryptToken(token);
    } catch (err) {
      // Fallback in case of legacy unencrypted token
      rawToken = token;
    }
    // 4. Verify JWT signature and expiration against JWT_SECRET
    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    // 5. Attach user payload (userId, role, permissions) to req.user
    const userRole = decoded.role;
    const permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];
    req.user = {
      userId: decoded.userId,
      role: userRole,
      permissions,
    };
    // 6. Pass control to the next middleware or route handler
    next();
  } catch (error) {
    // Handle expired token specifically
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication token has expired. Please log in again.',
      });
    }
    // Handle malformed or tampered tokens
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.',
      });
    }
    // Handle any general authentication failure
    return res.status(401).json({
      success: false,
      message: 'Authentication failed.',
    });
  }
};
// Optional authentication middleware: if Authorization header is provided, decode user; if not, proceed as guest
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      return next();
    }
    let rawToken;
    try {
      rawToken = decryptToken(token);
    } catch (err) {
      rawToken = token;
    }
    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
    };
    next();
  } catch (error) {
    // If token error occurs, proceed as unauthenticated guest customer
    next();
  }
};

module.exports = {
  authenticateUser,
  optionalAuth,
};
