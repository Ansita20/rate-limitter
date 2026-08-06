/**
 * Razorpay Standard Checkout — order creation + payment verification.
 *
 * Flow (see https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/):
 *   1. Frontend calls POST /v1/payments/create-order to get an order_id.
 *   2. Frontend opens the Razorpay Checkout modal with that order_id.
 *   3. On success, Razorpay hands the frontend a payment_id + signature.
 *   4. Frontend calls POST /v1/payments/verify-payment with all three —
 *      THIS endpoint is the only place a payment is ever trusted as real.
 *      Never mark something as "paid" based on the frontend alone; the
 *      frontend can be tampered with, the signature check can't be.
 */

const crypto = require('crypto');
const razorpay = require('./razorpayClient');

const MIN_AMOUNT_PAISE = 100; // Razorpay's own minimum order amount

/**
 * POST /v1/payments/create-order
 * Body: { amount (in paise), currency = 'INR', receipt }
 *
 * NOTE ON AMOUNT: this endpoint takes `amount` from the request body to match
 * the standard Razorpay quickstart flow. For a real pricing page, prefer
 * deriving the amount server-side from a known plan id (e.g. { planId: 'pro' }
 * -> look up price yourself) rather than trusting a client-supplied amount,
 * so nobody can tamper with the price in devtools before checkout opens.
 */
async function createOrder(req, res) {
  const { amount, currency = 'INR', receipt } = req.body || {};

  if (amount === undefined || typeof amount !== 'number' || !Number.isFinite(amount)) {
    return res.status(400).json({ error: 'amount (in paise, as a number) is required' });
  }
  if (amount < MIN_AMOUNT_PAISE) {
    return res.status(400).json({ error: `amount must be at least ${MIN_AMOUNT_PAISE} paise` });
  }

  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amount),
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
    });

    res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    // The Razorpay SDK surfaces auth failures (bad key_id/key_secret) as 401
    const status = err.statusCode === 401 ? 401 : 500;
    const message = err.statusCode === 401
      ? 'Razorpay authentication failed — check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env'
      : 'Could not create Razorpay order';
    console.error('Razorpay create-order failed:', err.error || err.message || err);
    res.status(status).json({ error: message });
  }
}

/**
 * POST /v1/payments/verify-payment
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * Recomputes the HMAC-SHA256 signature Razorpay expects
 * (order_id + "|" + payment_id, signed with KEY_SECRET) and compares it
 * against what the frontend received. This is the ONLY trustworthy proof
 * that a payment actually succeeded — never skip it.
 */
function verifyPayment(req, res) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      error: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required',
    });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  // Constant-time comparison to avoid leaking signature bytes via timing.
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const givenBuf = Buffer.from(razorpay_signature, 'utf8');
  const valid =
    expectedBuf.length === givenBuf.length && crypto.timingSafeEqual(expectedBuf, givenBuf);

  if (!valid) {
    return res.status(400).json({ verified: false, error: 'Signature mismatch — payment not verified' });
  }

  // At this point the payment is cryptographically confirmed as genuine.
  // This is the spot to mark a user's project/plan as paid (e.g. in Redis,
  // alongside the usage tracking already in limiters.js) — left as a TODO
  // here since it depends on which plan/project this specific payment is for.
  res.json({ verified: true, orderId: razorpay_order_id, paymentId: razorpay_payment_id });
}

module.exports = { createOrder, verifyPayment };
