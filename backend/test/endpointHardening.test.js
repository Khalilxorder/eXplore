'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRequestPath,
  isProtectedRequest,
} = require('../src/http/routeProtection');
const { createRateLimiter, applyRateLimit } = require('../src/http/rateLimit');
const Fastify = require('fastify');

const protectedPrefixes = [
  '/api/events',
  '/api/v1/events',
  '/api/v1/intelligence',
  '/api/v1/admin',
];

const publicExactRoutes = new Set([
  '/api/v1/health',
  '/api/v1/auth/capabilities',
]);

test('telemetry aliases are protected by route prefixes', () => {
  assert.equal(
    isProtectedRequest('/api/events/batch', protectedPrefixes, publicExactRoutes),
    true,
  );
  assert.equal(
    isProtectedRequest('/api/v1/events/batch', protectedPrefixes, publicExactRoutes),
    true,
  );
  assert.equal(
    isProtectedRequest('/api/v1/intelligence/events/batch', protectedPrefixes, publicExactRoutes),
    true,
  );
});

test('auth capabilities endpoint remains public', () => {
  assert.equal(
    isProtectedRequest('/api/v1/auth/capabilities', protectedPrefixes, publicExactRoutes),
    false,
  );
  assert.equal(getRequestPath('/api/v1/auth/capabilities?foo=1'), '/api/v1/auth/capabilities');
});

test('createRateLimiter enforces max requests per window', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 });

  assert.equal(limiter.check('user-1').allowed, true);
  assert.equal(limiter.check('user-1').allowed, true);
  const blocked = limiter.check('user-1');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('applyRateLimit returns false and sends 429 when blocked', async () => {
  const fastify = Fastify();
  const reply = {
    statusCode: 200,
    headers: {},
    body: null,
    header(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };

  const allowed = applyRateLimit(reply, { allowed: true, retryAfterMs: 0 });
  assert.equal(allowed, true);

  const blocked = applyRateLimit(reply, { allowed: false, retryAfterMs: 1500 }, 'Too many');
  assert.equal(blocked, false);
  assert.equal(reply.statusCode, 429);
  assert.equal(reply.body.error, 'Too many');
  assert.equal(reply.headers['Retry-After'], '2');

  await fastify.close();
});