const Database = require('better-sqlite3');
const db = new Database(require('path').join(__dirname, 'explore.db'));

db.prepare(`
  INSERT OR IGNORE INTO users (id, email, name, theme, depth_pref, rarity_pref, length_pref, onboarding)
  VALUES ('user_1', 'explorer@example.com', 'Explorer', 'system', 0.5, 0.5, 0.5, 1)
`).run();

const user = db.prepare('SELECT * FROM users WHERE id = ?').get('user_1');
console.log('User seeded:', user);

db.close();
