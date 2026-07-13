'use strict';

const { generateZeitgeistReport } = require('../services/cultureService');

module.exports = async function cultureRoutes(fastify, opts) {
  fastify.get('/zeitgeist', async (request, reply) => {
    try {
      const report = await generateZeitgeistReport();
      return report;
    } catch (error) {
      request.log.error(error, '[Culture API] Error generating Zeitgeist');
      return reply.code(500).send({ error: 'Failed to synthesize cultural Zeitgeist' });
    }
  });
};
