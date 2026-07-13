'use strict';

const profileVariantService = require('../services/profileVariantService');

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

const VALID_KINDS = new Set(['scholarship', 'job', 'study', 'project']);

module.exports = async function profileVariantsRoutes(fastify, opts) {
  const db = opts.db;
  profileVariantService.ensureTables(db);

  // GET /api/v1/profile-variants
  fastify.get('/', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const variants = profileVariantService.getVariants(db, userId);
      return { success: true, variants };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // POST /api/v1/profile-variants/generate
  fastify.post('/generate', async (request, reply) => {
    const userId = resolveUserId(request);
    const { kind } = request.body || {};
    if (!kind || !VALID_KINDS.has(kind)) {
      return reply.status(400).send({
        success: false,
        error: `kind is required and must be one of: ${Array.from(VALID_KINDS).join(', ')}`,
      });
    }

    try {
      const variant = await profileVariantService.generateVariant(db, userId, kind);
      return { success: true, variant };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // POST /api/v1/profile-variants/save
  fastify.post('/save', async (request, reply) => {
    const userId = resolveUserId(request);
    const { kind, title, body } = request.body || {};
    if (!kind || !VALID_KINDS.has(kind)) {
      return reply.status(400).send({
        success: false,
        error: `kind is required and must be one of: ${Array.from(VALID_KINDS).join(', ')}`,
      });
    }
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ success: false, error: 'body is required and must be an object' });
    }

    try {
      const defaultTitle = title || `${kind.charAt(0).toUpperCase() + kind.slice(1)} Variant`;
      const id = profileVariantService.saveVariant(db, userId, kind, defaultTitle, body);
      return { success: true, id };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
};
