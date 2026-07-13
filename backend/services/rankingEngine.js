// Ranking Engine — Computes personalized content scores
// Implements the ranking formula from the eXplore project plan Section G

/**
 * Calculate the final ranking score for a content item relative to a user.
 * 
 * Formula: FinalScore = (w1 × Relevance) + (w2 × Depth) + (w3 × Rarity) + (w4 × Trust) + (w5 × Freshness) − (Penalty)
 * 
 * Default weights: Relevance=0.35, Depth=0.25, Rarity=0.20, Trust=0.10, Freshness=0.10
 */
exports.rankItem = (item, userPrefs = {}) => {
  const weights = {
    relevance: 0.35,
    depth: 0.25,
    rarity: 0.20,
    trust: 0.10,
    freshness: 0.10,
  };

  // Adjust weights based on user preferences (0-1 sliders)
  if (userPrefs.depth_pref != null) {
    weights.depth = 0.15 + (userPrefs.depth_pref * 0.20);  // 0.15 - 0.35
  }
  if (userPrefs.rarity_pref != null) {
    weights.rarity = 0.10 + (userPrefs.rarity_pref * 0.20); // 0.10 - 0.30
  }

  // Normalize weights to sum to 1
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  for (const k in weights) weights[k] /= total;

  const scores = item.scores || {};

  // Calculate raw score
  let score = 0;
  score += weights.relevance * (scores.relevance ?? 0.5);
  score += weights.depth * (scores.depth ?? item.depth_score ?? 0.5);
  score += weights.rarity * (scores.rarity ?? item.rarity_score ?? 0.5);
  score += weights.trust * (item.trust_score ?? 0.5);
  score += weights.freshness * (scores.freshness ?? item.freshness_score ?? 0.5);

  // Penalty: clickbait reduces score
  const clickbaitPenalty = (scores.clickbait ?? item.clickbait_score ?? 0) * 0.15;
  score -= clickbaitPenalty;

  // Bonus: timeless content gets a small boost
  const timelessBonus = (scores.timeless ?? item.timeless_score ?? 0) * 0.05;
  score += timelessBonus;

  return Math.max(0, Math.min(1, score));
};

/**
 * Rank and sort an array of content items for a user.
 * Returns items sorted by descending final score.
 */
exports.rankItems = (items, userPrefs = {}) => {
  return items
    .map(item => ({
      ...item,
      finalScore: exports.rankItem(item, userPrefs),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
};

/**
 * Categorize items into feed sections based on their attributes.
 */
exports.categorizeForFeed = (items, userPrefs = {}) => {
  const ranked = exports.rankItems(items, userPrefs);

  const sections = {
    newImportant: [],
    oldGems: [],
    deepDives: [],
    becauseYouCare: [],
  };

  for (const item of ranked) {
    const scores = item.scores || {};
    const freshness = scores.freshness || item.freshness_score || 0;
    const rarity = scores.rarity || item.rarity_score || 0;
    const depth = scores.depth || item.depth_score || 0;
    const timeless = scores.timeless || item.timeless_score || 0;

    if (freshness > 0.7) {
      sections.newImportant.push(item);
    } else if (rarity > 0.7 || timeless > 0.7) {
      sections.oldGems.push(item);
    } else if (depth > 0.8) {
      sections.deepDives.push(item);
    } else {
      sections.becauseYouCare.push(item);
    }
  }

  return sections;
};

/**
 * Generate a human-readable reason string.
 */
exports.generateReason = (item) => {
  const scores = item.scores || {};
  const rarity = scores.rarity || item.rarity_score || 0;
  const depth = scores.depth || item.depth_score || 0;
  const timeless = scores.timeless || item.timeless_score || 0;
  const freshness = scores.freshness || item.freshness_score || 0;

  if (item.reason) return item.reason;

  if (rarity > 0.8) return `Rare: only ${item.viewCount?.toLocaleString() || 'few'} views`;
  if (timeless > 0.8) return 'Timeless: content that remains valuable over decades';
  if (depth > 0.85) return `Deep Dive: ${Math.floor((item.duration_seconds || item.duration || 0) / 60)} minutes of thorough analysis`;
  if (freshness > 0.8) return 'New: recently published with timely insights';
  
  const topics = item.topics || item.topic_tags || [];
  if (topics.length > 0) return `Matches your interest in ${topics[0]}`;
  return 'Recommended based on your profile';
};
