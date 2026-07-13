'use strict';

const { Readable } = require('stream');
const metaInboxService = require('../services/metaInboxService');

module.exports = async function metaInboxRoutes(fastify, opts) {
  const db = opts.db;
  metaInboxService.ensureTables(db);

  async function cloneRawPayload(payload) {
    const chunks = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks);
    const replayStream = Readable.from(rawBody);
    replayStream.receivedEncodedLength = rawBody.length;

    return {
      rawBody,
      replayStream,
    };
  }

  fastify.get('/overview', async (request) => {
    return {
      success: true,
      ...metaInboxService.getOverview(db, request.user.id),
    };
  });

  fastify.get('/authorize/:channel', async (request, reply) => {
    try {
      const authUrl = metaInboxService.buildAuthorizeUrl(request.params.channel, request.user.id);
      return {
        success: true,
        auth_url: authUrl,
      };
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.put('/connections/:channel', async (request, reply) => {
    try {
      const connection = metaInboxService.upsertConnection(db, request.user.id, request.params.channel, request.body || {});
      return {
        success: true,
        connection,
      };
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.delete('/connections/:channel', async (request) => {
    const removed = metaInboxService.disconnectConnection(db, request.user.id, request.params.channel);
    return {
      success: true,
      removed,
    };
  });

  fastify.get('/conversations/:conversationId/messages', async (request, reply) => {
    const messages = metaInboxService.getConversationMessages(db, request.user.id, request.params.conversationId);
    if (!messages) {
      return reply.code(404).send({
        success: false,
        error: 'Conversation not found.',
      });
    }

    return {
      success: true,
      messages,
    };
  });

  fastify.post('/conversations/:conversationId/messages', async (request, reply) => {
    const text = String(request.body?.text || '').trim();
    if (!text) {
      return reply.code(400).send({
        success: false,
        error: 'Message text is required.',
      });
    }

    try {
      const result = await metaInboxService.sendConversationMessage(db, request.user.id, request.params.conversationId, text);
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      request.log.error(error, 'Meta outbound message failed');
      return reply.code(error.statusCode || 400).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.get('/oauth/callback', async (request, reply) => {
    const code = String(request.query?.code || '').trim();
    const state = String(request.query?.state || '').trim();

    if (!code || !state) {
      return reply
        .type('text/html')
        .send(metaInboxService.buildCallbackHtml({
          success: false,
          title: 'Meta connection failed',
          detail: 'Meta did not return a valid authorization code and state payload.',
        }));
    }

    try {
      const connection = await metaInboxService.handleOAuthCallback(db, { code, state });
      const detail = connection.can_send
        ? `${connection.label} is ready inside eXplore.`
        : connection.setup_state === 'selection_required'
          ? `${connection.label} connected. Return to eXplore to choose the right Meta resource and finish setup.`
          : `${connection.label} connected, but it still needs ${connection.missing_fields.join(', ')} before live sending works.`;
      return reply
        .type('text/html')
        .send(metaInboxService.buildCallbackHtml({
          success: true,
          title: `${connection.label} connected`,
          detail,
          channel: connection.channel,
          setupState: connection.setup_state,
        }));
    } catch (error) {
      request.log.error(error, 'Meta OAuth callback failed');
      return reply
        .type('text/html')
        .send(metaInboxService.buildCallbackHtml({
          success: false,
          title: 'Meta connection needs attention',
          detail: error.message,
        }));
    }
  });

  fastify.get('/webhook', async (request, reply) => {
    const mode = String(request.query?.['hub.mode'] || '');
    const token = String(request.query?.['hub.verify_token'] || '');
    const challenge = String(request.query?.['hub.challenge'] || '');
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN || '';

    if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
      return reply.type('text/plain').send(challenge);
    }

    return reply.code(403).send({
      success: false,
      error: 'Webhook verification failed.',
    });
  });

  fastify.post('/webhook', {
    preParsing: async (request, reply, payload) => {
      const { rawBody, replayStream } = await cloneRawPayload(payload);
      request.rawBody = rawBody;
      return replayStream;
    },
    preValidation: async (request) => {
      metaInboxService.verifyWebhookSignature(request.rawBody, request.headers['x-hub-signature-256']);
    },
  }, async (request, reply) => {
    try {
      const result = metaInboxService.processWebhookPayload(db, request.body || {});
      return reply.send({
        success: true,
        ...result,
      });
    } catch (error) {
      request.log.error(error, 'Meta webhook processing failed');
      return reply.code(error.statusCode || 500).send({
        success: false,
        error: error.message || 'Meta webhook processing failed.',
      });
    }
  });
};
