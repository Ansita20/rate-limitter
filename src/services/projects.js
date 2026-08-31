/**
 * Project management: each "project" = one customer's config
 * (which algorithm, limits, etc.), identified by an API key.
 *
 * Stored in Redis so it survives restarts / works across multiple
 * API server instances.
 */

const crypto = require('crypto');
const redis = require('../clients/redisClient');

const VALID_ALGOS = [
  'fixed-window',
  'sliding-window-log',
  'sliding-window-counter',
  'token-bucket',
  'leaky-bucket',
  'auto', // heuristic traffic-adaptive mode — requires `limit` + `windowSec`
];

function generateApiKey() {
  return 'rlk_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Create a new project/config, owned by a userId.
 * config examples:
 *   { algo: 'sliding-window-counter', limit: 100, windowSec: 60 }
 *   { algo: 'token-bucket', capacity: 50, refillRatePerSec: 5 }
 *   { algo: 'leaky-bucket', capacity: 50, leakRatePerSec: 5 }
 */
async function createProject(userId, name, config) {
  if (!VALID_ALGOS.includes(config.algo)) {
    throw new Error(`Invalid algo. Must be one of: ${VALID_ALGOS.join(', ')}`);
  }

  const apiKey = generateApiKey();
  const projectId = crypto.randomBytes(8).toString('hex');

  const record = {
    projectId,
    userId,
    name,
    apiKey,
    createdAt: Date.now(),
    ...config,
  };

  await redis.set(`project:${apiKey}`, JSON.stringify(record));
  await redis.sadd(`user:${userId}:projects`, apiKey);
  return record;
}

/** List all projects owned by a user (API keys included — only shown to the owner) */
async function listProjectsForUser(userId) {
  const apiKeys = await redis.smembers(`user:${userId}:projects`);
  if (apiKeys.length === 0) return [];
  const raw = await Promise.all(apiKeys.map((k) => redis.get(`project:${k}`)));
  return raw.filter(Boolean).map((r) => JSON.parse(r));
}

/** Delete a project — only if the requesting user owns it */
async function deleteProject(userId, apiKey) {
  const project = await getProjectByApiKey(apiKey);
  if (!project) throw new Error('Project not found');
  if (project.userId !== userId) throw new Error('Not authorized to delete this project');

  await redis.del(`project:${apiKey}`);
  await redis.srem(`user:${userId}:projects`, apiKey);
  return true;
}

async function getProjectByApiKey(apiKey) {
  const raw = await redis.get(`project:${apiKey}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

async function updateProjectConfig(apiKey, newConfig) {
  const existing = await getProjectByApiKey(apiKey);
  if (!existing) throw new Error('Project not found');
  const updated = { ...existing, ...newConfig };
  await redis.set(`project:${apiKey}`, JSON.stringify(updated));
  return updated;
}

module.exports = {
  VALID_ALGOS,
  createProject,
  getProjectByApiKey,
  updateProjectConfig,
  listProjectsForUser,
  deleteProject,
};
