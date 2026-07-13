'use strict';

const experimentService = require('../services/experimentService');

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

module.exports = async function experimentRoutes(fastify, opts) {
  const db = opts.db;
  experimentService.ensureTables(db);

  fastify.get('/', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const items = experimentService.getExperiments(db, userId);
      return { success: true, experiments: items };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.post('/', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    const { hypothesis, action } = request.body || {};
    if (!hypothesis || !hypothesis.trim()) {
      return reply.status(400).send({ error: 'hypothesis is required.' });
    }
    if (!action || !action.trim()) {
      return reply.status(400).send({ error: 'action is required.' });
    }
    try {
      const result = experimentService.createExperiment(db, request.user.id, hypothesis, action);
      return { success: true, experiment: result };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    const { id } = request.params;
    const { status, result } = request.body || {};
    if (!status) {
      return reply.status(400).send({ error: 'status is required.' });
    }
    try {
      const updated = experimentService.updateExperiment(db, request.user.id, id, status, result);
      return { success: true, experiment: updated };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    const { id } = request.params;
    try {
      const success = experimentService.deleteExperiment(db, request.user.id, id);
      return { success };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
};
