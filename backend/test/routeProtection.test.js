const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRequestPath,
  isProtectedRequest,
} = require('../src/http/routeProtection');

const protectedPrefixes = [
  '/api/v1/interactions',
  '/api/v1/history',
  '/api/v1/saved',
  '/api/v1/alerts/feed',
  '/api/v1/ingest',
  '/api/v1/preferences',
  '/api/v1/sources',
  '/api/v1/collections',
  '/api/v1/subscription',
  '/api/v1/family',
  '/api/v1/referral',
  '/api/v1/affiliate/click',
  '/api/v1/digest',
  '/api/v1/devices',
  '/api/v1/meta',
  '/api/v1/discovery',
  '/api/v1/template',
  '/api/v1/hierarchy',
];

const publicExactRoutes = new Set([
  '/api/v1/health',
  '/api/v1/readiness',
  '/api/v1/readiness/vision',
  '/api/v1/messages/readiness',
  '/api/v1/auth/google/status',
  '/api/v1/sources/status',
  '/api/v1/subscription/tiers',
  '/api/v1/news/brief',
  '/api/v1/meta/oauth/callback',
  '/api/v1/meta/webhook',
]);

test('public Meta webhook remains public when Meta sends verification query parameters', () => {
  assert.equal(
    getRequestPath('/api/v1/meta/webhook?hub.mode=subscribe&hub.challenge=123'),
    '/api/v1/meta/webhook',
  );
  assert.equal(
    isProtectedRequest(
      '/api/v1/meta/webhook?hub.mode=subscribe&hub.challenge=123',
      protectedPrefixes,
      publicExactRoutes,
    ),
    false,
  );
});

test('public Meta OAuth callback remains public when Meta returns authorization query parameters', () => {
  assert.equal(
    isProtectedRequest(
      '/api/v1/meta/oauth/callback?code=abc&state=def',
      protectedPrefixes,
      publicExactRoutes,
    ),
    false,
  );
});

test('Meta inbox routes remain protected', () => {
  assert.equal(
    isProtectedRequest('/api/v1/meta/overview', protectedPrefixes, publicExactRoutes),
    true,
  );
});

test('Hierarchy routes are protected globally', () => {
  assert.equal(
    isProtectedRequest('/api/v1/hierarchy', protectedPrefixes, publicExactRoutes),
    true,
  );
  assert.equal(
    isProtectedRequest('/api/v1/hierarchy/state', protectedPrefixes, publicExactRoutes),
    true,
  );
  assert.equal(
    isProtectedRequest('/api/v1/hierarchy/goal', protectedPrefixes, publicExactRoutes),
    true,
  );
  assert.equal(
    isProtectedRequest('/api/v1/hierarchy/self-data', protectedPrefixes, publicExactRoutes),
    true,
  );
});

test('Template routes are protected globally', () => {
  assert.equal(
    isProtectedRequest('/api/v1/template', protectedPrefixes, publicExactRoutes),
    true,
  );
  assert.equal(
    isProtectedRequest('/api/v1/template/refine', protectedPrefixes, publicExactRoutes),
    true,
  );
  assert.equal(
    isProtectedRequest('/api/v1/template/config', protectedPrefixes, publicExactRoutes),
    true,
  );
});

test('Standard public endpoints remain public', () => {
  assert.equal(
    isProtectedRequest('/api/v1/health', protectedPrefixes, publicExactRoutes),
    false,
  );
  assert.equal(
    isProtectedRequest('/api/v1/readiness', protectedPrefixes, publicExactRoutes),
    false,
  );
});
