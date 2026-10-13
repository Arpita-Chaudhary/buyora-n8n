const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure destination directory exists: uploads/products/
const uploadDir = path.join(__dirname, '..', 'uploads', 'products');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration with unique naming
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product-${uniqueSuffix}${ext}`);
  },
});

// File filter: only allow jpg, jpeg, png, webp
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /jpeg|jpg|png|webp/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const mimeType = file.mimetype.toLowerCase();

  const isExtAllowed = allowedExtensions.test(ext);
  const isMimeAllowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimeType);

  if (isExtAllowed && isMimeAllowed) {
    return cb(null, true);
  }
  cb(new Error('Invalid image format. Allowed formats: jpg, jpeg, png, webp'));
};

// Multer upload instance with 5MB file-size limit
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter,
});

// Middleware wrapper to handle upload errors and return clean JSON
const uploadProductImage = (req, res, next) => {
  const singleUpload = upload.single('image');

  singleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum allowed size is 5MB',
        });
      }
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Image upload failed',
      });
    }
    next();
  });
};

// Safely removes a local product image file from uploads/products/
const deleteLocalImage = (imagePath) => {
  if (!imagePath || typeof imagePath !== 'string') return;

  try {
    const normalized = imagePath.replace(/\\/g, '/');
    const relativePath = normalized.startsWith('/') ? normalized.slice(1) : normalized;

    // Security check: Only delete files located inside uploads/products/
    if (relativePath.startsWith('uploads/products/')) {
      const fullPath = path.join(__dirname, '..', relativePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`Deleted old product image: ${relativePath}`);
      }
    }
  } catch (err) {
    console.error(`Failed to delete local product image: ${err.message}`);
  }
};

module.exports = {
  uploadProductImage,
  deleteLocalImage,
};
