// Family Service — family groups, shared feeds, goals, safe-screen mode
'use strict';
const crypto = require('crypto');

function getFamilyForUser(db, userId) {
  return db.prepare(`
    SELECT f.*, fm.role
    FROM family_members fm
    JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = ?
    LIMIT 1
  `).get(userId);
}

function createFamily(db, userId, name) {
  const familyId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO families (id, name, owner_id) VALUES (?, ?, ?)
  `).run(familyId, name, userId);

  const memberId = crypto.randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO family_members (id, family_id, user_id, role)
    VALUES (?, ?, ?, 'owner')
  `).run(memberId, familyId, userId);

  return getFamilyForUser(db, userId);
}

function getFamilyMembers(db, familyId) {
  return db.prepare(`
    SELECT fm.*, u.name, u.email, u.avatar_url
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ?
    ORDER BY fm.role DESC, fm.joined_at ASC
  `).all(familyId);
}

function inviteMember(db, familyId, email, db_users) {
  // Find user by email
  const targetUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!targetUser) return { error: 'User not found. They must have an eXplore account first.' };

  const existingMembership = db.prepare(
    'SELECT * FROM family_members WHERE family_id = ? AND user_id = ?'
  ).get(familyId, targetUser.id);
  if (existingMembership) return { error: 'User is already in this family.' };

  const memberId = crypto.randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO family_members (id, family_id, user_id, role)
    VALUES (?, ?, ?, 'member')
  `).run(memberId, familyId, targetUser.id);

  return { success: true, member: { id: memberId, user_id: targetUser.id, name: targetUser.name, email: targetUser.email } };
}

function getFamilyGoals(db, familyId) {
  const goals = db.prepare(`
    SELECT * FROM family_goals WHERE family_id = ? AND active = 1 ORDER BY created_at DESC
  `).all(familyId);
  return goals.map(g => ({ ...g, topic_tags: JSON.parse(g.topic_tags_json || '[]') }));
}

function addFamilyGoal(db, familyId, goalText, topicTags = []) {
  const goalId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO family_goals (id, family_id, goal_text, topic_tags_json)
    VALUES (?, ?, ?, ?)
  `).run(goalId, familyId, goalText, JSON.stringify(topicTags));
  return { id: goalId, family_id: familyId, goal_text: goalText, topic_tags: topicTags };
}

function buildFamilyFeed(db, familyId, mapItem, rankingEngine) {
  // 1. Get all family member IDs
  const members = db.prepare('SELECT user_id FROM family_members WHERE family_id = ?').all(familyId);
  const memberIds = members.map(m => m.user_id);

  // 2. Get the family's safe-screen setting
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId);
  const safeScreen = Boolean(family?.safe_screen);

  // 3. Get family goals for topic-alignment boosting
  const goals = getFamilyGoals(db, familyId);
  const goalTopics = goals.flatMap(g => g.topic_tags).map(t => t.toLowerCase());

  // 4. Pull recent content items
  let query = `
    SELECT c.*, s.name AS source_name
    FROM content_items c
    LEFT JOIN sources s ON s.id = c.source_id
  `;
  const params = [];

  if (safeScreen) {
    query += ' WHERE c.clickbait_score < 0.4 AND c.depth_score > 0.3';
  }

  query += ' ORDER BY c.created_at DESC LIMIT 200';
  let rows = db.prepare(query).all(...params);

  // 5. Map and score
  let items = rows.map(mapItem);

  // 6. Boost items that match family goals
  if (goalTopics.length > 0) {
    items = items.map(item => {
      const topicMatch = (item.topics || []).some(t =>
        goalTopics.includes(t.toLowerCase())
      );
      if (topicMatch) {
        return {
          ...item,
          scores: { ...item.scores, relevance: (item.scores?.relevance || 0.5) + 0.3 },
          badges: [...(item.badges || []), 'goal-aligned'],
        };
      }
      return item;
    });
  }

  // 7. Use ranking engine to categorize
  const userPrefs = { depth_pref: 0.6, rarity_pref: 0.5 };
  const categorized = rankingEngine.categorizeForFeed(items, userPrefs);

  return {
    family_name: family?.name || 'Family',
    safe_screen: safeScreen,
    goal_topics: goalTopics,
    sections: [
      {
        id: 'family-new',
        title: 'New for Everyone',
        items: categorized.newImportant.slice(0, 10).map(item => ({
          ...item,
          badges: [...(item.badges || []), 'new'],
          reason: rankingEngine.generateReason(item),
        })),
      },
      {
        id: 'goal-aligned',
        title: 'Aligned with Your Goals',
        items: items
          .filter(i => (i.badges || []).includes('goal-aligned'))
          .slice(0, 10)
          .map(item => ({
            ...item,
            reason: `Matches family goal: ${goalTopics.slice(0, 2).join(', ')}`,
          })),
      },
      {
        id: 'family-deep',
        title: 'Deep Dives for the Family',
        items: categorized.deepDives.slice(0, 8).map(item => ({
          ...item,
          badges: [...(item.badges || []), 'deep'],
          reason: rankingEngine.generateReason(item),
        })),
      },
    ],
  };
}

function toggleSafeScreen(db, familyId, enabled) {
  db.prepare('UPDATE families SET safe_screen = ? WHERE id = ?').run(enabled ? 1 : 0, familyId);
  return { success: true, safe_screen: enabled };
}

module.exports = {
  getFamilyForUser,
  createFamily,
  getFamilyMembers,
  inviteMember,
  getFamilyGoals,
  addFamilyGoal,
  buildFamilyFeed,
  toggleSafeScreen,
};
