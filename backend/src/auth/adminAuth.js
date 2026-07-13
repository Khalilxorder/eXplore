'use strict';

function parseAdminUserIds() {
  return String(process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function getAdminApiSecret() {
  return String(process.env.ADMIN_API_SECRET || '').trim();
}

function isTruthyEnv(name, defaultValue = 'true') {
  const value = String(process.env[name] ?? defaultValue).toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function isAdminUser(request) {
  const userId = request?.user?.id;
  if (!userId) {
    return false;
  }

  const allowlist = parseAdminUserIds();
  if (allowlist.length === 0) {
    return false;
  }

  return allowlist.includes(userId);
}

function hasValidAdminApiSecret(request) {
  const expected = getAdminApiSecret();
  if (!expected) {
    return false;
  }

  const header = String(request.headers['x-admin-secret'] || '').trim();
  const authorization = String(request.headers.authorization || '').trim();
  return header === expected || authorization === `Bearer ${expected}`;
}

function isAuthorizedAdminRequest(request) {
  return isAdminUser(request) || hasValidAdminApiSecret(request);
}

function buildForbiddenAdminResponse(reply, message = 'Admin access required.') {
  return reply.status(403).send({
    error: message,
    admin_required: true,
  });
}

function requireAdminAccess(request, reply) {
  if (isAuthorizedAdminRequest(request)) {
    return true;
  }

  buildForbiddenAdminResponse(reply);
  return false;
}

function telemetryAuthRequired() {
  return isTruthyEnv('REQUIRE_AUTH_FOR_TELEMETRY', 'true');
}

function feedRefreshAuthRequired() {
  return isTruthyEnv('REQUIRE_AUTH_FOR_FEED_REFRESH', 'true');
}

function requireAuthenticatedUser(request, reply) {
  if (request?.user?.id) {
    return true;
  }

  reply.status(401).send({
    error: 'Authentication required.',
    auth_required: true,
  });
  return false;
}

module.exports = {
  parseAdminUserIds,
  getAdminApiSecret,
  isAdminUser,
  hasValidAdminApiSecret,
  isAuthorizedAdminRequest,
  requireAdminAccess,
  buildForbiddenAdminResponse,
  telemetryAuthRequired,
  feedRefreshAuthRequired,
  requireAuthenticatedUser,
};