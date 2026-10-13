const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // 1. Ensure user is authenticated (req.user populated by authenticateUser)
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. User authentication context is missing.',
      });
    }
    // 2. Verify user role is authorized
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Access denied for role '${req.user.role}'.`,
      });
    }
    // 3. Authorization successful, proceed to route handler
    next();
  };
};
const { checkPermission } = require('./aclMiddleware');

module.exports = {
  authorizeRoles,
  checkPermission,
};
