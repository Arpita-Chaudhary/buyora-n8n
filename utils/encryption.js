const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';
const SALT = 'admin_panel_token_salt';
const getEncryptionKey = () => {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || 'fallback_secret_key_32_bytes_len';
  return crypto.scryptSync(secret, SALT, 32);
};
const encryptToken = (token) => {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token provided for encryption');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16); // 16-byte IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: ivHex:authTagHex:encryptedHex
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};
const decryptToken = (encryptedToken) => {
  if (!encryptedToken || typeof encryptedToken !== 'string') {
    throw new Error('Invalid encrypted token format');
  }
  const parts = encryptedToken.split(':');
  if (parts.length !== 3) {
    // If it is not in 3 parts, it's either an invalid token or an unencrypted legacy JWT
    throw new Error('Malformed encrypted token');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
module.exports = {
  encryptToken,
  decryptToken,
};
