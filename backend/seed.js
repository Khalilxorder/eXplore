const Database = require('better-sqlite3');
const db = new Database(require('path').join(__dirname, 'explore.db'));
const { ensureSqliteIdealState } = require('./src/db/sqliteBootstrap');
ensureSqliteIdealState(db);


const MOCK_CONTENT = {
  newImportant: [
    {
      id: '1', title: 'The Real Reason AI Is Moving Faster Than Anyone Expected',
      source: 'Lex Fridman Podcast', date: '2026-03-05', duration: 7820,
      thumbnail: 'https://picsum.photos/seed/ai-speed/640/360',
      badges: ['new'], reason: 'Trending in AI this week, matches your top interest',
      scores: { relevance: 0.95, depth: 0.88, rarity: 0.2 }, topics: ['AI', 'Technology'],
    },
    {
      id: '2', title: 'How Attention Mechanisms Actually Work — A Visual Guide',
      source: '3Blue1Brown', date: '2026-03-03', duration: 2340,
      thumbnail: 'https://picsum.photos/seed/attention/640/360',
      badges: ['new'], reason: 'Best new explanation on transformer architecture',
      scores: { relevance: 0.92, depth: 0.95, rarity: 0.3 }, topics: ['AI', 'Mathematics'],
    },
    {
      id: '3', title: 'The Psychology of Beautiful Software',
      source: 'Design Notes', date: '2026-03-01', duration: 3600,
      thumbnail: 'https://picsum.photos/seed/design-psych/640/360',
      badges: ['new'], reason: 'Bridges your interests in Design and Psychology',
      scores: { relevance: 0.89, depth: 0.75, rarity: 0.4 }, topics: ['Design', 'Psychology'],
    },
  ],
  oldGems: [
    {
      id: '4', title: 'Steve Jobs: The Lost Interview (Full, Uncut)',
      source: 'Silicon Valley Historical Society', date: '1995-01-01', duration: 4320,
      thumbnail: 'https://picsum.photos/seed/jobs-lost/640/360',
      badges: ['rare', 'timeless'], reason: 'Rare: only 45K views, recorded 1995, rediscovered 2012',
      scores: { relevance: 0.78, depth: 0.85, rarity: 0.97 }, topics: ['Technology', 'Entrepreneurship'],
    },
    {
      id: '5', title: 'Carl Jung — The Power of the Unconscious (1957 Lecture)',
      source: 'Archive.org', date: '1957-06-15', duration: 5400,
      thumbnail: 'https://picsum.photos/seed/jung-lecture/640/360',
      badges: ['rare', 'timeless'], reason: 'Rare: original audio, only academic copies existed until 2019',
      scores: { relevance: 0.82, depth: 0.92, rarity: 0.99 }, topics: ['Psychology', 'Philosophy'],
    },
    {
      id: '6', title: 'Richard Feynman: The Character of Physical Law (Full Series)',
      source: 'Cornell University Archives', date: '1964-11-01', duration: 21600,
      thumbnail: 'https://picsum.photos/seed/feynman/640/360',
      badges: ['timeless'], reason: 'Timeless: considered the greatest physics lectures ever delivered',
      scores: { relevance: 0.75, depth: 0.99, rarity: 0.85 }, topics: ['Physics', 'Science'],
    },
  ],
  deepDives: [
    {
      id: '7', title: 'Consciousness: The Hard Problem — A 4-Hour Deep Dive',
      source: 'Closer To Truth', date: '2024-08-12', duration: 14400,
      thumbnail: 'https://picsum.photos/seed/consciousness/640/360',
      badges: ['deep'], reason: 'Deep Dive: covers 12 subtopics, 4 hours, expert panel',
      scores: { relevance: 0.85, depth: 0.99, rarity: 0.6 }, topics: ['Philosophy', 'Neuroscience'],
    },
    {
      id: '8', title: 'Building a Neural Network from Scratch — Complete Workshop',
      source: 'Andrej Karpathy', date: '2025-01-20', duration: 10800,
      thumbnail: 'https://picsum.photos/seed/neural-network/640/360',
      badges: ['deep'], reason: 'Deep Dive: hands-on, 3 hours, from fundamentals to GPT',
      scores: { relevance: 0.93, depth: 0.97, rarity: 0.35 }, topics: ['AI', 'Technology'],
    },
    {
      id: '9', title: 'The History of Music Theory — From Pythagoras to Today',
      source: 'Adam Neely', date: '2023-05-10', duration: 7200,
      thumbnail: 'https://picsum.photos/seed/music-theory/640/360',
      badges: ['deep'], reason: 'Deep Dive: 2 hours covering 2500 years of music theory',
      scores: { relevance: 0.80, depth: 0.94, rarity: 0.5 }, topics: ['Music', 'History'],
    },
  ],
  becauseYouCare: [
    {
      id: '10', title: 'Why LLMs Hallucinate — And What We Can Do About It',
      source: 'Yannic Kilcher', date: '2026-02-28', duration: 2700,
      thumbnail: 'https://picsum.photos/seed/hallucinate/640/360',
      badges: [], reason: 'Matches your interest in AI',
      scores: { relevance: 0.91, depth: 0.72, rarity: 0.3 }, topics: ['AI'],
    },
    {
      id: '11', title: "The Most Important Idea in Psychology You've Never Heard Of",
      source: 'Vsauce', date: '2025-11-05', duration: 1800,
      thumbnail: 'https://picsum.photos/seed/psych-idea/640/360',
      badges: [], reason: 'Matches your interest in Psychology',
      scores: { relevance: 0.87, depth: 0.68, rarity: 0.45 }, topics: ['Psychology'],
    },
  ],
  savedForLater: [
    {
      id: '12', title: 'The Art of Game Design — Full Course by Jesse Schell',
      source: 'Carnegie Mellon', date: '2022-09-01', duration: 32400,
      thumbnail: 'https://picsum.photos/seed/game-design/640/360',
      badges: ['deep'], reason: 'You saved this 2 days ago',
      scores: { relevance: 0.88, depth: 0.96, rarity: 0.55 }, topics: ['Design', 'Creativity'],
      progress: 0.15,
    },
  ],
};

const insertItem = db.prepare(`
  INSERT INTO content_items (
    id, external_id, title, url, thumbnail_url, publish_date,
    duration_seconds, summary, topic_tags_json, 
    rarity_score, depth_score, freshness_score, timeless_score,
    source_id, created_at
  ) VALUES (
    @id, @external_id, @title, @url, @thumbnail_url, @publish_date,
    @duration_seconds, @summary, @topic_tags_json,
    @rarity_score, @depth_score, @freshness_score, @timeless_score,
    @source_id, CURRENT_TIMESTAMP
  )
`);

const insertSource = db.prepare(`
  INSERT OR IGNORE INTO sources (id, platform, name) VALUES (@id, @platform, @name)
`);

const insertReason = db.prepare(`
  INSERT INTO recommendation_reasons (id, content_id, reason_type, reason_text)
  VALUES (@id, @content_id, @reason_type, @reason_text)
`);

db.transaction(() => {
  // Simple mapping to populate the database mimicking the initial mock structure
  const allItems = [
    ...MOCK_CONTENT.newImportant.map(i => ({...i, feed_type: 'new'})),
    ...MOCK_CONTENT.oldGems.map(i => ({...i, feed_type: 'old'})),
    ...MOCK_CONTENT.deepDives.map(i => ({...i, feed_type: 'deep'})),
    ...MOCK_CONTENT.becauseYouCare.map(i => ({...i, feed_type: 'care'})),
    ...MOCK_CONTENT.savedForLater.map(i => ({...i, feed_type: 'saved'}))
  ];

  for (const item of allItems) {
    const sourceId = 'src_' + Buffer.from(item.source).toString('base64').substring(0,8);
    
    insertSource.run({ id: sourceId, platform: 'youtube', name: item.source });

    // Derive scores mimicking what would be ML analysis
    const freshness = item.badges.includes('new') ? 1.0 : 0.0;
    const timeless = item.badges.includes('timeless') ? 1.0 : 0.0;
    const rarity = item.scores?.rarity || 0.0;
    const depth = item.scores?.depth || 0.0;

    try {
      insertItem.run({
        id: item.id,
        external_id: 'ext_' + item.id,
        title: item.title,
        url: 'https://youtube.com/watch?v=' + item.id,
        thumbnail_url: item.thumbnail,
        publish_date: item.date,
        duration_seconds: item.duration,
        summary: 'This content provides an in-depth exploration of the topic, drawing from expert insights and thorough analysis. It covers key concepts, historical context, and practical implications relevant to your interests.',
        topic_tags_json: JSON.stringify(item.topics || []),
        rarity_score: rarity,
        depth_score: depth,
        freshness_score: freshness,
        timeless_score: timeless,
        source_id: sourceId
      });

      insertReason.run({
        id: 'rsn_' + item.id,
        content_id: item.id,
        reason_type: item.feed_type,
        reason_text: item.reason
      });

        // Insert badges into a notes field for quick retrieval mock testing
        // or just keep them derived
    } catch(e) {
      if(!e.message.includes('UNIQUE constraint failed')) {
         console.error('Failed on', item.id, e);
      }
    }
  }
  
  // Ensure user_1 exists to avoid foreign key constraint issues
  try {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, onboarding)
      VALUES ('user_1', 'explorer@example.com', 'Explorer', 1)
    `).run();
  } catch(e) {}

  // Seed saved items explicitly for the Saved items section
  const savedItem = MOCK_CONTENT.savedForLater[0];
  try {
     db.prepare('INSERT OR IGNORE INTO saved_items (id, user_id, content_id) VALUES (?, ?, ?)')
       .run('sav_1', 'user_1', savedItem.id);
  } catch (e) {}

  // Seed Personal Intelligence Engine requirements
  try {
    const contentSources = [
      { id: 'cs_1', user_id: 'user_1', name: 'MIT OpenCourseWare', url: 'https://ocw.mit.edu', platform: 'web', active: 1 },
      { id: 'cs_2', user_id: 'user_1', name: 'Lex Fridman', url: 'https://youtube.com/lexfridman', platform: 'youtube', active: 1 }
    ];
    const insertCS = db.prepare('INSERT OR IGNORE INTO content_sources (id, user_id, name, url, platform, active) VALUES (?, ?, ?, ?, ?, ?)');
    for (const cs of contentSources) {
      insertCS.run(cs.id, cs.user_id, cs.name, cs.url, cs.platform, cs.active);
    }

    const contentChunks = [
      { id: 'chunk_1_1', content_item_id: '1', chunk_index: 0, content_text: 'Introduction to artificial intelligence velocity and constraints.', start_time_seconds: 0.0, end_time_seconds: 120.0 },
      { id: 'chunk_1_2', content_item_id: '1', chunk_index: 1, content_text: 'Deep dive into computational scaling and transformer architectures.', start_time_seconds: 120.0, end_time_seconds: 300.0 },
      { id: 'chunk_2_1', content_item_id: '2', chunk_index: 0, content_text: 'Visualizing matrices and multi-head attention components.', start_time_seconds: 0.0, end_time_seconds: 180.0 }
    ];
    const insertChunk = db.prepare('INSERT OR IGNORE INTO content_chunks (id, content_item_id, chunk_index, content_text, start_time_seconds, end_time_seconds) VALUES (?, ?, ?, ?, ?, ?)');
    for (const chunk of contentChunks) {
      insertChunk.run(chunk.id, chunk.content_item_id, chunk.chunk_index, chunk.content_text, chunk.start_time_seconds, chunk.end_time_seconds);
    }

    const contentEmbeddings = [
      { id: 'emb_1', content_item_id: '1', chunk_id: null, embedding_json: JSON.stringify([0.1, 0.2, -0.3, 0.4]), model_version: 'v1.0.0' },
      { id: 'emb_2', content_item_id: null, chunk_id: 'chunk_1_1', embedding_json: JSON.stringify([0.05, 0.15, -0.22, 0.35]), model_version: 'v1.0.0' },
      { id: 'emb_3', content_item_id: null, chunk_id: 'chunk_2_1', embedding_json: JSON.stringify([-0.1, 0.3, 0.8, -0.05]), model_version: 'v1.0.0' }
    ];
    const insertEmb = db.prepare('INSERT OR IGNORE INTO content_item_embeddings (id, content_item_id, chunk_id, embedding_json, model_version) VALUES (?, ?, ?, ?, ?)');
    for (const emb of contentEmbeddings) {
      insertEmb.run(emb.id, emb.content_item_id, emb.chunk_id, emb.embedding_json, emb.model_version);
    }

    const interactionEvents = [
      { id: 'evt_1', user_id: 'user_1', content_item_id: '1', event_type: 'click', event_data_json: JSON.stringify({ device: 'mobile' }), duration_ms: null },
      { id: 'evt_2', user_id: 'user_1', content_item_id: '1', event_type: 'watch_progress', event_data_json: JSON.stringify({ progress_percent: 45 }), duration_ms: 120000 },
      { id: 'evt_3', user_id: 'user_1', content_item_id: '3', event_type: 'save', event_data_json: JSON.stringify({ collection: 'favorites' }), duration_ms: null }
    ];
    const insertEvt = db.prepare('INSERT OR IGNORE INTO interaction_events (id, user_id, content_item_id, event_type, event_data_json, duration_ms) VALUES (?, ?, ?, ?, ?, ?)');
    for (const evt of interactionEvents) {
      insertEvt.run(evt.id, evt.user_id, evt.content_item_id, evt.event_type, evt.event_data_json, evt.duration_ms);
    }

    const userInterests = [
      { id: 'ui_1', user_id: 'user_1', interest_name: 'AI & Machine Learning', weight: 0.95 },
      { id: 'ui_2', user_id: 'user_1', interest_name: 'Cognitive Science', weight: 0.85 },
      { id: 'ui_3', user_id: 'user_1', interest_name: 'Design & Visual Arts', weight: 0.75 }
    ];
    const insertInterest = db.prepare('INSERT OR IGNORE INTO user_interests (id, user_id, interest_name, weight) VALUES (?, ?, ?, ?)');
    for (const ui of userInterests) {
      insertInterest.run(ui.id, ui.user_id, ui.interest_name, ui.weight);
    }

    const userGoals = [
      { id: 'ug_1', user_id: 'user_1', goal_text: 'Understand transformer self-attention mechanisms deeply', target_date: '2026-07-15 00:00:00', status: 'active', priority: 'high' },
      { id: 'ug_2', user_id: 'user_1', goal_text: 'Build a personal intelligence agent interface', target_date: '2026-08-01 00:00:00', status: 'active', priority: 'medium' }
    ];
    const insertGoal = db.prepare('INSERT OR IGNORE INTO user_goals (id, user_id, goal_text, target_date, status, priority) VALUES (?, ?, ?, ?, ?, ?)');
    for (const ug of userGoals) {
      insertGoal.run(ug.id, ug.user_id, ug.goal_text, ug.target_date, ug.status, ug.priority);
    }

    const preferenceProfiles = [
      { id: 'upp_1', user_id: 'user_1', profile_name: 'Deep Technical Focus', depth_pref: 0.9, rarity_pref: 0.7, length_pref: 0.8, topics_avoid_json: JSON.stringify(['pop culture', 'gossip']), topics_focus_json: JSON.stringify(['AI', 'neuroscience', 'mathematics']) },
      { id: 'upp_2', user_id: 'user_1', profile_name: 'Quick Summaries', depth_pref: 0.3, rarity_pref: 0.4, length_pref: 0.2, topics_avoid_json: JSON.stringify(['gossip']), topics_focus_json: JSON.stringify(['news', 'technology']) }
    ];
    const insertProfile = db.prepare('INSERT OR IGNORE INTO user_preference_profiles (id, user_id, profile_name, depth_pref, rarity_pref, length_pref, topics_avoid_json, topics_focus_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const upp of preferenceProfiles) {
      insertProfile.run(upp.id, upp.user_id, upp.profile_name, upp.depth_pref, upp.rarity_pref, upp.length_pref, upp.topics_avoid_json, upp.topics_focus_json);
    }

    const userProfileVectors = [
      { id: 'upv_1', user_id: 'user_1', profile_type: 'interests', vector_json: JSON.stringify([0.15, -0.05, 0.4, 0.85]), model_version: 'v1.0.0' },
      { id: 'upv_2', user_id: 'user_1', profile_type: 'goals', vector_json: JSON.stringify([0.02, 0.3, 0.75, -0.1]), model_version: 'v1.0.0' }
    ];
    const insertVector = db.prepare('INSERT OR IGNORE INTO user_profile_vectors (id, user_id, profile_type, vector_json, model_version) VALUES (?, ?, ?, ?, ?)');
    for (const upv of userProfileVectors) {
      insertVector.run(upv.id, upv.user_id, upv.profile_type, upv.vector_json, upv.model_version);
    }

    const recommendations = [
      { id: 'rec_1', user_id: 'user_1', content_item_id: '1', score: 0.97, reason_json: JSON.stringify({ main_reason: 'Highly relevant to your interest in AI scaling.' }), seen: 1, clicked: 1, model_version: 'v1.0.0' },
      { id: 'rec_2', user_id: 'user_1', content_item_id: '2', score: 0.94, reason_json: JSON.stringify({ main_reason: 'Matches your goal to understand self-attention.' }), seen: 1, clicked: 0, model_version: 'v1.0.0' },
      { id: 'rec_3', user_id: 'user_1', content_item_id: '8', score: 0.89, reason_json: JSON.stringify({ main_reason: 'Deep dive coding workshop recommended for you.' }), seen: 0, clicked: 0, model_version: 'v1.0.0' }
    ];
    const insertRec = db.prepare('INSERT OR IGNORE INTO recommendations (id, user_id, content_item_id, score, reason_json, seen, clicked, model_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const rec of recommendations) {
      insertRec.run(rec.id, rec.user_id, rec.content_item_id, rec.score, rec.reason_json, rec.seen, rec.clicked, rec.model_version);
    }

    const memories = [
      { id: 'mem_1', user_id: 'user_1', content_text: 'User prefers video lectures over written blogs when studying mathematics.', importance_score: 0.8 },
      { id: 'mem_2', user_id: 'user_1', content_text: 'User is working on a personal assistant project using SQLite.', importance_score: 0.9 }
    ];
    const insertMemory = db.prepare('INSERT OR IGNORE INTO memories (id, user_id, content_text, importance_score) VALUES (?, ?, ?, ?)');
    for (const mem of memories) {
      insertMemory.run(mem.id, mem.user_id, mem.content_text, mem.importance_score);
    }

    const memoryQuestions = [
      { id: 'mq_1', memory_id: 'mem_1', question_text: 'What is the user\'s preferred medium for learning mathematics?', answer_text: 'Video lectures', last_asked_at: null }
    ];
    const insertMQ = db.prepare('INSERT OR IGNORE INTO memory_questions (id, memory_id, question_text, answer_text, last_asked_at) VALUES (?, ?, ?, ?, ?)');
    for (const mq of memoryQuestions) {
      insertMQ.run(mq.id, mq.memory_id, mq.question_text, mq.answer_text, mq.last_asked_at);
    }

    const modelVersions = [
      { id: 'mv_1', model_name: 'Explore-UserInterest-Embedder', version_string: 'v1.0.0', parameters_json: JSON.stringify({ dims: 4, learning_rate: 0.01 }), active: 1 }
    ];
    const insertMV = db.prepare('INSERT OR IGNORE INTO model_versions (id, model_name, version_string, parameters_json, active) VALUES (?, ?, ?, ?, ?)');
    for (const mv of modelVersions) {
      insertMV.run(mv.id, mv.model_name, mv.version_string, mv.parameters_json, mv.active);
    }

    const trainingRuns = [
      { id: 'tr_1', model_version_id: 'mv_1', user_id: 'user_1', status: 'completed', metrics_json: JSON.stringify({ loss: 0.024, accuracy: 0.98 }), started_at: '2026-06-28 10:00:00', completed_at: '2026-06-28 10:05:00' }
    ];
    const insertTR = db.prepare('INSERT OR IGNORE INTO training_runs (id, model_version_id, user_id, status, metrics_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const tr of trainingRuns) {
      insertTR.run(tr.id, tr.model_version_id, tr.user_id, tr.status, tr.metrics_json, tr.started_at, tr.completed_at);
    }

    const dailyUserInsights = [
      { id: 'dui_1', user_id: 'user_1', insight_date: '2026-06-28', insight_text: 'You spent 80% of your intelligence gathering time on artificial intelligence theory today. Focus was extremely high on transformer structures.', topics_covered_json: JSON.stringify(['AI', 'Mathematics']), metrics_json: JSON.stringify({ attention_focus_score: 0.92 }) },
      { id: 'dui_2', user_id: 'user_1', insight_date: '2026-06-29', insight_text: 'Your interest profile is starting to incorporate design psychology. Consider looking at visual attention maps next.', topics_covered_json: JSON.stringify(['Design', 'Psychology']), metrics_json: JSON.stringify({ attention_focus_score: 0.78 }) }
    ];
    const insertDUI = db.prepare('INSERT OR IGNORE INTO daily_user_insights (id, user_id, insight_date, insight_text, topics_covered_json, metrics_json) VALUES (?, ?, ?, ?, ?, ?)');
    for (const dui of dailyUserInsights) {
      insertDUI.run(dui.id, dui.user_id, dui.insight_date, dui.insight_text, dui.topics_covered_json, dui.metrics_json);
    }
  } catch (e) {
    console.error('Failed seeding PIE requirement tables:', e);
  }

})();

console.log("Seeding complete.");
db.close();
