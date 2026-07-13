'use strict';

const experienceService = require('../services/experienceService');

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

module.exports = async function experienceRoutes(fastify, opts) {
  const db = opts.db;
  experienceService.ensureTables(db);

  fastify.get('/', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const items = experienceService.getEntries(db, userId);
      return { success: true, entries: items };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.post('/', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    const { kind, body } = request.body || {};
    if (!body || !body.trim()) {
      return reply.status(400).send({ error: 'body is required.' });
    }
    try {
      const result = experienceService.createEntry(db, request.user.id, kind, body);
      return { success: true, entry: result };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.post('/match', async (request, reply) => {
    const payload = request.body || {};
    const story = String(payload.story || payload.body || payload.text || '').trim();
    if (!story) {
      return reply.status(400).send({ error: 'story is required.' });
    }

    try {
      const result = experienceService.matchSong(story, payload.context || {}, payload.profile || {});
      if (request.user?.id) {
        experienceService.createEntry(db, request.user.id, 'experience-match', JSON.stringify({
          story,
          context: payload.context || {},
          match: result.match,
        }));
      }
      return { success: true, ...result };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    const { id } = request.params;
    const { kind, body } = request.body || {};
    if (!body || !body.trim()) {
      return reply.status(400).send({ error: 'body is required.' });
    }
    try {
      const result = experienceService.updateEntry(db, request.user.id, id, kind, body);
      if (!result) {
        return reply.status(404).send({ error: 'Experience entry not found.' });
      }
      return { success: true, entry: result };
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
      const success = experienceService.deleteEntry(db, request.user.id, id);
      return { success };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
};
