'use strict';

const opportunitiesService = require('../../opportunities/opportunitiesService');
const valueHierarchy = require('../services/valueHierarchySync');
const intelligenceContract = require('../services/intelligenceContract');

function decorateOpportunity(item, hierarchy = {}) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    intelligenceExplanation: intelligenceContract.buildExplanation({
      item: {
        ...item,
        title: item.title || item.name,
        summary: item.description || item.summary || item.details,
        url: item.url || item.link || item.application_url || item.source_url,
        source: item.source || item.source_name || item.provider || item.company_or_org,
        publishedAt: item.published_at || item.created_at || item.deadline,
        sourceTrust: item.source_trust || item.trust_score,
        scores: {
          ...(item.scores || {}),
          decisionUsefulness: item.decision_usefulness || item.fit_score || item.match_score,
        },
      },
      hierarchy,
      ranking: { personalFit: item.fit_score || item.match_score || 0.7 },
      source: {
        name: item.source || item.source_name || item.provider || item.company_or_org,
        url: item.source_url || item.url || item.link || item.application_url,
        trust_tier: item.source_trust ? Number(item.source_trust) * 5 : undefined,
        role: item.official_source ? 'official' : 'specialist',
      },
    }),
  };
}

function registerCoverageRoute(fastify) {
  fastify.get('/coverage', async (request, reply) => {
    try {
      return opportunitiesService.getOpportunitySourceCoverage();
    } catch (err) {
      reply.status(500).send({ error: 'Failed to retrieve opportunity coverage', message: err.message });
    }
  });
}

module.exports = async function opportunitiesRoutes(fastify, options) {
  const db = options.db;
  registerCoverageRoute(fastify);
  
  // ─── GET /api/v1/opportunities/jobs ────────────────────────────────
  fastify.get('/jobs', async (request, reply) => {
    try {
      const data = opportunitiesService.getJobs();
      const hierarchy = request.user?.id ? valueHierarchy.getState(db, request.user.id) : {};
      return {
        ...data,
        top10: (data.top10 || []).map((item) => decorateOpportunity(item, hierarchy)),
        recommended: (data.recommended || []).map((item) => decorateOpportunity(item, hierarchy)),
        miss_nothing: (data.miss_nothing || []).map((item) => decorateOpportunity(item, hierarchy)),
        cat1: (data.cat1 || []).map((item) => decorateOpportunity(item, hierarchy)),
        cat2: (data.cat2 || []).map((item) => decorateOpportunity(item, hierarchy)),
        cat3: (data.cat3 || []).map((item) => decorateOpportunity(item, hierarchy)),
      };
    } catch (err) {
      reply.status(500).send({ error: 'Failed to retrieve jobs', message: err.message });
    }
  });

  // ─── GET /api/v1/opportunities/jobs/search ─────────────────────────
  // Miss-nothing search: full high-fit pool, not only top-N diversity shortlist.
  fastify.get('/jobs/search', async (request, reply) => {
    try {
      const payload = opportunitiesService.searchJobs({
        q: request.query.q,
        min_score: request.query.min_score,
        limit: request.query.limit,
        offset: request.query.offset,
        type_group: request.query.type_group,
        location_group: request.query.location_group,
      });
      const hierarchy = request.user?.id ? valueHierarchy.getState(db, request.user.id) : {};
      return {
        ...payload,
        jobs: (payload.jobs || []).map((item) => decorateOpportunity(item, hierarchy)),
      };
    } catch (err) {
      reply.status(500).send({ error: 'Failed to search jobs', message: err.message });
    }
  });

  // ─── POST /api/v1/opportunities/jobs/sweep ──────────────────────────
  fastify.post('/jobs/sweep', async (request, reply) => {
    const { testMode } = request.body || {};
    try {
      const result = opportunitiesService.triggerJobSweep(testMode === true);
      return result;
    } catch (err) {
      reply.status(500).send({ error: 'Failed to trigger job sweep', message: err.message });
    }
  });

  // ─── GET /api/v1/opportunities/profile ─────────────────────────────
  fastify.get('/profile', async (request, reply) => {
    try {
      const profile = opportunitiesService.getUserProfile();
      if (!profile) {
        return reply.status(404).send({ error: 'User profile not found' });
      }
      return profile;
    } catch (err) {
      reply.status(500).send({ error: 'Failed to retrieve profile', message: err.message });
    }
  });

  // ─── POST /api/v1/opportunities/profile ────────────────────────────
  fastify.post('/profile', async (request, reply) => {
    try {
      const result = opportunitiesService.saveUserProfile(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Failed to save profile', details: result.error });
      }
      return { message: 'Profile updated successfully' };
    } catch (err) {
      reply.status(500).send({ error: 'Failed to save profile', message: err.message });
    }
  });

  // ─── GET /api/v1/opportunities/scholarships/stats ────────────────────
  fastify.get('/scholarships/stats', async (request, reply) => {
    try {
      const stats = opportunitiesService.getScholarshipStats();
      if (stats.error) {
        return reply.status(400).send(stats);
      }
      return stats;
    } catch (err) {
      reply.status(500).send({ error: 'Failed to retrieve scholarship stats', message: err.message });
    }
  });

  // ─── GET /api/v1/opportunities/scholarships ──────────────────────────
  fastify.get('/scholarships', async (request, reply) => {
    const params = {
      q: request.query.q,
      level: request.query.level,
      region: request.query.region,
      funded: request.query.funded,
      include_expired: request.query.include_expired,
      limit: request.query.limit,
      offset: request.query.offset,
    };
    try {
      const scholarships = opportunitiesService.searchScholarships(params);
      const hierarchy = request.user?.id ? valueHierarchy.getState(db, request.user.id) : {};
      return Array.isArray(scholarships)
        ? scholarships.map((item) => decorateOpportunity(item, hierarchy))
        : scholarships;
    } catch (err) {
      reply.status(500).send({ error: 'Failed to search scholarships', message: err.message });
    }
  });

  // ─── GET /api/v1/opportunities/scholarships/:id ─────────────────────
  fastify.get('/scholarships/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const scholarship = opportunitiesService.getScholarshipById(id);
      if (!scholarship) {
        return reply.status(404).send({ error: `Scholarship with ID ${id} not found` });
      }
      const hierarchy = request.user?.id ? valueHierarchy.getState(db, request.user.id) : {};
      return decorateOpportunity(scholarship, hierarchy);
    } catch (err) {
      reply.status(500).send({ error: 'Failed to retrieve scholarship details', message: err.message });
    }
  });

  // ─── GET /api/v1/opportunities/saved ────────────────────────────────
  fastify.get('/saved', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    try {
      const userId = request.user.id;
      const rows = db.prepare(`
        SELECT id, opportunity_id, opportunity_type, title, company_or_org, location_or_country, details_json, created_at
        FROM saved_opportunities
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId);

      const items = rows.map(row => {
        let details = {};
        try {
          details = JSON.parse(row.details_json || '{}');
        } catch (_) {
          details = { raw: row.details_json };
        }
        return {
          id: row.id,
          opportunity_id: row.opportunity_id,
          opportunity_type: row.opportunity_type,
          title: row.title,
          company_or_org: row.company_or_org,
          location_or_country: row.location_or_country,
          created_at: row.created_at,
          details
        };
      });

      return { success: true, items };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to retrieve saved opportunities', message: err.message });
    }
  });

  // ─── POST /api/v1/opportunities/save ────────────────────────────────
  fastify.post('/save', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    try {
      const userId = request.user.id;
      const { opportunity_id, opportunity_type, title, company_or_org, location_or_country, details } = request.body || {};

      if (!opportunity_id || !opportunity_type || !title || details === undefined) {
        return reply.status(400).send({ error: 'opportunity_id, opportunity_type, title, and details are required' });
      }

      const newId = require('crypto').randomUUID();
      
      let detailsJson = '{}';
      if (details) {
        if (typeof details === 'string') {
          try {
            JSON.parse(details);
            detailsJson = details;
          } catch (_) {
            detailsJson = JSON.stringify({ raw: details });
          }
        } else {
          try {
            detailsJson = JSON.stringify(details);
          } catch (_) {
            detailsJson = JSON.stringify({ error: 'serialization_failed' });
          }
        }
      }

      db.prepare(`
        INSERT INTO saved_opportunities (id, user_id, opportunity_id, opportunity_type, title, company_or_org, location_or_country, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, opportunity_id, opportunity_type) DO UPDATE SET
          title = excluded.title,
          company_or_org = excluded.company_or_org,
          location_or_country = excluded.location_or_country,
          details_json = excluded.details_json
      `).run(newId, userId, opportunity_id, opportunity_type, title, company_or_org || null, location_or_country || null, detailsJson);

      return { success: true, id: newId };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to save opportunity', message: err.message });
    }
  });

  // ─── POST /api/v1/opportunities/unsave ──────────────────────────────
  fastify.post('/unsave', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    try {
      const userId = request.user.id;
      const { opportunity_id, opportunity_type } = request.body || {};

      if (!opportunity_id || !opportunity_type) {
        return reply.status(400).send({ error: 'opportunity_id and opportunity_type are required' });
      }

      db.prepare(`
        DELETE FROM saved_opportunities
        WHERE user_id = ? AND opportunity_id = ? AND opportunity_type = ?
      `).run(userId, opportunity_id, opportunity_type);

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to unsave opportunity', message: err.message });
    }
  });

  // ─── POST /api/v1/opportunities/labs/generate ──────────────────────
  fastify.post('/labs/generate', async (request, reply) => {
    if (!request.user?.id) {
      return reply.status(401).send({ error: 'Authentication required.' });
    }
    try {
      const userId = request.user.id;
      const hierarchy = await valueHierarchy.generateLabsResearch(db, userId);
      return {
        success: true,
        labsResearch: hierarchy.labsResearch,
        hierarchy,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to generate custom labs research mapping.'
      });
    }
  });
};
