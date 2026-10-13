// ACL middleware to verify required granular permissions
const checkPermission = (...requiredPermissions) => {
  return (req, res, next) => {
    // 1. Verify user is authenticated (req.user populated by authMiddleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. User authentication context is missing.',
      });
    }

    const userRole = req.user.role;
    const userPermissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];

    // 2. Super Admin bypass:
    // If role is ADMIN or user has wildcard '*' permission, grant access immediately
    if (userRole === 'ADMIN' || userPermissions.includes('*')) {
      return next();
    }

    // 3. Find any required permissions the user is missing
    const missingPermissions = requiredPermissions.filter(
      (perm) => !userPermissions.includes(perm)
    );

    // 4. Deny access if any required permission is not present
    if (missingPermissions.length > 0) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. You lack the required permission(s): [${missingPermissions.join(', ')}]`,
        missingPermissions,
      });
    }

    // 5. User holds all required permissions, proceed to route handler
    next();
  };
};

module.exports = {
  checkPermission,
};
