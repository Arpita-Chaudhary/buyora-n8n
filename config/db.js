const mongoose = require('mongoose');

// Never buffer queries when disconnected (fail fast with descriptive error)
mongoose.set('bufferCommands', false);

const DEFAULT_ATLAS_URI =
  'mongodb+srv://Arpita:arpita%402004@cluster0.pyaqdub.mongodb.net/admin_panel?retryWrites=true&w=majority&appName=Cluster0';

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  let mongoUri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URL;

  // If missing or pointing to localhost or old user, use the verified Arpita Atlas URI
  if (
    !mongoUri ||
    mongoUri.includes('localhost') ||
    mongoUri.includes('127.0.0.1') ||
    mongoUri.includes('choudharyarpita504') ||
    mongoUri.includes('Buyora') ||
    !mongoUri.startsWith('mongodb')
  ) {
    console.log('[DB] Using verified MongoDB Atlas production cluster connection (Arpita)...');
    mongoUri = DEFAULT_ATLAS_URI;
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }

    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[DB] MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[DB] Connection failed on ${mongoUri}: ${error.message}`);
    if (mongoUri !== DEFAULT_ATLAS_URI) {
      console.log('[DB] Retrying immediately with verified DEFAULT_ATLAS_URI...');
      try {
        await mongoose.disconnect().catch(() => {});
        const fallbackConn = await mongoose.connect(DEFAULT_ATLAS_URI, {
          serverSelectionTimeoutMS: 8000,
        });
        console.log(`[DB] Fallback MongoDB Connected: ${fallbackConn.connection.host}`);
        return fallbackConn;
      } catch (fallbackErr) {
        console.error(`[DB] Fallback error: ${fallbackErr.message}`);
      }
    }
  }
};

module.exports = connectDB;
