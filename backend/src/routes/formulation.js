'use strict';

const formulationService = require('../services/formulationService');

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

module.exports = async function formulationRoutes(fastify, opts) {
  const db = opts.db;
  formulationService.ensureTables(db);

  fastify.get('/', async (request, reply) => {
    // Optional: if auth required, uncomment below:
    // if (!request.user?.id) return reply.status(401).send({ error: 'Authentication required.' });
    const userId = resolveUserId(request);
    try {
      const items = formulationService.getFormulations(db, userId);
      return { success: true, formulations: items };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.post('/', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    const { inputText } = request.body || {};
    if (!inputText || !inputText.trim()) {
      return reply.status(400).send({ error: 'inputText is required.' });
    }
    try {
      const result = await formulationService.formulate(db, request.user.id, inputText);
      return { success: true, formulation: result };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
};
