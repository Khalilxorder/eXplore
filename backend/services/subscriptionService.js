// Subscription Service — tier management, gating, seeding
'use strict';
const crypto = require('crypto');

const TIERS = {
  free: 'tier_free',
  plus: 'tier_plus',
  family: 'tier_family',
};

const TIER_ORDER = ['free', 'plus', 'family'];

const TIER_DEFINITIONS = [
  {
    id: TIERS.free,
    name: 'Free',
    price_monthly: 0,
    price_yearly: 0,
    max_family_members: 1,
    features_json: JSON.stringify([
      'New & Important feed section',
      '5 searches per day',
      'Save up to 10 items',
      'Basic content cards',
    ]),
  },
  {
    id: TIERS.plus,
    name: 'eXplore+',
    price_monthly: 7.99,
    price_yearly: 59.99,
    max_family_members: 1,
    features_json: JSON.stringify([
      'All feed sections (Old Gems, Deep Dives, Because You Care)',
      'Unlimited searches',
      'Unlimited saves',
      'AI summaries & analysis',
      'No ads',
      'Weekly digest email',
    ]),
  },
  {
    id: TIERS.family,
    name: 'eXplore Family',
    price_monthly: 12.99,
    price_yearly: 99.99,
    max_family_members: 6,
    features_json: JSON.stringify([
      'Everything in eXplore+',
      'Up to 6 family members',
      'Shared family feed',
      'Family goals & goal-aligned curation',
      'Safe-Screen mode for kids',
      'Family collections',
    ]),
  },
];

function seedTiers(db) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO subscription_tiers (id, name, price_monthly, price_yearly, max_family_members, features_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const tier of TIER_DEFINITIONS) {
    stmt.run(tier.id, tier.name, tier.price_monthly, tier.price_yearly, tier.max_family_members, tier.features_json);
  }
}

function getTierForUser(db, userId) {
  const sub = db.prepare(`
    SELECT st.name, st.id
    FROM subscriptions s
    JOIN subscription_tiers st ON st.id = s.tier_id
    WHERE s.user_id = ? AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
  `).get(userId);

  if (!sub) return 'free';

  const name = sub.name.toLowerCase();
  if (name.includes('family')) return 'family';
  if (name.includes('plus') || name.includes('explore+')) return 'plus';
  return 'free';
}

function getRawTierIndex(tierName) {
  return TIER_ORDER.indexOf(tierName);
}

function userHasTier(db, userId, requiredTier) {
  const userTier = getTierForUser(db, userId);
  return getRawTierIndex(userTier) >= getRawTierIndex(requiredTier);
}

function getSubscription(db, userId) {
  const sub = db.prepare(`
    SELECT s.*, st.name AS tier_name, st.price_monthly, st.price_yearly, st.features_json, st.max_family_members
    FROM subscriptions s
    JOIN subscription_tiers st ON st.id = s.tier_id
    WHERE s.user_id = ?
  `).get(userId);

  if (!sub) {
    const freeTier = db.prepare('SELECT * FROM subscription_tiers WHERE id = ?').get(TIERS.free);
    return {
      tier: 'free',
      tier_name: 'Free',
      status: 'active',
      price_monthly: 0,
      price_yearly: 0,
      features: freeTier ? JSON.parse(freeTier.features_json || '[]') : [],
      max_family_members: 1,
      expires_at: null,
    };
  }

  return {
    tier: getTierForUser(db, userId),
    tier_name: sub.tier_name,
    status: sub.status,
    price_monthly: sub.price_monthly,
    price_yearly: sub.price_yearly,
    features: JSON.parse(sub.features_json || '[]'),
    max_family_members: sub.max_family_members,
    expires_at: sub.expires_at,
    billing_cycle: sub.billing_cycle,
  };
}

function createOrUpgradeSubscription(db, userId, tierName, billingCycle = 'monthly') {
  const tierMap = { free: TIERS.free, plus: TIERS.plus, family: TIERS.family };
  const tierId = tierMap[tierName.toLowerCase()];
  if (!tierId) throw new Error(`Unknown tier: ${tierName}`);

  const now = new Date();
  let expiresAt = null;
  if (tierName !== 'free') {
    const months = billingCycle === 'yearly' ? 12 : 1;
    expiresAt = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const subId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (id, user_id, tier_id, status, expires_at, billing_cycle)
    VALUES (?, ?, ?, 'active', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tier_id = excluded.tier_id,
      status = 'active',
      expires_at = excluded.expires_at,
      billing_cycle = excluded.billing_cycle,
      started_at = CURRENT_TIMESTAMP
  `).run(subId, userId, tierId, expiresAt, billingCycle);

  return getSubscription(db, userId);
}

function getAllTiers(db) {
  const rows = db.prepare('SELECT * FROM subscription_tiers ORDER BY price_monthly ASC').all();
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    price_monthly: r.price_monthly,
    price_yearly: r.price_yearly,
    max_family_members: r.max_family_members,
    features: JSON.parse(r.features_json || '[]'),
    savings_yearly: r.price_monthly > 0
      ? Math.round(((r.price_monthly * 12) - r.price_yearly) * 100) / 100
      : 0,
  }));
}

module.exports = { seedTiers, getTierForUser, userHasTier, getSubscription, createOrUpgradeSubscription, getAllTiers, TIERS };
