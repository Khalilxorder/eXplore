'use strict';

const {
  SUPPLY_STATES,
  getWoltConfig,
  saveWoltConfig,
  getLatestSnapshot,
  fetchLiveWoltDemand,
  runWoltDemandCheck,
} = require('../services/woltDemandService');

async function woltRoutes(fastify, options) {
  const db = options.db;

  fastify.get('/status', async (request, reply) => {
    const userId = request.user?.id || 'default_user';
    const config = getWoltConfig(db, userId);
    const latestSnapshot = getLatestSnapshot(db, userId);

    return {
      ok: true,
      config,
      latestSnapshot,
      supplyStates: SUPPLY_STATES,
    };
  });

  fastify.post('/config', async (request, reply) => {
    const userId = request.user?.id || 'default_user';
    const body = request.body || {};

    const updatedConfig = saveWoltConfig(db, userId, body);

    return {
      ok: true,
      config: updatedConfig,
      message: 'Wolt Demand Monitor settings saved.',
    };
  });

  fastify.post('/test-fetch', async (request, reply) => {
    const userId = request.user?.id || 'default_user';
    const body = request.body || {};
    const config = getWoltConfig(db, userId);

    const authToken = body.authToken || config.auth_token;
    const cityId = body.cityId !== undefined ? body.cityId : config.city_id;
    const venueId = body.venueId !== undefined ? body.venueId : config.venue_id;

    if (!authToken) {
      return reply.status(400).send({
        ok: false,
        error: 'Wolt authentication token is required for live test',
      });
    }

    const testResult = await fetchLiveWoltDemand({
      authToken,
      cityId,
      venueId,
    });

    return {
      ok: testResult.ok,
      result: testResult,
    };
  });

  fastify.post('/check', async (request, reply) => {
    const userId = request.user?.id || 'default_user';
    const checkResult = await runWoltDemandCheck(db, userId);

    return {
      ok: checkResult.ok !== false,
      result: checkResult,
    };
  });
}

module.exports = woltRoutes;
