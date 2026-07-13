'use strict';

function isDevMocksEnabled() {
  return String(process.env.ALLOW_DEV_MOCKS || '').toLowerCase() === 'true';
}

/**
 * Tokenize a string into unique lowercase words, filtering out short/empty strings
 * @param {string} text 
 * @returns {Set<string>}
 */
function getTokens(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);
  return new Set(normalized);
}

/**
 * Fallback overlap scorer (Jaccard similarity style)
 * @param {string} query 
 * @param {string} docText 
 * @returns {number} score between 0 and 1
 */
function computeOverlapScore(query, docText) {
  const queryTokens = getTokens(query);
  const docTokens = getTokens(docText);
  if (queryTokens.size === 0 || docTokens.size === 0) {
    return 0;
  }
  
  let intersectionCount = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token)) {
      intersectionCount++;
    }
  }
  
  // Calculate simple overlap
  return intersectionCount / Math.max(queryTokens.size, 1);
}

/**
 * Rerank documents based on a query
 * @param {string} query The search query
 * @param {Array<object>} documents List of documents to rank. Each document should have content/text fields.
 * @param {object} options Options including provider preference, document text extractor, etc.
 * @returns {Promise<Array<object>>} The documents sorted by relevance_score descending, with relevance_score attached.
 */
async function rerank(query, documents, options = {}) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return [];
  }

  const provider = options.provider || process.env.RERANKER_PROVIDER || 'no-reranker';
  const model = options.model || 'BAAI/bge-reranker-v2-m3';
  
  // Helper to extract text from document
  const getText = options.getText || ((doc) => {
    return doc.text || doc.content || doc.body || doc.title || doc.description || '';
  });

  // If "no-reranker" or mock/dev mocks enabled, use deterministic fallback
  if (provider === 'no-reranker' || provider === 'none' || isDevMocksEnabled()) {
    return documents.map((doc) => {
      const docText = getText(doc);
      const score = computeOverlapScore(query, docText);
      return {
        ...doc,
        relevance_score: score,
      };
    }).sort((a, b) => b.relevance_score - a.relevance_score);
  }

  // If using BAAI/bge-reranker-v2-m3, check for remote reranker API URL
  if (provider === 'bge-reranker' || provider === 'bge' || model.includes('bge-reranker')) {
    const apiUrl = process.env.RERANKER_API_URL;
    if (apiUrl) {
      try {
        const payload = {
          query,
          documents: documents.map(doc => getText(doc))
        };
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.RERANKER_API_KEY ? { 'Authorization': `Bearer ${process.env.RERANKER_API_KEY}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = await response.json();
          // Assume API returns an array of scores corresponding to each document, e.g. [0.92, 0.45, ...]
          // or an array of objects like [{ index, score }]
          const scores = data.scores || data.results || [];
          
          return documents.map((doc, idx) => {
            let score = 0;
            if (typeof scores[idx] === 'number') {
              score = scores[idx];
            } else if (scores[idx] && typeof scores[idx].score === 'number') {
              score = scores[idx].score;
            } else {
              // try to match index if results are sorted
              const match = scores.find(s => s.index === idx);
              if (match && typeof match.score === 'number') {
                score = match.score;
              }
            }
            return {
              ...doc,
              relevance_score: score,
            };
          }).sort((a, b) => b.relevance_score - a.relevance_score);
        } else {
          throw new Error(`HTTP error ${response.status}`);
        }
      } catch (error) {
        console.error(`[RerankerProvider] Remote reranker failed: ${error.message}. Falling back to keyword overlap.`);
      }
    }
  }

  // Default fallback (no-reranker behavior)
  return documents.map((doc) => {
    const docText = getText(doc);
    const score = computeOverlapScore(query, docText);
    return {
      ...doc,
      relevance_score: score,
    };
  }).sort((a, b) => b.relevance_score - a.relevance_score);
}

module.exports = {
  rerank,
  computeOverlapScore,
};
