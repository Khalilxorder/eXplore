'use strict';

const topicService = require('../services/topicService');

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

module.exports = async function topicRoutes(fastify, opts) {
  const db = opts.db;
  topicService.ensureTables(db);

  fastify.get('/api/v1/topics', async (request) => {
    const userId = resolveUserId(request);
    // Ensure the high-priority Jordan × Iran monitoring topic exists (plan Part 9).
    try {
      topicService.ensureJordanIranTopic(db, userId);
    } catch (_) {
      // Non-fatal: catalog/source tables may be mid-bootstrap.
    }
    return {
      success: true,
      topics: topicService.listTopics(db, userId),
    };
  });

  fastify.get('/api/v1/topics/:id', async (request, reply) => {
    const topic = topicService.getTopic(db, resolveUserId(request), request.params.id);
    if (!topic) {
      return reply.code(404).send({ success: false, error: 'Topic not found.' });
    }
    return { success: true, topic };
  });

  fastify.post('/api/v1/topics', async (request, reply) => {
    try {
      const topic = topicService.createTopic(db, resolveUserId(request), request.body || {});
      const suggestions = topicService.suggestSources(db, resolveUserId(request), topic.id) || [];
      return reply.code(201).send({
        success: true,
        topic,
        suggested_sources: suggestions,
        message: 'Topic created. Review and approve its source suggestions before monitoring it.',
      });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error.message || 'Topic could not be created.' });
    }
  });

  fastify.patch('/api/v1/topics/:id', async (request, reply) => {
    try {
      const topic = topicService.updateTopic(db, resolveUserId(request), request.params.id, request.body || {});
      if (!topic) {
        return reply.code(404).send({ success: false, error: 'Topic not found.' });
      }
      const suggestions = topicService.suggestSources(db, resolveUserId(request), topic.id) || [];
      return { success: true, topic, suggested_sources: suggestions };
    } catch (error) {
      return reply.code(400).send({ success: false, error: error.message || 'Topic could not be updated.' });
    }
  });

  fastify.post('/api/v1/topics/:id/discover-sources', async (request, reply) => {
    const suggestions = topicService.suggestSources(db, resolveUserId(request), request.params.id);
    if (!suggestions) {
      return reply.code(404).send({ success: false, error: 'Topic not found.' });
    }
    return { success: true, suggestions };
  });

  fastify.put('/api/v1/topics/:id/sources/:sourceId', async (request, reply) => {
    const approved = request.body?.approved === true;
    const status = request.body?.status || request.body?.approval_status || null;
    const source = topicService.setSourceApproval(
      db,
      resolveUserId(request),
      request.params.id,
      request.params.sourceId,
      approved,
      request.body?.notes,
      status,
    );
    if (!source) {
      return reply.code(404).send({ success: false, error: 'Topic or source not found.' });
    }
    return { success: true, approved: source.status === 'approved', status: source.status, source };
  });

  fastify.get('/api/v1/source-web', async (request, reply) => {
    const topicId = String(request.query?.topicId || request.query?.topic_id || '').trim();
    if (!topicId) {
      return reply.code(400).send({ success: false, error: 'topicId is required.' });
    }
    const sourceWeb = topicService.getSourceWeb(db, resolveUserId(request), topicId);
    if (!sourceWeb) {
      return reply.code(404).send({ success: false, error: 'Topic not found.' });
    }
    return { success: true, source_web: sourceWeb };
  });

  fastify.post('/api/v1/source-web/claims', async (request, reply) => {
    const topicId = String(request.body?.topic_id || '').trim();
    const claimText = String(request.body?.claim_text || '').trim();
    const topic = topicService.getTopic(db, resolveUserId(request), topicId);
    if (!topic || !claimText) {
      return reply.code(400).send({ success: false, error: 'topic_id and claim_text are required.' });
    }
    const id = require('crypto').randomUUID();
    db.prepare(`
      INSERT INTO source_web_claims (id, topic_id, claim_text, status, event_time)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, topicId, claimText, request.body?.status || 'uncertain', request.body?.event_time || null);
    return { success: true, claim: db.prepare('SELECT * FROM source_web_claims WHERE id = ?').get(id) };
  });

  fastify.post('/api/v1/source-web/evidence', async (request, reply) => {
    const claimId = String(request.body?.claim_id || '').trim();
    const claim = db.prepare(`
      SELECT c.* FROM source_web_claims c
      JOIN topics t ON t.id = c.topic_id
      WHERE c.id = ? AND (t.owner_user_id IS NULL OR t.owner_user_id = ?)
    `).get(claimId, resolveUserId(request));
    if (!claim) {
      return reply.code(404).send({ success: false, error: 'Claim not found.' });
    }
    const sourceId = String(request.body?.source_id || '').trim();
    if (sourceId) {
      const approvedSource = db.prepare(`
        SELECT 1
        FROM topic_sources
        WHERE topic_id = ? AND source_id = ? AND user_id = ? AND status = 'approved'
        LIMIT 1
      `).get(claim.topic_id, sourceId, resolveUserId(request));
      if (!approvedSource) {
        return reply.code(400).send({ success: false, error: 'Evidence must use an approved source for this topic.' });
      }
    }
    const id = require('crypto').randomUUID();
    db.prepare(`
      INSERT INTO source_web_evidence (id, claim_id, source_id, relation, url, excerpt, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      claimId,
      sourceId || null,
      request.body?.relation || 'supporting',
      request.body?.url || null,
      request.body?.excerpt || null,
      Number.isFinite(Number(request.body?.confidence)) ? Number(request.body.confidence) : 0.5,
    );
    return { success: true, evidence: db.prepare('SELECT * FROM source_web_evidence WHERE id = ?').get(id) };
  });
};
