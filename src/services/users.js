/**
 * User accounts. Minimal but real: bcrypt password hashing, JWT sessions,
 * email verification, and password reset (both via a short-lived token
 * stored in Redis and emailed as a link back to the dashboard).
 * Stored in Redis (fine for MVP scale; move to Postgres when you have
 * real users and need relational queries/indexes on email, etc.)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const redis = require('../clients/redisClient');
const { sendMail } = require('../clients/mailer');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';
const JWT_EXPIRY = '7d';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');

const VERIFY_TOKEN_TTL_SEC = 60 * 60 * 48; // 48h to click the verification link
const RESET_TOKEN_TTL_SEC = 60 * 60; // 1h to use a password reset link

async function getUserById(userId) {
  const raw = await redis.get(`user:id:${userId}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveUser(user) {
  await redis.set(`user:id:${user.userId}`, JSON.stringify(user));
}

async function sendVerificationEmail(user) {
  const token = crypto.randomBytes(24).toString('hex');
  await redis.set(`verify:token:${token}`, user.userId, 'EX', VERIFY_TOKEN_TTL_SEC);

  const link = `${PUBLIC_URL}/?verifyToken=${token}`;
  try {
    await sendMail({
      to: user.email,
      subject: 'Verify your Throttle account',
      html: `<p>Confirm your email to finish setting up your Throttle account:</p>
             <p><a href="${link}">${link}</a></p>
             <p>This link expires in 48 hours.</p>`,
    });
  } catch (err) {
    // Don't let a broken mail server block signup — the account still
    // works, just stays unverified until the user requests another email.
    console.error('Failed to send verification email:', err.message);
  }
}

async function signup(email, password) {
  email = email.trim().toLowerCase();
  const existing = await redis.get(`user:email:${email}`);
  if (existing) throw new Error('Email already registered');

  const userId = crypto.randomBytes(8).toString('hex');
  const passwordHash = await bcrypt.hash(password, 10);

  const user = { userId, email, passwordHash, emailVerified: false, createdAt: Date.now() };
  await redis.set(`user:id:${userId}`, JSON.stringify(user));
  await redis.set(`user:email:${email}`, userId);

  await sendVerificationEmail(user);

  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return { userId, email, token };
}

async function login(email, password) {
  email = email.trim().toLowerCase();
  const userId = await redis.get(`user:email:${email}`);
  if (!userId) throw new Error('Invalid email or password');

  const user = await getUserById(userId);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid email or password');

  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return { userId, email, token };
}

async function verifyEmail(token) {
  const userId = await redis.get(`verify:token:${token}`);
  if (!userId) throw new Error('Verification link is invalid or has expired');

  const user = await getUserById(userId);
  if (!user) throw new Error('Account no longer exists');

  user.emailVerified = true;
  await saveUser(user);
  await redis.del(`verify:token:${token}`);
  return { email: user.email };
}

async function requestPasswordReset(email) {
  email = email.trim().toLowerCase();
  const userId = await redis.get(`user:email:${email}`);
  // Deliberately don't reveal whether the email exists — same response
  // either way, so this endpoint can't be used to enumerate accounts.
  if (!userId) return;

  const token = crypto.randomBytes(24).toString('hex');
  await redis.set(`reset:token:${token}`, userId, 'EX', RESET_TOKEN_TTL_SEC);

  const link = `${PUBLIC_URL}/?resetToken=${token}`;
  try {
    await sendMail({
      to: email,
      subject: 'Reset your Throttle password',
      html: `<p>Someone (hopefully you) asked to reset the password for this Throttle account.</p>
             <p><a href="${link}">${link}</a></p>
             <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    // Never let this surface differently than the "email not found" case
    // (same silent return) — otherwise a mail-server hiccup would let an
    // attacker tell which emails have accounts by which ones fail loudly.
    console.error('Failed to send password reset email:', err.message);
  }
}

async function resetPassword(token, newPassword) {
  const userId = await redis.get(`reset:token:${token}`);
  if (!userId) throw new Error('Reset link is invalid or has expired');

  const user = await getUserById(userId);
  if (!user) throw new Error('Account no longer exists');

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await saveUser(user);
  await redis.del(`reset:token:${token}`);
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

module.exports = {
  signup,
  login,
  verifyToken,
  requireAuth,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
};
