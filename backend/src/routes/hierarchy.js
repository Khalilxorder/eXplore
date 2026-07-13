const valueHierarchy = require('../services/valueHierarchySync');

/**
 * GUEST ISOLATION NOTE (single-user app today):
 * All unauthenticated requests collapse to userId = 'guest'.
 * This means all guests SHARE one hierarchy row in user_value_hierarchy.
 * This is intentional for the current single-user deployment.
 * Before multi-tenant use: add per-session or per-device isolation here.
 */
function resolveUserId(request) {
  return request.user?.id || 'guest';
}

module.exports = async function hierarchyRoutes(fastify, opts) {
  const db = opts.db;
  valueHierarchy.ensureTables(db);

  fastify.get('/state', async (request) => ({
    success: true,
    hierarchy: valueHierarchy.getState(db, resolveUserId(request)),
  }));

  fastify.get('/final-interpretation', async (request, reply) => {
    try {
      const interpretation = await valueHierarchy.buildFinalInterpretation(db, resolveUserId(request));
      return { success: true, interpretation };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to build the final interpretation.',
      });
    }
  });

  fastify.get('/goal', async (request) => {
    const hierarchy = valueHierarchy.getState(db, resolveUserId(request));
    return {
      success: true,
      currentGoal: hierarchy.currentGoal,
      hierarchy,
    };
  });

  fastify.post('/goal', async (request, reply) => {
    const goal = String(request.body?.goal || '').trim();
    if (!goal) {
      return reply.code(400).send({ success: false, error: 'Valid goal string required' });
    }

    const hierarchy = valueHierarchy.updateUserGoal(db, resolveUserId(request), goal);
    return {
      success: true,
      currentGoal: hierarchy.currentGoal,
      hierarchy,
    };
  });

  fastify.post('/sync-footprint', async (request, reply) => {
    const historyData = Array.isArray(request.body?.historyData) ? request.body.historyData : null;
    if (!historyData) {
      return reply.code(400).send({ success: false, error: 'historyData must be an array of watch events' });
    }

    const hierarchy = await valueHierarchy.syncDigitalFootprint(db, resolveUserId(request), historyData);
    return {
      success: true,
      extractedCoreValues: hierarchy.coreValues,
      hierarchy,
      message: 'Digital footprint summarized into the active trajectory lens.',
    };
  });

  fastify.post('/import-footprint', async (request, reply) => {
    const rawText = String(request.body?.rawText || '');
    const source = String(request.body?.source || 'auto');
    const fileName = String(request.body?.fileName || '');

    if (!rawText.trim()) {
      return reply.code(400).send({ success: false, error: 'rawText is required for footprint import.' });
    }

    const historyData = valueHierarchy.importDigitalFootprint(rawText, { source, fileName });
    if (!historyData.length) {
      return reply.code(400).send({
        success: false,
        error: 'No recognizable footprint entries were found in that file.',
      });
    }

    const hierarchy = await valueHierarchy.syncDigitalFootprint(db, resolveUserId(request), historyData);
    return {
      success: true,
      importedCount: historyData.length,
      extractedCoreValues: hierarchy.coreValues,
      hierarchy,
      message: 'Imported footprint data summarized into the active trajectory lens.',
    };
  });

  fastify.post('/stories', async (request, reply) => {
    const storyHighestOrder = String(request.body?.storyHighestOrder || '').trim();
    const storyYours = String(request.body?.storyYours || '').trim();
    const storySubStories = String(request.body?.storySubStories || '').trim();

    const hierarchy = valueHierarchy.updateStories(db, resolveUserId(request), {
      storyHighestOrder,
      storyYours,
      storySubStories,
    });
    return {
      success: true,
      hierarchy,
    };
  });

  fastify.post('/story-alignment', async (request, reply) => {
    const contentInfo = request.body?.content
      ?? request.body?.contentInfo
      ?? request.body?.item
      ?? request.body?.opportunity
      ?? request.body?.text
      ?? '';
    const hierarchy = valueHierarchy.getState(db, resolveUserId(request));
    const storySummary = valueHierarchy.summarizeStoryLayerAlignment(hierarchy, contentInfo);

    if (!storySummary.hasContentSignal) {
      return reply.code(400).send({
        success: false,
        error: 'content, contentInfo, item, opportunity, or text is required for story alignment.',
      });
    }

    return {
      success: true,
      storySummary,
      hierarchyUpdatedAt: hierarchy.updatedAt,
    };
  });

  fastify.post('/self-data', async (request, reply) => {
    const rawText = String(request.body?.rawText || '').trim();
    if (!rawText) {
      return reply.code(400).send({ success: false, error: 'rawText is required for SELF data analysis.' });
    }

    try {
      const hierarchy = await valueHierarchy.analyzeSelfData(db, resolveUserId(request), rawText);
      return {
        success: true,
        hierarchy,
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to analyze SELF website data.',
      });
    }
  });

  fastify.get('/mode', async (request) => {
    const state = valueHierarchy.getState(db, resolveUserId(request));
    return { success: true, mode: state.appMode || 'average' };
  });

  fastify.post('/mode', async (request, reply) => {
    const mode = request.body?.mode;
    if (!['average', 'edge'].includes(mode)) {
      return reply.status(400).send({ error: 'mode must be average or edge' });
    }
    const hierarchy = valueHierarchy.upsertState(db, resolveUserId(request), { appMode: mode });
    return { success: true, mode: hierarchy.appMode };
  });
};
