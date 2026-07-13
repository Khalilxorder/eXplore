'use strict';

const crypto = require('crypto');

const GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const ENCRYPTED_TOKEN_PREFIX = 'enc:';
const META_REQUIRED_ENV_NAMES = [
  'META_APP_ID',
  'META_APP_SECRET',
  'META_LOGIN_CONFIG_ID',
  'META_WEBHOOK_VERIFY_TOKEN',
  'BACKEND_PUBLIC_URL',
  'META_CONNECTION_SECRET',
];
const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  SELECTION_REQUIRED: 'selection_required',
  NEEDS_SETUP: 'needs_setup',
  READY: 'ready',
  ERROR: 'error',
};

const CHANNEL_CONFIG = {
  instagram: {
    label: 'Instagram',
    scopes: [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'pages_show_list',
      'pages_manage_metadata',
    ],
    requiredFields: ['access_token', 'page_id', 'instagram_account_id'],
  },
  messenger: {
    label: 'Facebook Messenger',
    scopes: [
      'pages_show_list',
      'pages_messaging',
      'pages_manage_metadata',
      'business_management',
    ],
    requiredFields: ['access_token', 'page_id'],
  },
  whatsapp: {
    label: 'WhatsApp',
    scopes: [
      'whatsapp_business_management',
      'whatsapp_business_messaging',
      'business_management',
    ],
    requiredFields: ['access_token', 'business_account_id', 'phone_number_id'],
  },
};

const PROVIDER_CAPABILITIES = Object.freeze({
  instagram: {
    read_conversations: true,
    read_messages: true,
    send: true,
    reply: true,
    edit: false,
    delete: false,
    reactions: false,
    attachments: false,
    voice_messages: false,
    read_receipts: false,
    typing_state: false,
    search: false,
    webhooks: true,
    polling: false,
    deep_link: true,
    limitation: 'Meta Graph permissions and webhook delivery are required; message history is not backfilled by this adapter.',
  },
  messenger: {
    read_conversations: true,
    read_messages: true,
    send: true,
    reply: true,
    edit: false,
    delete: false,
    reactions: false,
    attachments: false,
    voice_messages: false,
    read_receipts: false,
    typing_state: false,
    search: false,
    webhooks: true,
    polling: false,
    deep_link: true,
    limitation: 'Page-scoped permissions and webhook delivery are required; unsupported actions stay disabled.',
  },
  whatsapp: {
    read_conversations: true,
    read_messages: true,
    send: true,
    reply: true,
    edit: false,
    delete: false,
    reactions: false,
    attachments: false,
    voice_messages: false,
    read_receipts: false,
    typing_state: false,
    search: false,
    webhooks: true,
    polling: false,
    deep_link: true,
    limitation: 'WhatsApp Business account, phone number, approved permissions, and webhook delivery are required.',
  },
});

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_channel_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected',
      display_name TEXT,
      access_token TEXT,
      scopes_json TEXT DEFAULT '[]',
      page_id TEXT,
      instagram_account_id TEXT,
      business_account_id TEXT,
      phone_number_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      connected_at DATETIME,
      last_webhook_at DATETIME,
      last_sync_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, channel_type)
    );

    CREATE TABLE IF NOT EXISTS meta_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES meta_channel_connections(id) ON DELETE SET NULL,
      channel_type TEXT NOT NULL,
      external_thread_key TEXT NOT NULL,
      participant_id TEXT,
      participant_name TEXT,
      participant_handle TEXT,
      participant_avatar_url TEXT,
      last_message_preview TEXT,
      last_message_at DATETIME,
      unread_count INTEGER DEFAULT 0,
      metadata_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, channel_type, external_thread_key)
    );

    CREATE TABLE IF NOT EXISTS meta_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES meta_conversations(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL,
      external_message_id TEXT,
      direction TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      recipient_id TEXT,
      text TEXT,
      delivery_status TEXT DEFAULT 'received',
      raw_payload_json TEXT DEFAULT '{}',
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_type, external_message_id)
    );

    CREATE TABLE IF NOT EXISTS meta_webhook_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      channel_type TEXT NOT NULL,
      event_uid TEXT UNIQUE NOT NULL,
      payload_json TEXT NOT NULL,
      processed INTEGER DEFAULT 0,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getChannelConfig(channel) {
  return CHANNEL_CONFIG[String(channel || '').toLowerCase()] || null;
}

function getMetaAppConfig() {
  const apiVersion = process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
  const backendBaseUrl = (process.env.BACKEND_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
  const frontendReturnUrl = (process.env.META_FRONTEND_SUCCESS_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const mobileAppScheme = process.env.MOBILE_APP_SCHEME || process.env.NEXT_PUBLIC_MOBILE_APP_SCHEME || 'explore';

  return {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    loginConfigId: process.env.META_LOGIN_CONFIG_ID || '',
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
    connectionSecret: process.env.META_CONNECTION_SECRET || '',
    apiVersion,
    backendBaseUrl,
    frontendReturnUrl,
    mobileAppScheme,
    redirectUri: `${backendBaseUrl}/api/v1/meta/oauth/callback`,
  };
}

function getPublicMetaAppConfig() {
  const config = getMetaAppConfig();
  const values = {
    META_APP_ID: config.appId,
    META_APP_SECRET: config.appSecret,
    META_LOGIN_CONFIG_ID: config.loginConfigId,
    META_WEBHOOK_VERIFY_TOKEN: config.webhookVerifyToken,
    BACKEND_PUBLIC_URL: config.backendBaseUrl,
    META_CONNECTION_SECRET: config.connectionSecret,
  };
  const missingEnvNames = META_REQUIRED_ENV_NAMES.filter((name) => !values[name]);
  const configuredCount = META_REQUIRED_ENV_NAMES.length - missingEnvNames.length;
  const status = configuredCount === META_REQUIRED_ENV_NAMES.length
    ? 'live'
    : configuredCount > 0
      ? 'partial'
      : 'unavailable';

  return {
    status,
    api_version: config.apiVersion,
    auth_ready: Boolean(config.appId && config.appSecret),
    webhook_ready: Boolean(config.webhookVerifyToken),
    login_config_ready: Boolean(config.loginConfigId),
    backend_public_url_ready: Boolean(config.backendBaseUrl),
    secret_ready: Boolean(config.connectionSecret),
    missing_envs: missingEnvNames,
    redirect_uri: config.redirectUri,
    frontend_return_url: config.frontendReturnUrl,
    mobile_return_url: `${config.mobileAppScheme}://messages?meta_inbox=1`,
  };
}

function validateMetaRuntimeConfig({ strict = false } = {}) {
  const appConfig = getMetaAppConfig();
  const values = {
    META_APP_ID: appConfig.appId,
    META_APP_SECRET: appConfig.appSecret,
    META_LOGIN_CONFIG_ID: appConfig.loginConfigId,
    META_WEBHOOK_VERIFY_TOKEN: appConfig.webhookVerifyToken,
    BACKEND_PUBLIC_URL: appConfig.backendBaseUrl,
    META_CONNECTION_SECRET: appConfig.connectionSecret,
  };
  const missing = META_REQUIRED_ENV_NAMES.filter((name) => !values[name]);
  const enabled = strict || META_REQUIRED_ENV_NAMES.some((name) => Boolean(values[name]));

  if (strict && missing.length) {
    throw new Error(`Meta configuration is incomplete: ${missing.join(', ')}`);
  }

  return {
    enabled,
    strict,
    missing,
    valid: missing.length === 0,
  };
}

function safeJsonParse(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function coerceText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function coerceScopes(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function deriveEncryptionKey(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest();
}

function encodeTokenPart(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function decodeTokenPart(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function isEncryptedToken(value) {
  return String(value || '').startsWith(ENCRYPTED_TOKEN_PREFIX);
}

function encryptToken(value) {
  const token = coerceText(value);
  if (!token) {
    return '';
  }

  if (isEncryptedToken(token)) {
    return token;
  }

  const { connectionSecret } = getMetaAppConfig();
  if (!connectionSecret) {
    return token;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveEncryptionKey(connectionSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTED_TOKEN_PREFIX}${encodeTokenPart(iv)}.${encodeTokenPart(authTag)}.${encodeTokenPart(ciphertext)}`;
}

function decryptToken(value) {
  const token = coerceText(value);
  if (!token) {
    return '';
  }

  if (!isEncryptedToken(token)) {
    return token;
  }

  const { connectionSecret } = getMetaAppConfig();
  if (!connectionSecret) {
    const error = new Error('META_CONNECTION_SECRET is required to decrypt Meta connection tokens.');
    error.statusCode = 503;
    throw error;
  }

  const serialized = token.slice(ENCRYPTED_TOKEN_PREFIX.length);
  const [ivPart, tagPart, ciphertextPart] = serialized.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) {
    const error = new Error('Meta connection token could not be decrypted.');
    error.statusCode = 500;
    throw error;
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveEncryptionKey(connectionSecret),
    decodeTokenPart(ivPart),
  );
  decipher.setAuthTag(decodeTokenPart(tagPart));
  const plaintext = Buffer.concat([
    decipher.update(decodeTokenPart(ciphertextPart)),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4 || 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64').toString('utf8');
}

function signStatePayload(payload) {
  const { appSecret, webhookVerifyToken } = getMetaAppConfig();
  const secret = appSecret || webhookVerifyToken || 'explore-meta-state';
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildMetaState({ userId, channel }) {
  const payload = base64UrlEncode(JSON.stringify({
    user_id: userId,
    channel,
    nonce: crypto.randomUUID(),
    created_at: Date.now(),
  }));

  return `${payload}.${signStatePayload(payload)}`;
}

function buildWebhookSignature(rawBody) {
  const { appSecret } = getMetaAppConfig();
  if (!appSecret) {
    const error = new Error('META_APP_SECRET is required before accepting Meta webhook deliveries.');
    error.statusCode = 503;
    throw error;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  return `sha256=${crypto.createHmac('sha256', appSecret).update(bodyBuffer).digest('hex')}`;
}

function verifyWebhookSignature(rawBody, signatureHeader = '') {
  const expectedSignature = buildWebhookSignature(rawBody);
  const actualSignature = coerceText(signatureHeader);

  if (!actualSignature) {
    const error = new Error('Missing Meta webhook signature.');
    error.statusCode = 401;
    throw error;
  }

  if (actualSignature.length !== expectedSignature.length) {
    const error = new Error('Meta webhook signature mismatch.');
    error.statusCode = 401;
    throw error;
  }

  if (!crypto.timingSafeEqual(Buffer.from(actualSignature), Buffer.from(expectedSignature))) {
    const error = new Error('Meta webhook signature mismatch.');
    error.statusCode = 401;
    throw error;
  }

  return true;
}

function parseMetaState(state) {
  const [payload, signature] = String(state || '').split('.');
  if (!payload || !signature) {
    throw new Error('Missing OAuth state payload.');
  }

  const expectedSignature = signStatePayload(payload);
  if (signature.length !== expectedSignature.length) {
    throw new Error('OAuth state signature mismatch.');
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('OAuth state signature mismatch.');
  }

  return safeJsonParse(base64UrlDecode(payload), {});
}

function buildAuthorizeUrl(channel, userId) {
  const config = getChannelConfig(channel);
  const appConfig = getMetaAppConfig();

  if (!config) {
    throw new Error('Unknown Meta channel.');
  }

  if (!appConfig.appId) {
    throw new Error('META_APP_ID is not configured.');
  }

  const params = new URLSearchParams({
    client_id: appConfig.appId,
    redirect_uri: appConfig.redirectUri,
    state: buildMetaState({ userId, channel }),
    response_type: 'code',
    scope: config.scopes.join(','),
  });

  if (appConfig.loginConfigId) {
    params.set('config_id', appConfig.loginConfigId);
  }

  return `https://www.facebook.com/${appConfig.apiVersion}/dialog/oauth?${params.toString()}`;
}

async function graphRequest(pathname, {
  method = 'GET',
  accessToken = '',
  query = {},
  body,
} = {}) {
  const config = getMetaAppConfig();
  const url = new URL(`${GRAPH_BASE_URL}/${config.apiVersion}/${String(pathname || '').replace(/^\/+/, '')}`);

  if (accessToken) {
    url.searchParams.set('access_token', accessToken);
  }

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Meta Graph request failed (${response.status}).`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function exchangeCodeForAccessToken(code) {
  const { appId, appSecret, redirectUri, apiVersion } = getMetaAppConfig();
  if (!appId || !appSecret) {
    throw new Error('META_APP_ID and META_APP_SECRET are required for Meta OAuth.');
  }

  const url = new URL(`${GRAPH_BASE_URL}/${apiVersion}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Unable to exchange Meta OAuth code for a token.');
  }

  return payload;
}

async function fetchManagedPages(accessToken) {
  const payload = await graphRequest('me/accounts', {
    accessToken,
    query: {
      fields: 'id,name,access_token,instagram_business_account{id,username,name}',
    },
  });

  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchWhatsAppBusinessAccounts(accessToken) {
  const businessesPayload = await graphRequest('me/businesses', {
    accessToken,
    query: {
      fields: 'id,name',
    },
  });

  const businesses = Array.isArray(businessesPayload?.data) ? businessesPayload.data : [];
  const businessAccounts = [];

  for (const business of businesses) {
    const accountPayload = await graphRequest(`${business.id}/owned_whatsapp_business_accounts`, {
      accessToken,
      query: {
        fields: 'id,name',
      },
    }).catch(() => ({ data: [] }));

    const accounts = Array.isArray(accountPayload?.data) ? accountPayload.data : [];
    for (const account of accounts) {
      const phonesPayload = await graphRequest(`${account.id}/phone_numbers`, {
        accessToken,
        query: {
          fields: 'id,display_phone_number,verified_name',
        },
      }).catch(() => ({ data: [] }));

      businessAccounts.push({
        business_id: business.id || '',
        business_name: business.name || '',
        id: account.id || '',
        name: account.name || '',
        phone_numbers: Array.isArray(phonesPayload?.data) ? phonesPayload.data : [],
      });
    }
  }

  return businessAccounts;
}

function getConnectionRow(db, userId, channel) {
  return db.prepare(`
    SELECT *
    FROM meta_channel_connections
    WHERE user_id = ? AND channel_type = ?
  `).get(userId, channel);
}

function computeMissingFields(channel, data) {
  const config = getChannelConfig(channel);
  if (!config) {
    return ['unsupported channel'];
  }

  return config.requiredFields
    .filter((field) => !coerceText(data?.[field]));
}

function hasSelectionChoices(channel, metadata = {}) {
  if (channel === 'instagram' || channel === 'messenger') {
    return Array.isArray(metadata.oauth_pages) && metadata.oauth_pages.length > 0;
  }

  if (channel === 'whatsapp') {
    return Array.isArray(metadata.oauth_business_accounts) && metadata.oauth_business_accounts.length > 0;
  }

  return false;
}

function determineConnectionState(channel, data = {}, metadata = {}) {
  if (metadata?.setup_error) {
    return CONNECTION_STATES.ERROR;
  }

  const missingFields = computeMissingFields(channel, data);
  if (missingFields.length === 0) {
    return CONNECTION_STATES.READY;
  }

  if (hasSelectionChoices(channel, metadata)) {
    if (channel === 'instagram' && (!coerceText(data.page_id) || !coerceText(data.instagram_account_id))) {
      return CONNECTION_STATES.SELECTION_REQUIRED;
    }

    if (channel === 'messenger' && !coerceText(data.page_id)) {
      return CONNECTION_STATES.SELECTION_REQUIRED;
    }

    if (channel === 'whatsapp' && (!coerceText(data.business_account_id) || !coerceText(data.phone_number_id))) {
      return CONNECTION_STATES.SELECTION_REQUIRED;
    }
  }

  return CONNECTION_STATES.NEEDS_SETUP;
}

function buildSelectionOptions(channel, metadata = {}) {
  if (channel === 'instagram' || channel === 'messenger') {
    const pages = Array.isArray(metadata.oauth_pages) ? metadata.oauth_pages : [];
    return {
      pages: pages.map((page) => ({
        id: page.id || '',
        name: page.name || '',
        instagram_business_account_id: page.instagram_business_account_id || '',
        instagram_username: page.instagram_username || '',
      })),
    };
  }

  if (channel === 'whatsapp') {
    const accounts = Array.isArray(metadata.oauth_business_accounts) ? metadata.oauth_business_accounts : [];
    return {
      business_accounts: accounts.map((account) => ({
        id: account.id || '',
        name: account.name || '',
        business_id: account.business_id || '',
        business_name: account.business_name || '',
        phone_numbers: Array.isArray(account.phone_numbers)
          ? account.phone_numbers.map((phone) => ({
              id: phone.id || '',
              display_phone_number: phone.display_phone_number || '',
              verified_name: phone.verified_name || '',
            }))
          : [],
      })),
    };
  }

  return {};
}

function applySelectionToConnection(channel, next, metadata = {}) {
  if (channel === 'instagram' || channel === 'messenger') {
    const pages = Array.isArray(metadata.oauth_pages) ? metadata.oauth_pages : [];
    const selectedPage = pages.find((page) => page.id === next.page_id);

    if (selectedPage) {
      next.display_name = channel === 'instagram'
        ? selectedPage.instagram_username || selectedPage.name || next.display_name
        : selectedPage.name || next.display_name;
      next.access_token = selectedPage.page_access_token_encrypted || next.access_token;

      if (channel === 'instagram' && !coerceText(next.instagram_account_id)) {
        next.instagram_account_id = selectedPage.instagram_business_account_id || '';
      }
    }
  }

  if (channel === 'whatsapp') {
    const accounts = Array.isArray(metadata.oauth_business_accounts) ? metadata.oauth_business_accounts : [];
    const selectedAccount = accounts.find((account) => account.id === next.business_account_id);

    if (selectedAccount) {
      next.display_name = selectedAccount.name || selectedAccount.business_name || next.display_name;

      if (!coerceText(next.phone_number_id) && Array.isArray(selectedAccount.phone_numbers) && selectedAccount.phone_numbers.length === 1) {
        next.phone_number_id = selectedAccount.phone_numbers[0].id || '';
      }
    }
  }
}

function maskToken(value) {
  const token = coerceText(value);
  if (!token) {
    return '';
  }

  if (token.length <= 8) {
    return `${token.slice(0, 2)}****`;
  }

  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}

function maskTokenAscii(value) {
  return maskToken(value);
}

function serializeConnection(row) {
  const channelConfig = getChannelConfig(row?.channel_type);
  const metadata = safeJsonParse(row?.metadata_json, {});
  const scopes = safeJsonParse(row?.scopes_json, []);
  const missingFields = computeMissingFields(row?.channel_type, row || {});
  const status = determineConnectionState(row?.channel_type, row || {}, metadata);
  let accessTokenMasked = '';

  try {
    accessTokenMasked = maskTokenAscii(decryptToken(row?.access_token));
  } catch (error) {
    accessTokenMasked = '';
  }

  return {
    id: row?.id || '',
    channel: row?.channel_type || '',
    label: channelConfig?.label || row?.channel_type || '',
    status,
    setup_state: status,
    display_name: row?.display_name || '',
    access_token_masked: accessTokenMasked,
    page_id: row?.page_id || '',
    instagram_account_id: row?.instagram_account_id || '',
    business_account_id: row?.business_account_id || '',
    phone_number_id: row?.phone_number_id || '',
    scopes,
    selection_options: buildSelectionOptions(row?.channel_type, metadata),
    missing_fields: missingFields,
    can_send: status === CONNECTION_STATES.READY,
    capabilities: PROVIDER_CAPABILITIES[row?.channel_type] || {},
    connected_at: row?.connected_at || null,
    last_webhook_at: row?.last_webhook_at || null,
    last_sync_at: row?.last_sync_at || null,
    updated_at: row?.updated_at || null,
  };
}

function upsertConnection(db, userId, channel, input = {}) {
  const channelConfig = getChannelConfig(channel);
  if (!channelConfig) {
    throw new Error('Unsupported Meta channel.');
  }

  const existing = getConnectionRow(db, userId, channel);
  const next = {
    id: existing?.id || crypto.randomUUID(),
    user_id: userId,
    channel_type: channel,
    display_name: coerceText(input.display_name) || existing?.display_name || '',
    access_token: coerceText(input.access_token)
      ? encryptToken(input.access_token)
      : existing?.access_token || '',
    page_id: coerceText(input.page_id) || existing?.page_id || '',
    instagram_account_id: coerceText(input.instagram_account_id) || existing?.instagram_account_id || '',
    business_account_id: coerceText(input.business_account_id) || existing?.business_account_id || '',
    phone_number_id: coerceText(input.phone_number_id) || existing?.phone_number_id || '',
    scopes_json: JSON.stringify(coerceScopes(input.scopes).length ? coerceScopes(input.scopes) : safeJsonParse(existing?.scopes_json, [])),
  };
  const metadata = {
    ...safeJsonParse(existing?.metadata_json, {}),
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
  };

  applySelectionToConnection(channel, next, metadata);
  next.status = determineConnectionState(channel, next, metadata);
  next.metadata_json = JSON.stringify(metadata);

  db.prepare(`
    INSERT INTO meta_channel_connections (
      id,
      user_id,
      channel_type,
      status,
      display_name,
      access_token,
      scopes_json,
      page_id,
      instagram_account_id,
      business_account_id,
      phone_number_id,
      metadata_json,
      connected_at,
      last_sync_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @user_id,
      @channel_type,
      @status,
      @display_name,
      @access_token,
      @scopes_json,
      @page_id,
      @instagram_account_id,
      @business_account_id,
      @phone_number_id,
      @metadata_json,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(user_id, channel_type) DO UPDATE SET
      status = excluded.status,
      display_name = excluded.display_name,
      access_token = excluded.access_token,
      scopes_json = excluded.scopes_json,
      page_id = excluded.page_id,
      instagram_account_id = excluded.instagram_account_id,
      business_account_id = excluded.business_account_id,
      phone_number_id = excluded.phone_number_id,
      metadata_json = excluded.metadata_json,
      connected_at = COALESCE(meta_channel_connections.connected_at, excluded.connected_at),
      last_sync_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(next);

  return serializeConnection(getConnectionRow(db, userId, channel));
}

function disconnectConnection(db, userId, channel) {
  const existing = getConnectionRow(db, userId, channel);
  db.prepare(`
    DELETE FROM meta_channel_connections
    WHERE user_id = ? AND channel_type = ?
  `).run(userId, channel);

  return Boolean(existing);
}

function listConnections(db, userId) {
  const rows = db.prepare(`
    SELECT *
    FROM meta_channel_connections
    WHERE user_id = ?
  `).all(userId);

  const byChannel = new Map(rows.map((row) => [row.channel_type, row]));
  return Object.keys(CHANNEL_CONFIG).map((channel) => {
    const row = byChannel.get(channel);
    if (!row) {
      return {
        channel,
        label: CHANNEL_CONFIG[channel].label,
        status: CONNECTION_STATES.DISCONNECTED,
        setup_state: CONNECTION_STATES.DISCONNECTED,
        display_name: '',
        access_token_masked: '',
        page_id: '',
        instagram_account_id: '',
        business_account_id: '',
        phone_number_id: '',
        scopes: [],
        selection_options: buildSelectionOptions(channel, {}),
        missing_fields: CHANNEL_CONFIG[channel].requiredFields,
        can_send: false,
        capabilities: PROVIDER_CAPABILITIES[channel] || {},
        connected_at: null,
        last_webhook_at: null,
        last_sync_at: null,
        updated_at: null,
      };
    }

    return serializeConnection(row);
  });
}

function deriveParticipantName(channel, participantId, explicitName = '') {
  const safeName = coerceText(explicitName);
  if (safeName) {
    return safeName;
  }

  const suffix = String(participantId || '').slice(-6) || 'guest';
  if (channel === 'whatsapp') {
    return `WhatsApp ${suffix}`;
  }

  if (channel === 'instagram') {
    return `Instagram ${suffix}`;
  }

  return `Messenger ${suffix}`;
}

function upsertConversation(db, {
  userId,
  connectionId,
  channel,
  externalThreadKey,
  participantId,
  participantName,
  participantHandle,
  participantAvatarUrl,
  lastMessagePreview,
  lastMessageAt,
  unreadIncrement = 0,
  metadata = {},
}) {
  const existing = db.prepare(`
    SELECT *
    FROM meta_conversations
    WHERE user_id = ? AND channel_type = ? AND external_thread_key = ?
  `).get(userId, channel, externalThreadKey);

  const next = {
    id: existing?.id || crypto.randomUUID(),
    user_id: userId,
    connection_id: connectionId || existing?.connection_id || null,
    channel_type: channel,
    external_thread_key: externalThreadKey,
    participant_id: participantId || existing?.participant_id || '',
    participant_name: participantName || existing?.participant_name || deriveParticipantName(channel, participantId),
    participant_handle: participantHandle || existing?.participant_handle || '',
    participant_avatar_url: participantAvatarUrl || existing?.participant_avatar_url || '',
    last_message_preview: lastMessagePreview || existing?.last_message_preview || '',
    last_message_at: lastMessageAt || existing?.last_message_at || new Date().toISOString(),
    unread_count: Math.max(0, Number(existing?.unread_count || 0) + Number(unreadIncrement || 0)),
    metadata_json: JSON.stringify({
      ...safeJsonParse(existing?.metadata_json, {}),
      ...metadata,
    }),
  };

  db.prepare(`
    INSERT INTO meta_conversations (
      id,
      user_id,
      connection_id,
      channel_type,
      external_thread_key,
      participant_id,
      participant_name,
      participant_handle,
      participant_avatar_url,
      last_message_preview,
      last_message_at,
      unread_count,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @user_id,
      @connection_id,
      @channel_type,
      @external_thread_key,
      @participant_id,
      @participant_name,
      @participant_handle,
      @participant_avatar_url,
      @last_message_preview,
      @last_message_at,
      @unread_count,
      @metadata_json,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(user_id, channel_type, external_thread_key) DO UPDATE SET
      connection_id = excluded.connection_id,
      participant_id = COALESCE(NULLIF(excluded.participant_id, ''), meta_conversations.participant_id),
      participant_name = COALESCE(NULLIF(excluded.participant_name, ''), meta_conversations.participant_name),
      participant_handle = COALESCE(NULLIF(excluded.participant_handle, ''), meta_conversations.participant_handle),
      participant_avatar_url = COALESCE(NULLIF(excluded.participant_avatar_url, ''), meta_conversations.participant_avatar_url),
      last_message_preview = COALESCE(NULLIF(excluded.last_message_preview, ''), meta_conversations.last_message_preview),
      last_message_at = excluded.last_message_at,
      unread_count = excluded.unread_count,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(next);

  return db.prepare(`
    SELECT *
    FROM meta_conversations
    WHERE id = ?
  `).get(next.id);
}

function storeMessage(db, {
  conversationId,
  userId,
  channel,
  externalMessageId,
  direction,
  senderId,
  senderName,
  recipientId,
  text,
  deliveryStatus = 'received',
  rawPayload = {},
  sentAt,
}) {
  const messageId = crypto.randomUUID();

  db.prepare(`
    INSERT OR IGNORE INTO meta_messages (
      id,
      conversation_id,
      user_id,
      channel_type,
      external_message_id,
      direction,
      sender_id,
      sender_name,
      recipient_id,
      text,
      delivery_status,
      raw_payload_json,
      sent_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    messageId,
    conversationId,
    userId,
    channel,
    externalMessageId || null,
    direction,
    senderId || null,
    senderName || null,
    recipientId || null,
    text || '',
    deliveryStatus,
    JSON.stringify(rawPayload || {}),
    sentAt || new Date().toISOString(),
  );

  return db.prepare(`
    SELECT *
    FROM meta_messages
    WHERE conversation_id = ?
    ORDER BY datetime(sent_at) DESC, created_at DESC
    LIMIT 1
  `).get(conversationId);
}

function serializeConversation(row, connectionMap = new Map()) {
  const connection = connectionMap.get(row?.connection_id) || null;
  const channel = row?.channel_type || '';

  return {
    id: row?.id || '',
    source: 'live',
    channel,
    participant_name: row?.participant_name || deriveParticipantName(channel, row?.participant_id),
    participant_handle: row?.participant_handle || '',
    participant_avatar_url: row?.participant_avatar_url || '',
    participant_id: row?.participant_id || '',
    preview: row?.last_message_preview || '',
    last_message_at: row?.last_message_at || row?.updated_at || row?.created_at || null,
    unread_count: Number(row?.unread_count || 0),
    can_send: Boolean(connection?.can_send),
    connection_status: connection?.status || CONNECTION_STATES.DISCONNECTED,
  };
}

function listConversations(db, userId) {
  const connectionRows = db.prepare(`
    SELECT *
    FROM meta_channel_connections
    WHERE user_id = ?
  `).all(userId);
  const connectionMap = new Map(connectionRows.map((row) => [row.id, serializeConnection(row)]));

  const rows = db.prepare(`
    SELECT *
    FROM meta_conversations
    WHERE user_id = ?
    ORDER BY datetime(last_message_at) DESC, updated_at DESC
  `).all(userId);

  return rows.map((row) => serializeConversation(row, connectionMap));
}

function getConversationById(db, userId, conversationId) {
  return db.prepare(`
    SELECT *
    FROM meta_conversations
    WHERE id = ? AND user_id = ?
  `).get(conversationId, userId);
}

function getConversationMessages(db, userId, conversationId) {
  const conversation = getConversationById(db, userId, conversationId);
  if (!conversation) {
    return null;
  }

  return db.prepare(`
    SELECT *
    FROM meta_messages
    WHERE conversation_id = ?
    ORDER BY datetime(sent_at) ASC, created_at ASC
  `).all(conversationId).map((row) => ({
    id: row.id,
    direction: row.direction,
    text: row.text || '',
    sender_id: row.sender_id || '',
    sender_name: row.sender_name || '',
    recipient_id: row.recipient_id || '',
    delivery_status: row.delivery_status || '',
    sent_at: row.sent_at || row.created_at || null,
    meta: row.delivery_status || '',
  }));
}

function getOverview(db, userId) {
  const app = getPublicMetaAppConfig();
  const connections = listConnections(db, userId);
  const conversations = listConversations(db, userId);
  const readyCount = connections.filter((connection) => connection.status === CONNECTION_STATES.READY).length;
  const configuredCount = connections.filter((connection) => connection.status !== CONNECTION_STATES.DISCONNECTED).length;
  const setupRequiredCount = connections.filter((connection) => connection.status === CONNECTION_STATES.SELECTION_REQUIRED || connection.status === CONNECTION_STATES.NEEDS_SETUP).length;
  const status = app.status === 'unavailable'
    ? 'unavailable'
    : readyCount > 0
      ? 'live'
      : configuredCount > 0 || app.status === 'partial'
        ? 'partial'
        : 'unavailable';

  return {
    status,
    app: {
      ...app,
      connected_channel_count: configuredCount,
      ready_channel_count: readyCount,
      setup_required_count: setupRequiredCount,
    },
    connections,
    provider_capability_matrix: PROVIDER_CAPABILITIES,
    conversations,
  };
}

function recordWebhookEvent(db, {
  userId = null,
  channel,
  eventUid,
  payload,
  processed = false,
}) {
  const existing = db.prepare(`
    SELECT id, processed
    FROM meta_webhook_events
    WHERE event_uid = ?
  `).get(eventUid);

  if (existing) {
    return {
      inserted: false,
      processed: Boolean(existing.processed),
    };
  }

  db.prepare(`
    INSERT INTO meta_webhook_events (
      id,
      user_id,
      channel_type,
      event_uid,
      payload_json,
      processed,
      received_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    crypto.randomUUID(),
    userId,
    channel,
    eventUid,
    JSON.stringify(payload || {}),
    processed ? 1 : 0,
  );

  return {
    inserted: true,
    processed,
  };
}

function markWebhookProcessed(db, eventUid) {
  db.prepare(`
    UPDATE meta_webhook_events
    SET processed = 1
    WHERE event_uid = ?
  `).run(eventUid);
}

function touchConnectionWebhook(db, connectionId) {
  if (!connectionId) {
    return;
  }

  db.prepare(`
    UPDATE meta_channel_connections
    SET last_webhook_at = CURRENT_TIMESTAMP,
        last_sync_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(connectionId);
}

function findWhatsAppConnection(db, phoneNumberId) {
  return db.prepare(`
    SELECT *
    FROM meta_channel_connections
    WHERE channel_type = 'whatsapp'
      AND status = 'ready'
      AND phone_number_id = ?
  `).get(phoneNumberId);
}

function findPageConnection(db, channel, entryId, recipientId) {
  return db.prepare(`
    SELECT *
    FROM meta_channel_connections
    WHERE channel_type = ?
      AND status = 'ready'
      AND (page_id = ? OR page_id = ? OR instagram_account_id = ? OR instagram_account_id = ?)
    LIMIT 1
  `).get(channel, entryId || '', recipientId || '', entryId || '', recipientId || '');
}

function extractTextMessage(message) {
  if (message?.text?.body) {
    return message.text.body;
  }

  if (message?.message?.text) {
    return message.message.text;
  }

  if (Array.isArray(message?.attachments) && message.attachments.length) {
    return `[${message.attachments[0]?.type || 'attachment'}]`;
  }

  if (message?.postback?.title) {
    return `[postback] ${message.postback.title}`;
  }

  return '';
}

function processWhatsAppWebhook(db, payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const result = {
    channel: 'whatsapp',
    processed: 0,
    duplicates: 0,
    unmatched: 0,
  };

  entries.forEach((entry) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    changes.forEach((change) => {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id || '';
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const contactMap = new Map(contacts.map((contact) => [contact.wa_id, contact.profile?.name || '']));

      messages.forEach((message) => {
        const eventUid = `whatsapp:${message?.id || crypto.createHash('sha1').update(JSON.stringify(message || {})).digest('hex')}`;
        const eventRecord = recordWebhookEvent(db, {
          userId: null,
          channel: 'whatsapp',
          eventUid,
          payload: message,
          processed: false,
        });

        if (!eventRecord.inserted) {
          result.duplicates += 1;
          return;
        }

        const connection = findWhatsAppConnection(db, phoneNumberId);
        const participantId = message.from || '';
        const text = extractTextMessage(message);

        if (!connection?.user_id || !message?.id || !text) {
          result.unmatched += 1;
          return;
        }

        db.prepare(`
          UPDATE meta_webhook_events
          SET user_id = ?
          WHERE event_uid = ?
        `).run(connection.user_id, eventUid);

        const conversation = upsertConversation(db, {
          userId: connection.user_id,
          connectionId: connection.id,
          channel: 'whatsapp',
          externalThreadKey: participantId,
          participantId,
          participantName: contactMap.get(participantId) || deriveParticipantName('whatsapp', participantId),
          participantHandle: participantId,
          lastMessagePreview: text,
          lastMessageAt: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
          unreadIncrement: 1,
          metadata: {
            phone_number_id: phoneNumberId,
          },
        });

        storeMessage(db, {
          conversationId: conversation.id,
          userId: connection.user_id,
          channel: 'whatsapp',
          externalMessageId: message.id,
          direction: 'inbound',
          senderId: participantId,
          senderName: contactMap.get(participantId) || '',
          recipientId: phoneNumberId,
          text,
          rawPayload: message,
          sentAt: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });

        markWebhookProcessed(db, eventUid);
        touchConnectionWebhook(db, connection.id);
        result.processed += 1;
      });
    });
  });

  return result;
}

function processMessengerLikeWebhook(db, payload, channel) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const result = {
    channel,
    processed: 0,
    duplicates: 0,
    unmatched: 0,
  };

  entries.forEach((entry) => {
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
    events.forEach((event) => {
      const senderId = event?.sender?.id || '';
      const recipientId = event?.recipient?.id || '';
      const text = extractTextMessage(event);
      const sentAt = event?.timestamp ? new Date(Number(event.timestamp)).toISOString() : new Date().toISOString();
      const externalMessageId = event?.message?.mid || event?.postback?.mid || `${channel}-${crypto.createHash('sha1').update(JSON.stringify(event || {})).digest('hex')}`;
      const eventUid = `${channel}:${externalMessageId}`;
      const eventRecord = recordWebhookEvent(db, {
        userId: null,
        channel,
        eventUid,
        payload: event,
        processed: false,
      });

      if (!eventRecord.inserted) {
        result.duplicates += 1;
        return;
      }

      const connection = findPageConnection(db, channel, entry?.id || '', recipientId);
      if (!connection?.user_id || !text) {
        result.unmatched += 1;
        return;
      }

      db.prepare(`
        UPDATE meta_webhook_events
        SET user_id = ?
        WHERE event_uid = ?
      `).run(connection.user_id, eventUid);

      const isEcho = Boolean(event?.message?.is_echo);
      const participantId = isEcho ? recipientId : senderId;
      const participantName = deriveParticipantName(channel, participantId);
      const conversation = upsertConversation(db, {
        userId: connection.user_id,
        connectionId: connection.id,
        channel,
        externalThreadKey: participantId,
        participantId,
        participantName,
        participantHandle: participantId,
        lastMessagePreview: text,
        lastMessageAt: sentAt,
        unreadIncrement: isEcho ? 0 : 1,
        metadata: {
          page_id: connection.page_id || entry?.id || recipientId,
        },
      });

      storeMessage(db, {
        conversationId: conversation.id,
        userId: connection.user_id,
        channel,
        externalMessageId,
        direction: isEcho ? 'outbound' : 'inbound',
        senderId,
        recipientId,
        text,
        rawPayload: event,
        sentAt,
      });

      markWebhookProcessed(db, eventUid);
      touchConnectionWebhook(db, connection.id);
      result.processed += 1;
    });
  });

  return result;
}

function processWebhookPayload(db, payload) {
  const objectType = String(payload?.object || '').toLowerCase();

  if (objectType === 'whatsapp_business_account') {
    return processWhatsAppWebhook(db, payload);
  }

  if (objectType === 'instagram') {
    return processMessengerLikeWebhook(db, payload, 'instagram');
  }

  if (objectType === 'page') {
    return processMessengerLikeWebhook(db, payload, 'messenger');
  }

  return { channel: '', processed: 0, duplicates: 0, unmatched: 0 };
}

async function sendConversationMessage(db, userId, conversationId, text) {
  const conversation = getConversationById(db, userId, conversationId);
  if (!conversation) {
    throw new Error('Conversation not found.');
  }

  const connectionRow = db.prepare(`
    SELECT *
    FROM meta_channel_connections
    WHERE id = ?
  `).get(conversation.connection_id);

  if (!connectionRow) {
    throw new Error('No connected Meta channel is linked to this conversation.');
  }

  const connection = serializeConnection(connectionRow);
  if (connection.status !== CONNECTION_STATES.READY || !connection.can_send) {
    throw new Error('This channel still needs setup before it can send messages.');
  }

  const accessToken = decryptToken(connectionRow.access_token);
  let responsePayload = null;

  if (conversation.channel_type === 'whatsapp') {
    responsePayload = await graphRequest(`${connection.phone_number_id}/messages`, {
      method: 'POST',
      accessToken,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: conversation.participant_handle || conversation.participant_id,
        type: 'text',
        text: { body: text },
      },
    });
  } else {
    responsePayload = await graphRequest('me/messages', {
      method: 'POST',
      accessToken,
      body: {
        recipient: { id: conversation.participant_id },
        message: { text },
      },
    });
  }

  const externalMessageId = responsePayload?.message_id || responsePayload?.messages?.[0]?.id || '';
  const sentAt = new Date().toISOString();
  storeMessage(db, {
    conversationId: conversation.id,
    userId,
    channel: conversation.channel_type,
    externalMessageId,
    direction: 'outbound',
    senderId: connection.page_id || connection.phone_number_id || '',
    senderName: connection.display_name || connection.label,
    recipientId: conversation.participant_id,
    text,
    deliveryStatus: 'sent',
    rawPayload: responsePayload,
    sentAt,
  });

  upsertConversation(db, {
    userId,
    connectionId: connectionRow.id,
    channel: conversation.channel_type,
    externalThreadKey: conversation.external_thread_key,
    participantId: conversation.participant_id,
    participantName: conversation.participant_name,
    participantHandle: conversation.participant_handle,
    participantAvatarUrl: conversation.participant_avatar_url,
    lastMessagePreview: text,
    lastMessageAt: sentAt,
    unreadIncrement: 0,
    metadata: safeJsonParse(conversation.metadata_json, {}),
  });

  return {
    ok: true,
    provider_response: responsePayload,
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMetaReturnUrls(channel, setupState = CONNECTION_STATES.SELECTION_REQUIRED) {
  const config = getMetaAppConfig();
  const query = new URLSearchParams({
    meta_inbox: '1',
    meta_channel: channel,
    meta_status: setupState,
    refresh: '1',
  }).toString();

  return {
    mobileUrl: `${config.mobileAppScheme}://messages?${query}`,
    webUrl: config.frontendReturnUrl ? `${config.frontendReturnUrl}/?${query}` : '',
  };
}

function buildCallbackHtml({ title, detail, success = true, channel = '', setupState = CONNECTION_STATES.SELECTION_REQUIRED }) {
  const accent = success ? '#7f62ff' : '#ff7aa8';
  const { mobileUrl, webUrl } = buildMetaReturnUrls(channel, setupState);
  const targetUrl = mobileUrl || webUrl || '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, Segoe UI, sans-serif;
        background:
          radial-gradient(circle at top right, rgba(145, 93, 255, 0.22), transparent 35%),
          linear-gradient(180deg, #090611, #05030a);
        color: #f7f2ff;
      }
      main {
        width: min(92vw, 560px);
        padding: 28px;
        border-radius: 28px;
        border: 1px solid rgba(180, 137, 255, 0.2);
        background: rgba(255, 255, 255, 0.05);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
      }
      h1 { margin: 0 0 10px; font-size: 2rem; line-height: 1; }
      p { color: rgba(244, 236, 255, 0.82); line-height: 1.6; }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: ${accent};
        margin-bottom: 16px;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 20px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid rgba(180, 137, 255, 0.26);
        background: rgba(255, 255, 255, 0.08);
        color: #f7f2ff;
        text-decoration: none;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="pill">${success ? 'Connected' : 'Needs attention'}</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
      <p>Return to eXplore to finish setup and refresh your live inbox state.</p>
      <div class="actions">
        ${mobileUrl ? `<a class="button" href="${escapeHtml(mobileUrl)}">Open eXplore app</a>` : ''}
        ${webUrl ? `<a class="button" href="${escapeHtml(webUrl)}">Open web fallback</a>` : ''}
      </div>
    </main>
    ${targetUrl ? `<script>
      setTimeout(function () {
        window.location.href = ${JSON.stringify(targetUrl)};
      }, 700);
      ${webUrl ? `setTimeout(function () {
        if (!document.hidden) {
          window.location.href = ${JSON.stringify(webUrl)};
        }
      }, 1800);` : ''}
    </script>` : ''}
  </body>
</html>`;
}

async function handleOAuthCallback(db, {
  code,
  state,
}) {
  const statePayload = parseMetaState(state);
  const userId = coerceText(statePayload.user_id);
  const channel = coerceText(statePayload.channel).toLowerCase();

  if (!userId || !channel) {
    throw new Error('Meta OAuth state did not contain a user or channel.');
  }

  const tokenPayload = await exchangeCodeForAccessToken(code);
  const baseMetadata = {
    oauth_response: {
      token_type: tokenPayload.token_type || '',
      expires_in: tokenPayload.expires_in || null,
    },
  };

  if (channel === 'instagram' || channel === 'messenger') {
    const pages = await fetchManagedPages(tokenPayload.access_token || '');
    if (!pages.length) {
      throw new Error('Meta OAuth succeeded, but no managed Facebook Page was returned for this account.');
    }

    return upsertConnection(db, userId, channel, {
      access_token: tokenPayload.access_token || '',
      metadata: {
        ...baseMetadata,
        oauth_pages: pages.map((page) => ({
          id: page.id || '',
          name: page.name || '',
          page_access_token_encrypted: encryptToken(page.access_token || tokenPayload.access_token || ''),
          instagram_business_account_id: page.instagram_business_account?.id || '',
          instagram_username: page.instagram_business_account?.username || '',
        })),
      },
      scopes: CHANNEL_CONFIG[channel]?.scopes || [],
    });
  }

  if (channel === 'whatsapp') {
    const businessAccounts = await fetchWhatsAppBusinessAccounts(tokenPayload.access_token || '');
    if (!businessAccounts.length) {
      throw new Error('Meta OAuth succeeded, but no WhatsApp business accounts were returned for this user.');
    }

    return upsertConnection(db, userId, channel, {
      access_token: tokenPayload.access_token || '',
      display_name: 'WhatsApp Business',
      metadata: {
        ...baseMetadata,
        oauth_business_accounts: businessAccounts,
      },
      scopes: CHANNEL_CONFIG[channel]?.scopes || [],
    });
  }

  throw new Error('Unsupported Meta channel.');
}

module.exports = {
  ensureTables,
  getPublicMetaAppConfig,
  getOverview,
  buildAuthorizeUrl,
  verifyWebhookSignature,
  upsertConnection,
  disconnectConnection,
  getConversationMessages,
  processWebhookPayload,
  sendConversationMessage,
  buildCallbackHtml,
  handleOAuthCallback,
  buildMetaState,
  validateMetaRuntimeConfig,
  PROVIDER_CAPABILITIES,
};
