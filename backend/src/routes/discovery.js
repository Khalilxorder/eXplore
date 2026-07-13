'use strict';

const {
  addTopicMonitor,
  addTrackedChannel,
  getDiscoveryStatus,
  refreshDiscoveryForScope,
  listSourceHealth,
  listTopicMonitors,
  listTrackedChannels,
  listWatchedSourcePacks,
  addWatchedSourcePack,
  previewWatchedSourcePack,
  updateWatchedSourcePack,
  listFeedCandidates,
} = require('../services/feedDiscoveryService');
const intelligenceContract = require('../services/intelligenceContract');
const valueHierarchy = require('../services/valueHierarchySync');

async function discoveryRoutes(fastify, options = {}) {
  const db = options.db;
  const resolveTemplateState = typeof options.resolveTemplateState === 'function'
    ? options.resolveTemplateState
    : () => ({});

  fastify.get('/status', async (request, reply) => {
    try {
      return getDiscoveryStatus(db, request.user.id);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Discovery status failed', details: error.message });
    }
  });

  fastify.post('/refresh', async (request, reply) => {
    try {
      const result = await refreshDiscoveryForScope(db, {
        userId: request.user.id,
        templateState: await Promise.resolve(resolveTemplateState(request.user.id)),
        force: true,
      });

      return {
        success: true,
        result,
        status: getDiscoveryStatus(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Discovery refresh failed', details: error.message });
    }
  });

  fastify.get('/youtube', async (request, reply) => {
    try {
      const limit = Math.max(1, Math.min(Number(request.query?.limit) || 30, 100));
      if (String(request.query?.refresh || '').toLowerCase() === 'true') {
        await refreshDiscoveryForScope(db, {
          userId: request.user.id,
          templateState: await Promise.resolve(resolveTemplateState(request.user.id)),
          force: true,
        });
      }

      let hierarchy = {};
      try {
        hierarchy = valueHierarchy.getState(db, request.user.id);
      } catch (error) {
        hierarchy = {};
      }

      const videos = listFeedCandidates(db, request.user.id, limit)
        .filter((row) => String(row.platform || '').toLowerCase() === 'youtube')
        .map((row) => {
          const item = {
          id: row.id,
          contentId: row.content_id,
          videoId: row.external_id,
          lane: row.lane,
          title: row.title,
          url: row.url,
          thumbnailUrl: row.thumbnail_url,
          source: row.source_label,
          publishedAt: row.published_at,
          durationSeconds: Number(row.duration_seconds || 0),
          viewCount: Number(row.view_count || 0),
          sourceTrust: Number(row.source_trust || 0),
          freshnessScore: Number(row.freshness_score || 0),
          personalMatchScore: Number(row.personal_match_score || 0),
          decisionScore: Number(row.decision_score || 0),
          explorationScore: Number(row.exploration_score || 0),
          overallScore: Number(row.overall_score || 0),
          whySelected: row.why_selected,
          };
          return {
            ...item,
            intelligenceExplanation: intelligenceContract.buildExplanation({
              item: {
                ...item,
                sourceTrust: item.sourceTrust,
                scores: {
                  freshness: item.freshnessScore,
                  relevance: item.overallScore,
                },
              },
              hierarchy,
              ranking: {
                templateScore: item.overallScore,
                personalFit: item.personalMatchScore,
                freshness: item.freshnessScore,
                reason: item.whySelected,
              },
              source: { name: item.source, url: item.url, trust_tier: item.sourceTrust * 5 },
            }),
          };
        });

      return {
        success: true,
        videos,
        status: getDiscoveryStatus(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Ranked YouTube lookup failed', details: error.message });
    }
  });

  fastify.get('/youtube/channels', async (request, reply) => {
    try {
      return {
        channels: listTrackedChannels(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Tracked channel lookup failed', details: error.message });
    }
  });

  fastify.post('/youtube/channels', async (request, reply) => {
    const payload = request.body || {};
    const query = String(payload.channel_query || payload.channel_name || payload.query || '').trim();
    if (!query) {
      return reply.status(400).send({ error: 'channel_query is required' });
    }

    try {
      const channel = addTrackedChannel(db, request.user.id, payload);
      return {
        success: true,
        channel,
        channels: listTrackedChannels(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Tracked channel could not be saved', details: error.message });
    }
  });

  fastify.put('/youtube/channels/:id', async (request, reply) => {
    try {
      const changes = request.body || {};
      db.prepare(`
        UPDATE youtube_tracked_channels
        SET
          channel_name = COALESCE(?, channel_name),
          channel_query = COALESCE(?, channel_query),
          trust_tier = COALESCE(?, trust_tier),
          active = COALESCE(?, active),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND scope_key = ?
      `).run(
        changes.channel_name ?? null,
        changes.channel_query ?? null,
        changes.trust_tier ?? null,
        changes.active === undefined ? null : Number(Boolean(changes.active)),
        request.params.id,
        request.user.id
      );

      return {
        success: true,
        channels: listTrackedChannels(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Tracked channel update failed', details: error.message });
    }
  });

  fastify.get('/youtube/queries', async (request, reply) => {
    try {
      return {
        queries: listTopicMonitors(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Topic monitor lookup failed', details: error.message });
    }
  });

  fastify.get('/youtube/monitors', async (request, reply) => {
    try {
      return {
        monitors: listTopicMonitors(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Topic monitor lookup failed', details: error.message });
    }
  });

  fastify.post('/youtube/queries', async (request, reply) => {
    const payload = request.body || {};
    const query = String(payload.query || '').trim();
    if (!query) {
      return reply.status(400).send({ error: 'query is required' });
    }

    try {
      const topicMonitor = addTopicMonitor(db, request.user.id, payload);
      return {
        success: true,
        topic_monitor: topicMonitor,
        queries: listTopicMonitors(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Topic monitor could not be saved', details: error.message });
    }
  });

  fastify.post('/youtube/monitors', async (request, reply) => {
    const payload = request.body || {};
    const query = String(payload.query || '').trim();
    if (!query) {
      return reply.status(400).send({ error: 'query is required' });
    }

    try {
      const topicMonitor = addTopicMonitor(db, request.user.id, payload);
      return {
        success: true,
        topic_monitor: topicMonitor,
        monitors: listTopicMonitors(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Topic monitor could not be saved', details: error.message });
    }
  });

  fastify.put('/youtube/monitors/:id', async (request, reply) => {
    try {
      const changes = request.body || {};
      db.prepare(`
        UPDATE youtube_topic_monitors
        SET
          query = COALESCE(?, query),
          intent = COALESCE(?, intent),
          weight = COALESCE(?, weight),
          active = COALESCE(?, active),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND scope_key = ?
      `).run(
        changes.query ?? null,
        changes.intent ?? null,
        changes.weight ?? null,
        changes.active === undefined ? null : Number(Boolean(changes.active)),
        request.params.id,
        request.user.id
      );

      return {
        success: true,
        monitors: listTopicMonitors(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Topic monitor update failed', details: error.message });
    }
  });

  fastify.get('/sources/health', async (request, reply) => {
    try {
      return {
        sources: listSourceHealth(db, request.user.id),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Source health lookup failed', details: error.message });
    }
  });

  fastify.get('/source-packs', async (request, reply) => {
    try {
      const packs = listWatchedSourcePacks(db, request.user.id);
      return { success: true, packs };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Source packs lookup failed', details: error.message });
    }
  });

  fastify.post('/source-packs/preview', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.topic) {
        return reply.status(400).send({ error: 'topic is required' });
      }
      const pack = await previewWatchedSourcePack(payload);
      return { success: true, pack };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Source pack preview failed', details: error.message });
    }
  });

  fastify.post('/source-packs', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.topic) {
        return reply.status(400).send({ error: 'topic is required' });
      }
      const pack = await addWatchedSourcePack(db, request.user.id, payload);
      return { success: true, pack, packs: listWatchedSourcePacks(db, request.user.id) };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Source pack could not be saved', details: error.message });
    }
  });

  fastify.put('/source-packs/:id', async (request, reply) => {
    try {
      const updates = request.body || {};
      const pack = updateWatchedSourcePack(db, request.user.id, request.params.id, updates);
      return { success: true, pack, packs: listWatchedSourcePacks(db, request.user.id) };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Source pack update failed', details: error.message });
    }
  });
}

module.exports = discoveryRoutes;
