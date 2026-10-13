const { ROLE_PERMISSIONS } = require('./permissions');

const ROLES = {
  ADMIN: 'ADMIN',
  USER: 'USER',
};
const ROLE_LIST = [
  {
    name: ROLES.ADMIN,
    displayName: 'Admin',
    permissions: ROLE_PERMISSIONS.ADMIN,
  },
  {
    name: ROLES.USER,
    displayName: 'User',
    permissions: ROLE_PERMISSIONS.USER,
  },
];
module.exports = {
  ROLES,
  ROLE_LIST,
};
