'use strict';

function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  return {
    check(key, now = Date.now()) {
      const normalizedKey = String(key || 'unknown');
      let entry = buckets.get(normalizedKey);

      if (!entry || now - entry.windowStart > windowMs) {
        entry = { count: 0, windowStart: now };
      }

      entry.count += 1;
      buckets.set(normalizedKey, entry);

      const allowed = entry.count <= max;
      const retryAfterMs = allowed ? 0 : Math.max(0, windowMs - (now - entry.windowStart));

      return {
        allowed,
        retryAfterMs,
        count: entry.count,
      };
    },
    reset(key) {
      buckets.delete(String(key || 'unknown'));
    },
    clear() {
      buckets.clear();
    },
  };
}

function resolveClientIp(request) {
  return String(request?.ip || 'unknown').trim();
}

function applyRateLimit(reply, result, message = 'Rate limit exceeded.') {
  if (result.allowed) {
    return true;
  }

  reply.header('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  reply.status(429).send({
    error: message,
    retry_after_ms: result.retryAfterMs,
  });
  return false;
}

module.exports = {
  createRateLimiter,
  resolveClientIp,
  applyRateLimit,
};