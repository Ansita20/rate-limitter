/**
 * Multi-tenant Rate Limiter API
 * ------------------------------
 * Auth:
 *   POST /v1/auth/signup      -> create user account, get JWT
 *   POST /v1/auth/login       -> log in, get JWT
 *
 * Projects (require JWT — Authorization: Bearer <jwt>):
 *   POST   /v1/projects       -> create a project, get API key
 *   GET    /v1/projects       -> list your projects
 *   DELETE /v1/projects/:apiKey -> delete a project you own
 *   GET    /v1/usage/:apiKey  -> this month's request count for a project
 *
 * Rate limiting (requires project API key — Authorization: Bearer <api_key>):
 *   POST /v1/check            -> check + consume rate limit for an identifier
 *
 * Run: npm start   (needs Redis on localhost:6379)
 */

require('dotenv').config(); // loads .env if present — no-op if it doesn't exist

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { requireAuth, signup, login } = require('./services/users');
const {
  createProject,
  getProjectByApiKey,
  listProjectsForUser,
  deleteProject,
  VALID_ALGOS,
} = require('./services/projects');
const { ALGOS, recordUsage, getUsage, autoMode } = require('./services/limiters');
const { createOrder, verifyPayment } = require('./services/payments');

const app = express();
// Running behind a reverse proxy (Caddy) in production — without this,
// express-rate-limit and req.ip see every request as coming from the proxy's
// own address (localhost), pooling every real user into one shared bucket.
app.set('trust proxy', 1);
// Open by default so the /v1/check endpoint can be called straight from any
// site's frontend or backend, in any language. Lock this down to your own
// domain(s) with CORS_ORIGIN (comma-separated) once you're in production —
// see .env.example.
const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true;
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
// path.join(__dirname, '..', 'dashboard') always points at the repo's
// dashboard/ folder, no matter what directory you run this from.
// express.static serves dashboard/index.html automatically at "/".
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

/* ------------------------------------------------------------------ */
/* Self-protection for our own endpoints                              */
/* ------------------------------------------------------------------ */
app.use('/v1/auth', rateLimit({ windowMs: 60_000, max: 10 }));
app.use('/v1/projects', rateLimit({ windowMs: 60_000, max: 30 }));
app.use('/v1/payments', rateLimit({ windowMs: 60_000, max: 20 }));

/* ------------------------------------------------------------------ */
/* AUTH                                                                */
/* ------------------------------------------------------------------ */
app.post('/v1/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'email and password (min 8 chars) are required' });
  }
  try {
    const result = await signup(email, password);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const result = await login(email, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* PROJECTS — require a logged-in user (JWT)                          */
/* ------------------------------------------------------------------ */
app.post('/v1/projects', requireAuth, async (req, res) => {
  const { name, ...config } = req.body || {};

  if (!name || !config.algo) {
    return res.status(400).json({ error: 'name and algo are required' });
  }
  if (!VALID_ALGOS.includes(config.algo)) {
    return res.status(400).json({ error: `algo must be one of: ${VALID_ALGOS.join(', ')}` });
  }
  if (config.algo === 'auto' && (!config.limit || !config.windowSec)) {
    return res.status(400).json({ error: "'auto' algo requires limit and windowSec" });
  }

  try {
    const project = await createProject(req.user.userId, name, config);
    res.status(201).json({ projectId: project.projectId, apiKey: project.apiKey, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/projects', requireAuth, async (req, res) => {
  const projects = await listProjectsForUser(req.user.userId);
  res.json({ projects });
});

app.delete('/v1/projects/:apiKey', requireAuth, async (req, res) => {
  try {
    await deleteProject(req.user.userId, req.params.apiKey);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/v1/usage/:apiKey', requireAuth, async (req, res) => {
  const project = await getProjectByApiKey(req.params.apiKey);
  if (!project || project.userId !== req.user.userId) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const count = await getUsage(project.projectId);
  res.json({ projectId: project.projectId, month: new Date().toISOString().slice(0, 7), requestCount: count });
});

/* ------------------------------------------------------------------ */
/* PAYMENTS — Razorpay Standard Checkout                               */
/* ------------------------------------------------------------------ */

// Public: hands the frontend the (public-by-design) key_id so it never
// has to be hardcoded in dashboard/index.html. KEY_SECRET is never
// returned from here or anywhere else.
app.get('/v1/payments/config', (req, res) => {
  res.json({ keyId: process.env.RAZORPAY_KEY_ID || null });
});

// Requires a logged-in user — we need to know who is paying.
app.post('/v1/payments/create-order', requireAuth, createOrder);
app.post('/v1/payments/verify-payment', requireAuth, verifyPayment);

/* ------------------------------------------------------------------ */
/* RATE LIMIT CHECK — requires a project API key (not a user JWT)     */
/* ------------------------------------------------------------------ */
async function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!apiKey) return res.status(401).json({ error: 'Missing Authorization: Bearer <api_key> header' });

  const project = await getProjectByApiKey(apiKey);
  if (!project) return res.status(401).json({ error: 'Invalid API key' });

  req.project = project;
  next();
}

app.post('/v1/check', requireApiKey, async (req, res) => {
  const { identifier } = req.body || {};
  if (!identifier) {
    return res.status(400).json({ error: "identifier is required (e.g. your end-user's id or IP)" });
  }

  const project = req.project;
  const key = `rl:${project.projectId}:${project.algo}:${identifier}`;

  try {
    let result;
    if (project.algo === 'auto') {
      result = await autoMode(key, project, identifier);
    } else {
      result = await ALGOS[project.algo](key, project);
    }

    // usage tracking for billing — fire and forget, don't block the response on it
    recordUsage(project.projectId).catch((e) => console.error('usage tracking failed:', e));

    res.set('X-RateLimit-Remaining', String(result.remaining));
    if (result.resetMs) res.set('X-RateLimit-Reset', String(result.resetMs));
    res.status(result.allowed ? 200 : 429).json(result);
  } catch (err) {
    console.error('Rate limit check failed:', err);
    res.status(200).json({ allowed: true, remaining: null, resetMs: null, warning: 'limiter_unavailable' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Rate Limit API running on http://localhost:${PORT}`));