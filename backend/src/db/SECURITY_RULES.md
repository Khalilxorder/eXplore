# SQLite Security Rules & User Isolation Patterns

Unlike PostgreSQL, SQLite does not have native Row Level Security (RLS). Because the Personal Intelligence Engine runs in a local/shared environment, **user isolation must be strictly enforced at the application layer**. 

All database operations touching user-scoped data must adhere to these policies and utilize the query isolation patterns below.

---

## 1. Table Scope Classifications

### A. User-Isolated Tables (MUST filter by `user_id`)
The following tables store private user data and **must never** be queried without a strict `user_id = ?` clause:
* `user_interests`
* `user_goals`
* `user_preference_profiles`
* `user_profile_vectors`
* `recommendations`
* `memories`
* `daily_user_insights`
* `interaction_events`
* `content_sources`
* `private_chat_profiles`
* `private_conversation_preferences`
* `user_alert_states`
* `saved_items`
* `saved_opportunities`
* `subscriptions`

### B. Global / Shared Tables (Read-Only or Background Workers)
The following tables contain shared knowledge, ML models, or public references. Access does not require a `user_id` filter but should be restricted appropriately in user facing APIs:
* `content_items`
* `content_chunks`
* `content_item_embeddings`
* `topics`
* `sources`
* `creators`
* `model_versions`
* `training_runs`

---

## 2. Secure Query Patterns

### SELECT Query Pattern
Always include the `user_id` in the `WHERE` clause, even if the primary key is known.

```javascript
// SECURE
const interest = db.prepare(`
  SELECT * FROM user_interests 
  WHERE id = ? AND user_id = ?
`).get(interestId, userId);

// INSECURE (Leaking interest of another user if ID is guessed)
const leakedInterest = db.prepare(`
  SELECT * FROM user_interests 
  WHERE id = ?
`).get(interestId);
```

### INSERT Query Pattern
Always bind `user_id` dynamically from the authenticated session context. Never trust a `user_id` passed in request bodies without validating it against the session.

```javascript
// SECURE
db.prepare(`
  INSERT INTO user_goals (id, user_id, goal_text, target_date, status, priority)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(uuid(), session.userId, goalText, targetDate, 'active', priority);
```

### UPDATE Query Pattern
Always include the `user_id` filter in the update criteria.

```javascript
// SECURE
db.prepare(`
  UPDATE user_preference_profiles
  SET depth_pref = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND user_id = ?
`).run(depthPref, profileId, session.userId);
```

### DELETE Query Pattern
Always filter deletions by the active user's ID.

```javascript
// SECURE
db.prepare(`
  DELETE FROM memories 
  WHERE id = ? AND user_id = ?
`).run(memoryId, session.userId);
```

---

## 3. Query Security Auditing Helper

To automate query verification, use the `enforceUserIsolation` helper exported by the bootstrap module during development and testing:

```javascript
const { enforceUserIsolation } = require('./sqliteBootstrap');

// Will throw an error if the query does not contain 'user_id' filter logic
try {
  const audit = enforceUserIsolation(
    'SELECT * FROM user_interests WHERE user_id = ?', 
    session.userId
  );
  db.prepare(audit.query).all(audit.userId);
} catch (error) {
  console.error('Security alert:', error.message);
}
```
