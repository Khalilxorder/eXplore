const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, snapshot);
}

function loadMetaInboxService() {
  const modulePath = path.resolve(__dirname, '../src/services/metaInboxService.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function createDb(service) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT
    );
  `);
  service.ensureTables(db);
  db.prepare(`
    INSERT INTO users (id, email)
    VALUES ('user-1', 'user@example.com')
  `).run();
  return db;
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

function baseMetaEnv() {
  process.env.META_APP_ID = 'meta-app-id';
  process.env.META_APP_SECRET = 'meta-app-secret';
  process.env.META_LOGIN_CONFIG_ID = 'login-config';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token';
  process.env.BACKEND_PUBLIC_URL = 'http://localhost:8080';
  process.env.META_CONNECTION_SECRET = 'meta-connection-secret';
}

test('Instagram OAuth stores page candidates and stays selection_required until a page is chosen', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  baseMetaEnv();
  const service = loadMetaInboxService();
  const db = createDb(service);

  global.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/oauth/access_token')) {
      return jsonResponse({
        access_token: 'user-token',
        token_type: 'bearer',
      });
    }

    if (requestUrl.includes('/me/accounts')) {
      return jsonResponse({
        data: [
          {
            id: 'page-1',
            name: 'Explore Page',
            access_token: 'page-token-1',
            instagram_business_account: {
              id: 'ig-1',
              username: 'explorebrand',
            },
          },
          {
            id: 'page-2',
            name: 'Second Page',
            access_token: 'page-token-2',
            instagram_business_account: {
              id: 'ig-2',
              username: 'secondbrand',
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const state = service.buildMetaState({ userId: 'user-1', channel: 'instagram' });
    const connection = await service.handleOAuthCallback(db, { code: 'oauth-code', state });
    const row = db.prepare(`
      SELECT access_token, metadata_json
      FROM meta_channel_connections
      WHERE user_id = 'user-1' AND channel_type = 'instagram'
    `).get();

    assert.equal(connection.setup_state, 'selection_required');
    assert.equal(connection.can_send, false);
    assert.equal(connection.selection_options.pages.length, 2);
    assert.equal(connection.page_id, '');
    assert.notEqual(row.access_token, 'user-token');
    assert.ok(row.access_token.startsWith('enc:'));
    assert.equal(row.metadata_json.includes('page-token-1'), false);
  } finally {
    global.fetch = originalFetch;
    db.close();
    restoreEnv(originalEnv);
  }
});

test('WhatsApp OAuth stores business-account candidates and selection can be finalized into ready', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  baseMetaEnv();
  const service = loadMetaInboxService();
  const db = createDb(service);

  global.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/oauth/access_token')) {
      return jsonResponse({
        access_token: 'whatsapp-user-token',
        token_type: 'bearer',
      });
    }

    if (requestUrl.includes('/me/businesses')) {
      return jsonResponse({
        data: [
          { id: 'biz-1', name: 'Explore Holdings' },
        ],
      });
    }

    if (requestUrl.includes('/biz-1/owned_whatsapp_business_accounts')) {
      return jsonResponse({
        data: [
          { id: 'waba-1', name: 'Explore WhatsApp' },
        ],
      });
    }

    if (requestUrl.includes('/waba-1/phone_numbers')) {
      return jsonResponse({
        data: [
          {
            id: 'phone-1',
            display_phone_number: '+1 555 0100',
            verified_name: 'Explore',
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const state = service.buildMetaState({ userId: 'user-1', channel: 'whatsapp' });
    const discovered = await service.handleOAuthCallback(db, { code: 'oauth-code', state });
    assert.equal(discovered.setup_state, 'selection_required');
    assert.equal(discovered.selection_options.business_accounts.length, 1);

    const finalized = service.upsertConnection(db, 'user-1', 'whatsapp', {
      business_account_id: 'waba-1',
      phone_number_id: 'phone-1',
    });

    assert.equal(finalized.setup_state, 'ready');
    assert.equal(finalized.can_send, true);
    assert.equal(finalized.business_account_id, 'waba-1');
    assert.equal(finalized.phone_number_id, 'phone-1');
  } finally {
    global.fetch = originalFetch;
    db.close();
    restoreEnv(originalEnv);
  }
});

test('duplicate webhook deliveries are idempotent and unmatched events do not create fake threads', () => {
  const originalEnv = { ...process.env };
  baseMetaEnv();
  const service = loadMetaInboxService();
  const db = createDb(service);

  try {
    service.upsertConnection(db, 'user-1', 'messenger', {
      display_name: 'Explore Page',
      access_token: 'page-token',
      page_id: 'page-1',
    });

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'person-1' },
              recipient: { id: 'page-1' },
              timestamp: Date.now(),
              message: {
                mid: 'mid-1',
                text: 'hello from messenger',
              },
            },
          ],
        },
      ],
    };

    const firstResult = service.processWebhookPayload(db, payload);
    const secondResult = service.processWebhookPayload(db, payload);
    const unmatchedResult = service.processWebhookPayload(db, {
      object: 'page',
      entry: [
        {
          id: 'page-missing',
          messaging: [
            {
              sender: { id: 'ghost-user' },
              recipient: { id: 'page-missing' },
              timestamp: Date.now(),
              message: {
                mid: 'mid-missing',
                text: 'nobody home',
              },
            },
          ],
        },
      ],
    });

    const conversationCount = db.prepare('SELECT COUNT(*) AS count FROM meta_conversations').get().count;
    const messageCount = db.prepare('SELECT COUNT(*) AS count FROM meta_messages').get().count;

    assert.equal(firstResult.processed, 1);
    assert.equal(secondResult.duplicates, 1);
    assert.equal(unmatchedResult.unmatched, 1);
    assert.equal(conversationCount, 1);
    assert.equal(messageCount, 1);
  } finally {
    db.close();
    restoreEnv(originalEnv);
  }
});

test('sendConversationMessage only sends for ready channels and stores the outbound message', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  baseMetaEnv();
  const service = loadMetaInboxService();
  const db = createDb(service);

  global.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/me/messages')) {
      return jsonResponse({
        message_id: 'outbound-1',
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const connection = service.upsertConnection(db, 'user-1', 'messenger', {
      display_name: 'Explore Page',
      access_token: 'page-token',
      page_id: 'page-1',
    });

    service.processWebhookPayload(db, {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'person-1' },
              recipient: { id: 'page-1' },
              timestamp: Date.now(),
              message: {
                mid: 'mid-1',
                text: 'hello from messenger',
              },
            },
          ],
        },
      ],
    });

    const conversation = db.prepare('SELECT id FROM meta_conversations WHERE connection_id = ?').get(connection.id);
    const sendResult = await service.sendConversationMessage(db, 'user-1', conversation.id, 'Reply sent');
    const messageCount = db.prepare('SELECT COUNT(*) AS count FROM meta_messages WHERE conversation_id = ?').get(conversation.id).count;

    assert.equal(sendResult.ok, true);
    assert.equal(messageCount, 2);

    db.prepare(`
      UPDATE meta_channel_connections
      SET page_id = ''
      WHERE id = ?
    `).run(connection.id);

    await assert.rejects(
      service.sendConversationMessage(db, 'user-1', conversation.id, 'This should fail'),
      /needs setup/i,
    );
  } finally {
    global.fetch = originalFetch;
    db.close();
    restoreEnv(originalEnv);
  }
});
