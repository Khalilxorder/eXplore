const aiService = require('../../services/aiService');
const valueHierarchy = require('./valueHierarchySync');

function clampScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(10, numeric));
}

async function analyzeComments(commentsArray) {
  if (!Array.isArray(commentsArray) || commentsArray.length === 0) {
    return { shock: 0, confusion: 0, praise: 0, intelligence: 0, hookAbridged: 'Unknown' };
  }

  try {
    const response = await aiService.generateStructuredJson({
      providerPreference: 'gemini',
      temperature: 0.15,
      systemPrompt: `
You are an elite psychological analyst for an anomaly detection engine.

Return valid JSON only:
{
  "shock": number,
  "confusion": number,
  "praise": number,
  "intelligence": number,
  "hookAbridged": string
}

Rules:
- Scores must be between 0 and 10.
- hookAbridged must be 2 to 8 words.
      `.trim(),
      userPrompt: `
Analyze the following TikTok or Instagram comments.

Comments:
${commentsArray.map((comment) => `- ${comment}`).join('\n')}
      `.trim(),
    });

    return {
      shock: clampScore(response?.shock),
      confusion: clampScore(response?.confusion),
      praise: clampScore(response?.praise),
      intelligence: clampScore(response?.intelligence),
      hookAbridged: String(response?.hookAbridged || 'Unknown').trim().slice(0, 80) || 'Unknown',
    };
  } catch (error) {
    console.error('Gemini Sentiment Analysis Error:', error);
    return { shock: 0, confusion: 0, praise: 0, intelligence: 0, hookAbridged: 'Error analyzing' };
  }
}

async function calculateFinalAnomalyScore(baseScore, sentimentData, options = {}) {
  let finalScore = Number(baseScore || 0) * 0.5;

  const weirdnessAvg = ((Number(sentimentData?.shock) || 0) + (Number(sentimentData?.confusion) || 0)) / 2;
  finalScore += weirdnessAvg * 0.3;

  if ((Number(sentimentData?.intelligence) || 0) >= 8) {
    finalScore += 2;
  } else if ((Number(sentimentData?.intelligence) || 0) <= 2) {
    finalScore -= 3;
  }

  const alignmentScore = options.db
    ? await valueHierarchy.evaluateContentAgainstHierarchy(
      options.db,
      options.userId || 'guest',
      sentimentData?.hookAbridged || '',
    )
    : 1.0;

  const alignmentMultiplier = alignmentScore / 5;
  finalScore *= alignmentMultiplier;

  return {
    finalScore: Math.min(10, Math.max(0, finalScore)),
    alignmentScore,
  };
}

module.exports = {
  analyzeComments,
  calculateFinalAnomalyScore,
};
