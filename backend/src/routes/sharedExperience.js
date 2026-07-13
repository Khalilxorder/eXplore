'use strict';

const sharedExperienceService = require('../services/sharedExperienceService');

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

module.exports = async function sharedExperienceRoutes(fastify, opts) {
  const db = opts.db;
  sharedExperienceService.ensureTables(db);

  fastify.get('/projects', async (request, reply) => {
    try {
      return {
        success: true,
        ...sharedExperienceService.listProjects(db, resolveUserId(request)),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Shared projects lookup failed', details: error.message });
    }
  });

  fastify.post('/items', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    try {
      const item = sharedExperienceService.addItem(db, request.user.id, request.body || {});
      return { success: true, item };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Shared item save failed', details: error.message });
    }
  });

  fastify.post('/interact', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    try {
      return sharedExperienceService.interact(db, request.user.id, request.body || {});
    } catch (error) {
      request.log.error(error);
      return reply.status(error.statusCode || 500).send({ error: 'Shared interaction failed', details: error.message });
    }
  });
};
