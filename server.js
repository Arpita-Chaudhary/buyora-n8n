const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const { initSocket } = require('./config/socket');
const seedRoles = require('./seeders/roleSeeder');
const seedAdmin = require('./seeders/adminSeeder');
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const productRoutes = require('./routes/productRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const deliveryZoneRoutes = require('./routes/deliveryZoneRoutes');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
// 1. Load environment variables from .env file
dotenv.config();
// 2. Initialize Express Application
const app = express();
// 3. Create HTTP Server and Attach Socket.IO
const server = http.createServer(app);
initSocket(server);
// 4. Core Middlewares
app.use(cors());
// Parse incoming JSON and preserve rawBody buffer for Stripe webhook signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// 5. Base Route & Health Route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to the Backend REST API Server with Socket.IO Real-Time Tracking',
  });
});
app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  res.status(200).json({
    success: true,
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    databaseHost: mongoose.connection.host || null,
  });
});
// 6. Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/delivery-zones', deliveryZoneRoutes);
app.use('/api/delivery-zones', deliveryZoneRoutes);
app.use('/api/products', productRoutes);
app.use('/api/payments', paymentRoutes);
// 7. Error Handling Middlewares (Must be defined after routes)
app.use(notFound);
app.use(errorHandler);
// 8. Start Database, Seeders, and Server with Distinct Section Headings
const PORT = process.env.PORT || 5000;
const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Start HTTP server immediately so port 5000 is listening and proxy requests aren't refused
    console.log('\n========================================');
    console.log('             SERVER STATUS              ');
    console.log('========================================');
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
      console.log(`Socket.IO real-time engine attached and listening on port ${PORT}`);
      console.log('========================================\n');
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
        process.exit(1);
      } else {
        console.error(`Server error: ${err.message}`);
        process.exit(1);
      }
    });

    // 3. Role Seeder Section
    console.log('\n========================================');
    console.log('              ROLE SEEDER               ');
    console.log('========================================');
    await seedRoles();

    // 4. Admin Seeder Section
    console.log('\n========================================');
    console.log('              ADMIN SEEDER              ');
    console.log('========================================');
    await seedAdmin();

    // 5. Delivery Zone Seeder Section
    const seedDeliveryZones = require('./seeders/deliveryZoneSeeder');
    await seedDeliveryZones();

    // 6. Product Seeder Section (ensures default backend products are synced)
    console.log('\n========================================');
    console.log('             PRODUCT SEEDER             ');
    console.log('========================================');
    const seedProducts = require('./seeders/productSeeder');
    await seedProducts();

    // 7. Verify Nodemailer Email Service in background (does not block port 5000)
    const { verifyEmailService } = require('./utils/emailService');
    verifyEmailService().catch((err) => {
      console.warn(`[EMAIL SERVICE] Warning: ${err.message}`);
    });
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`);
  }
};
startServer();
