const PERMISSIONS = {
  // User Management Permissions
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',

  // Product Management Permissions
  PRODUCTS_READ: 'products:read',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',

  // Delivery Zones Management Permissions
  DELIVERY_ZONES_READ: 'delivery_zones:read',
  DELIVERY_ZONES_MANAGE: 'delivery_zones:manage',

  // Marketing & Campaigns
  PROMOTIONS_SEND: 'promotions:send',

  // Metrics & Analytics
  ANALYTICS_READ: 'analytics:read',

  // General Profile
  PROFILE_READ: 'profile:read',

  // Wildcard Super Admin
  ALL: '*',
};

// Preset permissions by role
const ROLE_PERMISSIONS = {
  ADMIN: [
    '*', // Wildcard Super Admin access
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.USERS_DELETE,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.PRODUCTS_CREATE,
    PERMISSIONS.PRODUCTS_UPDATE,
    PERMISSIONS.PRODUCTS_DELETE,
    PERMISSIONS.DELIVERY_ZONES_READ,
    PERMISSIONS.DELIVERY_ZONES_MANAGE,
    PERMISSIONS.PROMOTIONS_SEND,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.PROFILE_READ,
  ],
  USER: [
    PERMISSIONS.PROFILE_READ,
    PERMISSIONS.PRODUCTS_READ, // Standard users can view products
  ],
};

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
};
