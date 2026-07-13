'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAdminUserIds,
  isAdminUser,
  isAuthorizedAdminRequest,
  telemetryAuthRequired,
  feedRefreshAuthRequired,
} = require('../src/auth/adminAuth');

test('parseAdminUserIds splits and trims allowlist entries', () => {
  const previous = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = ' user-1 , user-2, ,user-3 ';

  try {
    assert.deepEqual(parseAdminUserIds(), ['user-1', 'user-2', 'user-3']);
  } finally {
    process.env.ADMIN_USER_IDS = previous;
  }
});

test('isAdminUser requires allowlisted authenticated user', () => {
  const previous = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = 'admin-1';

  try {
    assert.equal(isAdminUser({ user: { id: 'admin-1' } }), true);
    assert.equal(isAdminUser({ user: { id: 'other-user' } }), false);
    assert.equal(isAdminUser({ user: null }), false);
  } finally {
    process.env.ADMIN_USER_IDS = previous;
  }
});

test('isAuthorizedAdminRequest accepts admin API secret header', () => {
  const previousUsers = process.env.ADMIN_USER_IDS;
  const previousSecret = process.env.ADMIN_API_SECRET;
  process.env.ADMIN_USER_IDS = '';
  process.env.ADMIN_API_SECRET = 'secret-token';

  try {
    assert.equal(isAuthorizedAdminRequest({
      headers: { 'x-admin-secret': 'secret-token' },
    }), true);
    assert.equal(isAuthorizedAdminRequest({
      headers: { authorization: 'Bearer secret-token' },
    }), true);
    assert.equal(isAuthorizedAdminRequest({
      headers: { 'x-admin-secret': 'wrong' },
    }), false);
  } finally {
    process.env.ADMIN_USER_IDS = previousUsers;
    process.env.ADMIN_API_SECRET = previousSecret;
  }
});

test('feature flags default to requiring auth', () => {
  const previousTelemetry = process.env.REQUIRE_AUTH_FOR_TELEMETRY;
  const previousFeed = process.env.REQUIRE_AUTH_FOR_FEED_REFRESH;
  delete process.env.REQUIRE_AUTH_FOR_TELEMETRY;
  delete process.env.REQUIRE_AUTH_FOR_FEED_REFRESH;

  try {
    assert.equal(telemetryAuthRequired(), true);
    assert.equal(feedRefreshAuthRequired(), true);
  } finally {
    process.env.REQUIRE_AUTH_FOR_TELEMETRY = previousTelemetry;
    process.env.REQUIRE_AUTH_FOR_FEED_REFRESH = previousFeed;
  }
});