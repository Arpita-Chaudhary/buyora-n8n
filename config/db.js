const mongoose = require('mongoose');

const DEFAULT_ATLAS_URI =
  'mongodb+srv://choudharyarpita504_db_userr:Buyora%2540123456@cluster0.pyaqdub.mongodb.net/admin_panel?retryWrites=true&w=majority&appName=Cluster0';

const connectDB = async () => {
  let mongoUri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URL;

  // On cloud platforms (Render) or if localhost is specified without local mongo, use Atlas
  if (
    !mongoUri ||
    mongoUri.includes('localhost') ||
    mongoUri.includes('127.0.0.1')
  ) {
    console.log('[DB] Using MongoDB Atlas production cluster connection...');
    mongoUri = DEFAULT_ATLAS_URI;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 7000,
    });
    console.log(`[DB] MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[DB] Error connecting with primary URI: ${error.message}`);
    if (mongoUri !== DEFAULT_ATLAS_URI) {
      console.log('[DB] Retrying connection with Atlas fallback URI...');
      try {
        const fallbackConn = await mongoose.connect(DEFAULT_ATLAS_URI, {
          serverSelectionTimeoutMS: 7000,
        });
        console.log(`[DB] MongoDB Connected via fallback: ${fallbackConn.connection.host}`);
        return fallbackConn;
      } catch (fallbackErr) {
        console.error(`[DB] Fallback connection failed: ${fallbackErr.message}`);
      }
    }
  }
};

module.exports = connectDB;
