const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureSqliteIdealState } = require('../src/db/sqliteBootstrap');

const embeddingProvider = require('../src/services/embeddingProvider');
const rerankerProvider = require('../src/services/rerankerProvider');
const llmProvider = require('../src/services/llmProvider');
const youtubeService = require('../services/youtubeService');

test('Embedding Provider tests', async (t) => {
  await t.test('generates mock embedding with correct dimensions', async () => {
    const vectorOpenAi = await embeddingProvider.generateEmbedding('hello', { provider: 'mock', model: 'text-embedding-3-small' });
    assert.equal(vectorOpenAi.length, 1536);
    assert.ok(Math.abs(vectorOpenAi[0]) > 0);

    const vectorBge = await embeddingProvider.generateEmbedding('hello', { provider: 'mock', model: 'bge-m3' });
    assert.equal(vectorBge.length, 1024);
  });

  await t.test('generateEmbeddingWithMetadata handles mock fallback when OpenAI key is missing', async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    const originalMocks = process.env.ALLOW_DEV_MOCKS;
    
    try {
      process.env.OPENAI_API_KEY = '';
      process.env.ALLOW_DEV_MOCKS = 'false';
      
      const res = await embeddingProvider.generateEmbeddingWithMetadata('hello', { provider: 'openai' });
      assert.equal(res.provider, 'mock');
      assert.equal(res.values.length, 1536);
      assert.ok(res.error);
    } finally {
      process.env.OPENAI_API_KEY = originalKey;
      process.env.ALLOW_DEV_MOCKS = originalMocks;
    }
  });
});

test('Reranker Provider tests', async (t) => {
  await t.test('Jaccard-like overlap computes correct scores', () => {
    const score1 = rerankerProvider.computeOverlapScore('artificial intelligence machine learning', 'This is a video about Artificial Intelligence and machine learning.');
    const score2 = rerankerProvider.computeOverlapScore('artificial intelligence machine learning', 'This is a cooking video about pizza.');
    
    assert.ok(score1 > score2);
    assert.ok(score1 > 0);
    assert.equal(score2, 0);
  });

  await t.test('ranks and sorts documents descending', async () => {
    const docs = [
      { text: 'Cooking pizza with cheese' },
      { text: 'Artificial intelligence deep learning LLMs' },
      { text: 'Baking bread recipe' }
    ];

    const ranked = await rerankerProvider.rerank('intelligence learning', docs, { provider: 'no-reranker' });
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].text, 'Artificial intelligence deep learning LLMs');
    assert.ok(ranked[0].relevance_score > ranked[1].relevance_score);
  });
});

test('LLM Provider tests', async (t) => {
  await t.test('generates structurally correct object matching schema in mock mode', async () => {
    const schema = {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'summary description' },
        score: { type: 'number', minimum: 0, maximum: 1 },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['summary', 'score', 'tags']
    };

    const res = await llmProvider.generateStructuredJson({
      systemPrompt: 'sys',
      userPrompt: 'user',
      schema,
      provider: 'mock'
    });

    assert.equal(typeof res.summary, 'string');
    assert.equal(typeof res.score, 'number');
    assert.ok(Array.isArray(res.tags));
    assert.ok(res.score >= 0 && res.score <= 1);
  });
});

test('YouTube Adapter Ingestion Pipeline tests', async (t) => {
  const originalFetch = global.fetch;
  const originalMocks = process.env.ALLOW_DEV_MOCKS;

  t.afterEach(() => {
    global.fetch = originalFetch;
    process.env.ALLOW_DEV_MOCKS = originalMocks;
  });

  await t.test('canHandle detects correct URLs', () => {
    const adapter = youtubeService.youtubeAdapter;
    assert.ok(adapter.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    assert.ok(adapter.canHandle('https://youtu.be/dQw4w9WgXcQ'));
    assert.ok(!adapter.canHandle('https://google.com'));
  });

  await t.test('full process cycle builds transcripts, chunks, embeds and persists to db', async () => {
    process.env.ALLOW_DEV_MOCKS = 'true';
    
    // Mock network fetch for transcripts
    global.fetch = async (input) => {
      const url = String(input || '');
      if (url.includes('/watch?v=')) {
        return {
          ok: true,
          text: async () => '<html><script>"captionTracks":[{"languageCode":"en","baseUrl":"https://example.com/captions"}]</script></html>',
        };
      }
      if (url.startsWith('https://example.com/captions')) {
        return {
          ok: true,
          json: async () => ({
            events: [
              { segs: [{ utf8: 'This' }, { utf8: ' is a test video about artificial intelligence and transformers. We discuss deep neural networks and machine learning.' }] }
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    // Spin up an in-memory SQLite database
    const db = new Database(':memory:');
    ensureSqliteIdealState(db);

    const adapter = youtubeService.youtubeAdapter;
    const videoUrl = 'https://www.youtube.com/watch?v=mockvid1234';
    
    // Run the complete process
    const itemId = await adapter.process(videoUrl, db, {
      chunkSize: 50,
      overlap: 10,
      embeddingProvider: 'mock',
      embeddingModel: 'bge-m3'
    });

    assert.ok(itemId);

    // Verify content_items was populated
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(itemId);
    assert.ok(item);
    assert.equal(item.external_id, 'mockvid1234');
    assert.equal(item.ingest_status, 'ready'); // Not gossip, so ready
    assert.ok(item.summary);
    assert.ok(item.topic_tags_json);

    // Verify chunks were created
    const chunks = db.prepare('SELECT * FROM content_chunks WHERE content_item_id = ? ORDER BY chunk_index ASC').all(itemId);
    assert.ok(chunks.length > 0);
    assert.ok(chunks[0].content_text);

    // Verify embeddings were created
    const embeddings = db.prepare('SELECT * FROM content_item_embeddings WHERE content_item_id = ?').all(itemId);
    assert.ok(embeddings.length > 0);
    
    // There should be 1 item-level embedding (chunk_id = null) + chunk-level embeddings
    const itemLevelEmbed = embeddings.find(e => e.chunk_id === null);
    assert.ok(itemLevelEmbed);
    
    const chunkLevelEmbeds = embeddings.filter(e => e.chunk_id !== null);
    assert.equal(chunkLevelEmbeds.length, chunks.length);

    // Verify reason was created
    const reason = db.prepare('SELECT * FROM recommendation_reasons WHERE content_id = ?').get(itemId);
    assert.ok(reason);
    assert.ok(reason.reason_text);
  });

  await t.test('filters celebrity noise and sets ingest_status = filtered', async () => {
    process.env.ALLOW_DEV_MOCKS = 'true';
    
    // Mock network fetch for gossip video
    global.fetch = async (input) => {
      const url = String(input || '');
      if (url.includes('/watch?v=')) {
        return {
          ok: true,
          text: async () => '<html><script>"captionTracks":[{"languageCode":"en","baseUrl":"https://example.com/captions"}]</script></html>',
        };
      }
      if (url.startsWith('https://example.com/captions')) {
        return {
          ok: true,
          json: async () => ({
            events: [
              { segs: [{ utf8: 'Taylor Swift dating life drama and gossip makeup breakup' }] }
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const db = new Database(':memory:');
    ensureSqliteIdealState(db);

    const adapter = youtubeService.youtubeAdapter;
    const videoUrl = 'https://www.youtube.com/watch?v=gossipvid12';
    
    const itemId = await adapter.process(videoUrl, db, {
      chunkSize: 50,
      overlap: 10,
      embeddingProvider: 'mock',
      embeddingModel: 'text-embedding-3-small'
    });

    assert.ok(itemId);

    // Verify content_items has ingest_status = 'filtered' and distraction_risk = 1.0
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(itemId);
    assert.ok(item);
    assert.equal(item.ingest_status, 'filtered');
    assert.equal(item.distraction_risk, 1.0);
  });
});
