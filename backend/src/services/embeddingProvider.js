'use strict';

const OpenAI = require('openai');

// Helper to check if API key is usable (copied from aiService pattern)
function isUsableApiKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (/YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO/i.test(normalized)) return false;
  if (/^(?:x|y|z|null|none|undefined|test)$/i.test(normalized)) return false;
  return normalized.length >= 20; // OpenAI key check
}

const openaiApiKey = isUsableApiKey(process.env.OPENAI_API_KEY)
  ? String(process.env.OPENAI_API_KEY).trim()
  : '';

const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

function isDevMocksEnabled() {
  return String(process.env.ALLOW_DEV_MOCKS || '').toLowerCase() === 'true';
}

function getMockEmbedding(dimension = 1536) {
  // Generate deterministic mock embedding based on length/modulo to avoid completely random drift in tests
  const values = new Array(dimension).fill(0).map((_, index) => {
    return index % 2 === 0 ? 0.25 : -0.25;
  });
  // Normalize vector
  const norm = Math.sqrt(values.reduce((sum, val) => sum + val * val, 0)) || 1;
  return values.map((val) => val / norm);
}

/**
 * Generate embedding for text
 * @param {string} text 
 * @param {object} options 
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text, options = {}) {
  const result = await generateEmbeddingWithMetadata(text, options);
  return result.values;
}

/**
 * Generate embedding and return metadata
 * @param {string} text 
 * @param {object} options 
 * @returns {Promise<{values: number[], provider: string, model: string, error: string|null}>}
 */
async function generateEmbeddingWithMetadata(text, options = {}) {
  const provider = options.provider || process.env.EMBEDDING_PROVIDER || 'mock';
  const model = options.model || (provider === 'openai' ? 'text-embedding-3-small' : 'bge-m3');

  if (provider === 'mock' || isDevMocksEnabled() || (!openai && provider === 'openai')) {
    const dim = model === 'bge-m3' || model.includes('bge') ? 1024 : 1536;
    return {
      values: getMockEmbedding(dim),
      provider: 'mock',
      model: model,
      error: !openai && provider === 'openai' ? 'OpenAI key not configured' : null,
    };
  }

  if (provider === 'openai') {
    try {
      const res = await openai.embeddings.create({
        model: model,
        input: String(text || '').slice(0, 8000),
      });
      const rawVector = res.data[0]?.embedding || [];
      // Normalize vector
      const norm = Math.sqrt(rawVector.reduce((sum, val) => sum + val * val, 0)) || 1;
      const values = rawVector.map((val) => val / norm);
      return {
        values,
        provider: 'openai',
        model: model,
        error: null,
      };
    } catch (error) {
      console.error(`[EmbeddingProvider] OpenAI embedding error: ${error.message}`);
      const dim = model === 'bge-m3' ? 1024 : 1536;
      return {
        values: getMockEmbedding(dim),
        provider: 'mock',
        model: 'mock-fallback',
        error: error.message,
      };
    }
  }

  // BGE-M3 (or any custom embedding provider) remote API support
  if (provider === 'bge_m3' || provider === 'bge') {
    // If a remote BGE embedding service URL is configured, call it
    const apiUrl = process.env.BGE_EMBEDDING_API_URL;
    if (apiUrl) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.BGE_API_KEY ? { 'Authorization': `Bearer ${process.env.BGE_API_KEY}` } : {}),
          },
          body: JSON.stringify({ text: String(text || '') }),
        });

        if (response.ok) {
          const data = await response.json();
          const rawVector = data.embedding || data.embeddings?.[0] || [];
          const norm = Math.sqrt(rawVector.reduce((sum, val) => sum + val * val, 0)) || 1;
          const values = rawVector.map((val) => val / norm);
          return {
            values,
            provider: 'bge_m3',
            model: model,
            error: null,
          };
        } else {
          throw new Error(`HTTP error ${response.status}`);
        }
      } catch (error) {
        console.error(`[EmbeddingProvider] BGE embedding remote API error: ${error.message}`);
      }
    }

    // Default BGE-M3 mock
    return {
      values: getMockEmbedding(1024),
      provider: 'mock',
      model: 'bge-m3',
      error: 'BGE API not configured or failed, fell back to mock',
    };
  }

  // Fallback
  return {
    values: getMockEmbedding(1536),
    provider: 'mock',
    model: 'fallback',
    error: `Unknown provider: ${provider}`,
  };
}

module.exports = {
  generateEmbedding,
  generateEmbeddingWithMetadata,
  getMockEmbedding,
};
