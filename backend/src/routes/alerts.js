'use strict';

const { buildUnauthorizedResponse } = require('../auth/supabaseAuth');
const { getNotificationPreferences } = require('../services/pushDeliveryService');
const {
  getPriorityAlertById,
  markPriorityAlertOpened,
  normalizeAlertCategories,
  refreshPriorityAlertCache,
  saveAlertInterpretation,
} = require('../services/priorityAlertStore');
const {
  getDirectNotificationRules,
  getRadarReferencePoints,
} = require('../services/alertRadarService');
const {
  getEventSourceMap,
  getEventSourceMapSummary,
  getLaneSourceMap,
} = require('../services/eventSourceMapService');
const aiService = require('../../services/aiService');
const intelligenceContract = require('../services/intelligenceContract');
const valueHierarchy = require('../services/valueHierarchySync');

module.exports = async function alertRoutes(fastify, options) {
  const { db } = options;

  function decorateAlert(alert, userId = '') {
    if (!alert) return alert;
    let hierarchy = {};
    try {
      hierarchy = userId ? valueHierarchy.getState(db, userId) : {};
    } catch (error) {
      hierarchy = {};
    }
    return {
      ...alert,
      intelligenceExplanation: intelligenceContract.buildExplanation({
        item: {
          ...alert,
          id: alert.id,
          title: alert.title,
          summary: alert.summary,
          source: alert.source,
          url: alert.url || alert.sourceUrl || alert.source_url,
          publishedAt: alert.publishedAt || alert.published_at || alert.createdAt,
          reason: alert.whyItMatters,
          sourceTrust: alert.sourceTrust || alert.source_trust,
        },
        hierarchy,
        ranking: { templateScore: alert.score || alert.priorityScore || 0.7 },
        source: {
          name: alert.source,
          url: alert.sourceUrl || alert.source_url || alert.url,
          trust_tier: alert.sourceTrust || alert.source_trust,
          role: alert.officialSource ? 'official' : 'reported',
        },
      }),
    };
  }

  function requireSignedIn(request, reply) {
    if (request.user?.id) {
      return true;
    }

    buildUnauthorizedResponse(reply, 'Sign in is required for the Priority Radar feed.');
    return false;
  }

  function parseCategorySelection(query = {}, defaults = {}) {
    const readFlag = (value) => {
      if (value === undefined || value === null || value === '') {
        return undefined;
      }

      const normalized = String(value).trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }

      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }

      return undefined;
    };

    return normalizeAlertCategories({
      ai: readFlag(query.ai) ?? defaults.ai,
      geo: readFlag(query.geo) ?? defaults.geo,
    });
  }

  fastify.get('/radar', async (request, reply) => {
    try {
      const limit = Math.max(1, Math.min(Number(request.query?.limit) || 8, 20));
      const payload = await refreshPriorityAlertCache(db, {
        limit,
        categories: parseCategorySelection(request.query),
      });

      return {
        success: true,
        mode: 'public_fallback',
        checkedAt: payload.checkedAt,
        cacheAgeMs: payload.cacheAgeMs,
        source: payload.source || 'live',
        reviewCount: Number(payload.reviewCount || 0),
        alerts: payload.alerts.slice(0, limit).map((alert) => decorateAlert(alert)),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Unable to build radar alerts right now.',
      });
    }
  });

  fastify.get('/references', async () => ({
    success: true,
    referencePoints: getRadarReferencePoints(),
    directNotificationRules: getDirectNotificationRules(),
  }));

  fastify.get('/source-map', async () => ({
    success: true,
    summary: getEventSourceMapSummary(),
    sourceMap: getEventSourceMap(),
  }));

  fastify.get('/source-map/:laneId', async (request, reply) => {
    const lane = getLaneSourceMap(request.params?.laneId);
    if (!lane) {
      return reply.status(404).send({
        success: false,
        error: 'Source-map lane not found.',
      });
    }

    return {
      success: true,
      lane,
    };
  });

  fastify.get('/radar/:id', async (request, reply) => {
    try {
      const alertId = String(request.params?.id || '').trim();
      if (!alertId) {
        return reply.status(400).send({
          success: false,
          error: 'alert id is required',
        });
      }

      await refreshPriorityAlertCache(db, { limit: 20 });
      const alert = getPriorityAlertById(db, '', alertId);
      if (!alert) {
        return reply.status(404).send({
          success: false,
          error: 'Priority radar alert not found.',
        });
      }

      return {
        success: true,
        mode: 'public_fallback',
        alert: decorateAlert(alert),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Unable to load that Priority Radar alert right now.',
      });
    }
  });

  fastify.get('/feed', async (request, reply) => {
    if (!requireSignedIn(request, reply)) {
      return;
    }

    try {
      const limit = Math.max(1, Math.min(Number(request.query?.limit) || 20, 40));
      const preferences = getNotificationPreferences(db, request.user.id);
      const payload = await refreshPriorityAlertCache(db, {
        limit,
        userId: request.user.id,
        categories: parseCategorySelection(request.query, {
          ai: preferences.ai_enabled,
          geo: preferences.geo_enabled,
        }),
      });

      return {
        success: true,
        mode: 'canonical_user_feed',
        checkedAt: payload.checkedAt,
        cacheAgeMs: payload.cacheAgeMs,
        source: payload.source || 'live',
        reviewCount: Number(payload.reviewCount || 0),
        unreadCount: payload.alerts.filter((alert) => alert.unread).length,
        alerts: payload.alerts.map((alert) => decorateAlert(alert, request.user.id)),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Unable to load the Priority Radar feed right now.',
      });
    }
  });

  fastify.get('/feed/:id', async (request, reply) => {
    if (!requireSignedIn(request, reply)) {
      return;
    }

    try {
      const alertId = String(request.params?.id || '').trim();
      if (!alertId) {
        return reply.status(400).send({
          success: false,
          error: 'alert id is required',
        });
      }

      await refreshPriorityAlertCache(db, {
        limit: 20,
        userId: request.user.id,
      });

      const alert = getPriorityAlertById(db, request.user.id, alertId);
      if (!alert) {
        return reply.status(404).send({
          success: false,
          error: 'Priority radar alert not found.',
        });
      }

      return {
        success: true,
        alert: decorateAlert(alert, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Unable to load that Priority Radar alert right now.',
      });
    }
  });

  fastify.post('/feed/:id/open', async (request, reply) => {
    if (!requireSignedIn(request, reply)) {
      return;
    }

    try {
      const alertId = String(request.params?.id || '').trim();
      if (!alertId) {
        return reply.status(400).send({
          success: false,
          error: 'alert id is required',
        });
      }

      const alert = markPriorityAlertOpened(db, request.user.id, alertId);
      if (!alert) {
        return reply.status(404).send({
          success: false,
          error: 'Priority radar alert not found.',
        });
      }

      return {
        success: true,
        alert,
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Unable to mark that alert as opened right now.',
      });
    }
  });

  async function generateAlertInterpretation(request, reply, alertId, userId = '') {
    // Ensure the alert is in the local DB before we try to look it up
    await refreshPriorityAlertCache(db, { limit: 20, userId: userId || undefined });
    const alert = getPriorityAlertById(db, userId, alertId);
    if (!alert) {
      return reply.status(404).send({
        success: false,
        error: 'Priority radar alert not found.',
      });
    }

    if (alert.aiInterpretation) {
      return { success: true, alert: decorateAlert(alert, userId) };
    }

    try {
      const prompt = `You are an elite AI intelligence analyst. 
We intercepted this alert:
Title: ${alert.title}
Source: ${alert.source}
Summary: ${alert.summary || 'N/A'}
Why it mattered previously: ${alert.whyItMatters || 'N/A'}

Provide a truly summarized, deep AI interpretation of what this news actually means for the industry, developers, or geopolitics. 
Keep it to 2-3 sentences max. Focus strictly on the "so what?" and hidden implications. Do not simply repeat the summary. Return your interpretation in a "aiInterpretation" string field.`;

      const response = await aiService.generateStructuredJson({
        providerPreference: 'gemini',
        temperature: 0.3,
        systemPrompt: 'You interpret news for an elite personal intelligence feed named "eXplore". Return ONLY valid JSON: { "aiInterpretation": "your answer here" }.',
        userPrompt: prompt,
      });

      const interpretation = String(response?.aiInterpretation || 'The AI could not confidently interpret this signal.').trim();
      saveAlertInterpretation(db, alertId, interpretation);
      
      return {
        success: true,
        alert: {
          ...decorateAlert(alert, userId),
          aiInterpretation: interpretation,
        },
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Unable to generate an AI interpretation right now.',
      });
    }
  }

  fastify.post('/radar/:id/interpret', async (request, reply) => {
    if (!requireSignedIn(request, reply)) {
      return;
    }
    const alertId = String(request.params?.id || '').trim();
    if (!alertId) {
      return reply.code(400).send({ success: false, error: 'alert id is required' });
    }
    return generateAlertInterpretation(request, reply, alertId, request.user.id);
  });

  fastify.post('/feed/:id/interpret', async (request, reply) => {
    if (!requireSignedIn(request, reply)) {
      return;
    }
    const alertId = String(request.params?.id || '').trim();
    if (!alertId) {
      return reply.status(400).send({ success: false, error: 'alert id is required' });
    }
    return generateAlertInterpretation(request, reply, alertId, request.user.id);
  });
};
