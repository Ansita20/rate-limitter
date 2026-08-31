/**
 * User accounts. Minimal but real: bcrypt password hashing, JWT sessions.
 * Stored in Redis (fine for MVP scale; move to Postgres when you have
 * real users and need relational queries/indexes on email, etc.)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const redis = require('../clients/redisClient');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';
const JWT_EXPIRY = '7d';

async function signup(email, password) {
  email = email.trim().toLowerCase();
  const existing = await redis.get(`user:email:${email}`);
  if (existing) throw new Error('Email already registered');

  const userId = crypto.randomBytes(8).toString('hex');
  const passwordHash = await bcrypt.hash(password, 10);

  const user = { userId, email, passwordHash, createdAt: Date.now() };
  await redis.set(`user:id:${userId}`, JSON.stringify(user));
  await redis.set(`user:email:${email}`, userId);

  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return { userId, email, token };
}

async function login(email, password) {
  email = email.trim().toLowerCase();
  const userId = await redis.get(`user:email:${email}`);
  if (!userId) throw new Error('Invalid email or password');

  const raw = await redis.get(`user:id:${userId}`);
  const user = JSON.parse(raw);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid email or password');

  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return { userId, email, token };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** Express middleware: requires a valid JWT in Authorization: Bearer <token> */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization: Bearer <token> header' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = payload; // { userId, email }
  next();
}

module.exports = { signup, login, verifyToken, requireAuth };
