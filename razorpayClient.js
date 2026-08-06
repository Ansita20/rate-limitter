/**
 * Shared Razorpay client, configured via env vars.
 *
 * RAZORPAY_KEY_ID   — safe to expose to the frontend (it's public by design).
 * RAZORPAY_KEY_SECRET — must NEVER reach frontend code, logs, or git. It only
 *   lives here, read from process.env, exactly like JWT_SECRET / REDIS_URL.
 */

const Razorpay = require('razorpay');

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn(
    '[razorpay] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set in .env — ' +
    'payment endpoints will fail until both are configured.'
  );
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
