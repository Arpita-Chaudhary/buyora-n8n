// Frontend ACL utilities for permission checking and route guarding
export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  PRODUCTS_READ: 'products:read',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  DELIVERY_ZONES_READ: 'delivery_zones:read',
  DELIVERY_ZONES_MANAGE: 'delivery_zones:manage',
  PROMOTIONS_SEND: 'promotions:send',
  ANALYTICS_READ: 'analytics:read',
  PROFILE_READ: 'profile:read',
};

// Checks whether user has permission with wildcard and ADMIN bypass
export function hasPermission(user, permission) {
  if (!user) return false;

  const permissions = Array.isArray(user.permissions)
    ? user.permissions
    : (user.role_id && Array.isArray(user.role_id.permissions) ? user.role_id.permissions : []);

  // Super Admin bypass / wildcard check
  if (
    permissions.includes('*') ||
    user.role === 'ADMIN' ||
    user.role_id?.name === 'ADMIN'
  ) {
    return true;
  }

  // Check exact permission or dot/colon variants (e.g. products:read or products.view)
  const dotVariant = permission.replace(':', '.');
  const colonVariant = permission.replace('.', ':');

  return (
    permissions.includes(permission) ||
    permissions.includes(dotVariant) ||
    permissions.includes(colonVariant)
  );
}

export function hasAnyPermission(user, requiredPermissions = []) {
  if (!user || requiredPermissions.length === 0) return false;
  return requiredPermissions.some((perm) => hasPermission(user, perm));
}

export function hasAllPermissions(user, requiredPermissions = []) {
  if (!user || requiredPermissions.length === 0) return false;
  return requiredPermissions.every((perm) => hasPermission(user, perm));
}
