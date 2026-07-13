'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
function isUsableSupabaseServiceKey(key = '') {
  const value = String(key || '').trim();
  if (!value) {
    return false;
  }

  if (value.startsWith('sb_secret_')) {
    return value.length >= 30;
  }

  if (value.startsWith('eyJ')) {
    return value.split('.').length === 3;
  }

  return value.length >= 30;
}

function pickUsableSupabaseServiceKey() {
  return [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
  ].find((key) => isUsableSupabaseServiceKey(key)) || '';
}

const SUPABASE_SERVICE_ROLE_KEY = pickUsableSupabaseServiceKey();

function getBearerToken(authorizationHeader = '') {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return '';
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function verifySupabaseAccessToken(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) {
    return null;
  }

  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  if (!response.ok) {
    return null;
  }

  const user = await response.json();
  return {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    avatar_url: user.user_metadata?.avatar_url || '',
    raw: user,
  };
}

function buildUnauthorizedResponse(reply, message = 'Authentication required.') {
  return reply.status(401).send({
    error: message,
    auth_required: true,
  });
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  isUsableSupabaseServiceKey,
  getBearerToken,
  verifySupabaseAccessToken,
  buildUnauthorizedResponse,
};
