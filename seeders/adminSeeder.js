const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const User = require('../models/User');
const Role = require('../models/Role');
const { ROLES } = require('../constants/roles');

// Load environment variables from .env
dotenv.config();

const seedAdmin = async () => {
  try {
    // 1. Find ADMIN role from MongoDB
    const adminRole = await Role.findOne({ name: ROLES.ADMIN });

    if (!adminRole) {
      console.error(' ADMIN role not found in database. Cannot seed admin.');
      return;
    }

    // Admin default credentials
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
    const adminEmails = [
      process.env.ADMIN_EMAIL || 'admin@example.com',
      'admin@gmail.com',
      process.env.EMAIL_USER,
    ].filter(Boolean);

    const salt = await bcrypt.genSalt(10);
    const hashedAdminPassword = await bcrypt.hash(adminPassword, salt);

    const results = await Promise.all(
      adminEmails.map(async (email) => {
        const normalizedEmail = email.toLowerCase().trim();
        const existingAdmin = await User.findOne({ email: normalizedEmail });

        if (existingAdmin) {
          existingAdmin.role_id = adminRole._id;
          existingAdmin.password = hashedAdminPassword;
          existingAdmin.isEmailVerified = true;
          await existingAdmin.save();
          console.log(`Admin user verified, password synced & active: ${normalizedEmail}`);
          return 'verified';
        } else {
          await User.create({
            name: normalizedEmail === 'admin@gmail.com' ? 'Admin' : (process.env.ADMIN_NAME || 'System Admin'),
            email: normalizedEmail,
            password: hashedAdminPassword,
            role_id: adminRole._id,
            isEmailVerified: true,
          });
          console.log(`Admin user created successfully: ${normalizedEmail}`);
          return 'created';
        }
      })
    );
    const verifiedCount = results.filter((r) => r === 'verified').length;
    const createdCount = results.filter((r) => r === 'created').length;
    console.log(`Admin seed complete. Created: ${createdCount}, Verified: ${verifiedCount}, Total: ${adminEmails.length}`);

    // 2. Also ensure standard Customer demo user exists
    const userRole = await Role.findOne({ name: ROLES.USER });
    if (userRole) {
      const hashedCustomerPassword = await bcrypt.hash('User@123456', salt);
      const customerEmails = ['customer@example.com', 'user@example.com'];
      
      for (const cEmail of customerEmails) {
        const existingCustomer = await User.findOne({ email: cEmail });
        if (existingCustomer) {
          existingCustomer.role_id = userRole._id;
          existingCustomer.password = hashedCustomerPassword;
          existingCustomer.isEmailVerified = true;
          await existingCustomer.save();
        } else {
          await User.create({
            name: 'Demo Customer',
            email: cEmail,
            password: hashedCustomerPassword,
            role_id: userRole._id,
            isEmailVerified: true,
          });
        }
      }

      // Ensure demo account aaravipooner8424@gmail.com works with password 'aaravi'
      const hashedAaraviPassword = await bcrypt.hash('aaravi', salt);
      const aaraviUser = await User.findOne({ email: 'aaravipooner8424@gmail.com' });
      if (aaraviUser) {
        aaraviUser.password = hashedAaraviPassword;
        aaraviUser.isEmailVerified = true;
        await aaraviUser.save();
      } else {
        await User.create({
          name: 'Aaravi Pooner',
          email: 'aaravipooner8424@gmail.com',
          password: hashedAaraviPassword,
          role_id: userRole._id,
          isEmailVerified: true,
        });
      }
      console.log('Customer demo accounts verified & active.');
    }
  } catch (error) {
    console.error(` Admin seeding failed: ${error.message}`);
    throw error;
  }
};

module.exports = seedAdmin;

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await seedAdmin();
      console.log('Admin & User seeder completed successfully.');
      process.exit(0);
    } catch (err) {
      console.error('Admin seeder execution error:', err);
      process.exit(1);
    }
  })();
}
