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
const razorpay = require('../clients/razorpayClient');
const { getProjectByApiKey, updateProjectConfig } = require('./projects');

// Fixed plan price, decided server-side — never trust a client-supplied
// amount for what to charge (a devtools edit could otherwise pay ₹1 for a
// ₹99 upgrade). If you add more plans later, look their price up here too.
const UPGRADE_PRICE_PAISE = 9900;

// Multiplier applied to a project's rate-limit config on upgrade. Same
// factor regardless of algo — see applyUpgrade() below for which fields
// it multiplies per algo.
const UPGRADE_MULTIPLIER = 5;

/**
 * POST /v1/payments/create-order
 * Body: { apiKey, receipt }
 *
 * The apiKey is stamped into the Razorpay order's own `notes` so that
 * verify-payment can later trust "which project is this for" from
 * Razorpay's own record instead of a second, independently-tamperable
 * client-supplied field.
 */
async function createOrder(req, res) {
  const { apiKey, receipt } = req.body || {};

  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required' });
  }

  const project = await getProjectByApiKey(apiKey);
  if (!project || project.userId !== req.user.userId) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (project.plan === 'pro') {
    return res.status(400).json({ error: 'This project is already upgraded' });
  }

  try {
    // Razorpay caps `receipt` at 56 chars — keep it short and derive from
    // the (much shorter) projectId rather than the full apiKey.
    const shortReceipt = `upg_${project.projectId}_${Date.now()}`.slice(0, 56);

    const order = await razorpay.orders.create({
      amount: UPGRADE_PRICE_PAISE,
      currency: 'INR',
      receipt: receipt && receipt.length <= 56 ? receipt : shortReceipt,
      notes: { apiKey, userId: req.user.userId },
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
 * Raises a project's rate limit by UPGRADE_MULTIPLIER, in place, using
 * whichever numeric fields its algo actually uses.
 */
function applyUpgrade(project) {
  const patch = { plan: 'pro', upgradedAt: Date.now() };
  if (project.limit) patch.limit = project.limit * UPGRADE_MULTIPLIER;
  if (project.capacity) patch.capacity = project.capacity * UPGRADE_MULTIPLIER;
  if (project.refillRatePerSec) patch.refillRatePerSec = project.refillRatePerSec * UPGRADE_MULTIPLIER;
  if (project.leakRatePerSec) patch.leakRatePerSec = project.leakRatePerSec * UPGRADE_MULTIPLIER;
  return patch;
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
async function verifyPayment(req, res) {
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

  // The payment is cryptographically confirmed as genuine. Now find out
  // which project it was for from Razorpay's own order record (set by us
  // in createOrder) rather than trusting a client-supplied apiKey here.
  let order;
  try {
    order = await razorpay.orders.fetch(razorpay_order_id);
  } catch (err) {
    console.error('Could not fetch Razorpay order for verification:', err.error || err.message || err);
    return res.status(502).json({ verified: false, error: 'Could not confirm order details with Razorpay' });
  }

  const apiKey = order?.notes?.apiKey;
  const project = apiKey ? await getProjectByApiKey(apiKey) : null;
  if (!project || project.userId !== req.user.userId) {
    return res.status(404).json({ verified: false, error: 'Project for this order was not found' });
  }

  if (project.plan !== 'pro') {
    await updateProjectConfig(apiKey, applyUpgrade(project));
  }

  res.json({ verified: true, orderId: razorpay_order_id, paymentId: razorpay_payment_id, apiKey, upgraded: true });
}

module.exports = { createOrder, verifyPayment };
