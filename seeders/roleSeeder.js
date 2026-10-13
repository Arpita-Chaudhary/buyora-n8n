const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const Role = require('../models/Role');
const { ROLE_LIST } = require('../constants/roles');
// Load environment variables from .env
dotenv.config();
const seedRoles = async () => {
  try {
    const results = await Promise.all(
      ROLE_LIST.map(async (roleDef) => {
        const existing = await Role.findOne({ name: roleDef.name });
        if (!existing) {
          await Role.create(roleDef);
          console.log(` - Created role ${roleDef.name}`);
          return 'inserted';
        } else {
          existing.displayName = roleDef.displayName;
          existing.permissions = roleDef.permissions || [];
          await existing.save();
          console.log(` - Synced role ${roleDef.name}`);
          return 'updated';
        }
      })
    );
    const insertedCount = results.filter((r) => r === 'inserted').length;
    const updatedCount = results.filter((r) => r === 'updated').length;
    console.log(`Role sync complete. Created: ${insertedCount}, Updated: ${updatedCount}`);
  } catch (error) {
    console.error(`Role seeding failed: ${error.message}`);
    throw error;
  }
};
module.exports = seedRoles;

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await seedRoles();
      console.log('Role seeder completed successfully.');
      process.exit(0);
    } catch (err) {
      console.error('Role seeder execution error:', err);
      process.exit(1);
    }
  })();
}
