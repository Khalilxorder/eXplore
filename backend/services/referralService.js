// Referral Service — referral codes, tracking, free month rewards
'use strict';
const crypto = require('crypto');

function generateCode(userId) {
  // Deterministic prefix + random suffix
  const prefix = userId.slice(0, 4).toUpperCase();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EXP-${prefix}-${suffix}`;
}

function getReferralCode(db, userId) {
  // Check if user already has a referral code
  const existing = db.prepare('SELECT code FROM referrals WHERE referrer_id = ? LIMIT 1').get(userId);
  if (existing) return existing.code;

  // Generate and store a new code
  const code = generateCode(userId);
  const referralId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO referrals (id, referrer_id, code, status)
    VALUES (?, ?, ?, 'code_created')
  `).run(referralId, userId, code);
  return code;
}

function getReferralStats(db, userId) {
  const total = db.prepare(
    "SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = ? AND status = 'converted'"
  ).get(userId)?.count || 0;

  const pending = db.prepare(
    "SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = ? AND status = 'pending'"
  ).get(userId)?.count || 0;

  return { total_conversions: total, pending, free_months_earned: Math.floor(total / 3) };
}

function redeemReferralCode(db, refereeId, code) {
  // Find the referral record
  const referral = db.prepare(
    "SELECT * FROM referrals WHERE code = ? AND status = 'code_created'"
  ).get(code);

  if (!referral) return { error: 'Invalid or already-used referral code.' };
  if (referral.referrer_id === refereeId) return { error: 'You cannot use your own referral code.' };

  // Mark as pending (pending = referee signed up, not yet subscribed)
  db.prepare(`
    UPDATE referrals SET referee_id = ?, status = 'pending' WHERE code = ?
  `).run(refereeId, code);

  return { success: true, message: 'Referral code applied! Your friend will get credit when you subscribe.' };
}

function convertReferral(db, refereeId, subscriptionService) {
  // Called when a referee upgrades to a paid plan
  const referral = db.prepare(
    "SELECT * FROM referrals WHERE referee_id = ? AND status = 'pending'"
  ).get(refereeId);

  if (!referral) return;

  db.prepare(`
    UPDATE referrals SET status = 'converted', converted_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(referral.id);

  // Check if referrer has earned a free month (every 3 conversions)
  const conversions = db.prepare(
    "SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = ? AND status = 'converted'"
  ).get(referral.referrer_id)?.count || 0;

  if (conversions % 3 === 0) {
    // Add 1 free month to referrer's subscription
    db.prepare(`
      UPDATE subscriptions
      SET expires_at = DATETIME(COALESCE(expires_at, CURRENT_TIMESTAMP), '+30 days'),
          referral_months_remaining = referral_months_remaining + 1
      WHERE user_id = ?
    `).run(referral.referrer_id);
  }
}

module.exports = { getReferralCode, getReferralStats, redeemReferralCode, convertReferral };
