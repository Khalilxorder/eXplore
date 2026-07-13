'use strict';

const OpenAI = require('openai');

function isUsableApiKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (/YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO/i.test(normalized)) return false;
  if (/^(?:x|y|z|null|none|undefined|test)$/i.test(normalized)) return false;
  return normalized.length >= 20;
}

const openaiApiKey = isUsableApiKey(process.env.OPENAI_API_KEY)
  ? String(process.env.OPENAI_API_KEY).trim()
  : '';
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

// Gemini configuration (reused from aiService configuration)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const geminiApiKey = isUsableApiKey(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY)
  ? String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY).trim()
  : '';

function isDevMocksEnabled() {
  return String(process.env.ALLOW_DEV_MOCKS || '').toLowerCase() === 'true';
}

/**
 * Dynamically generate a mock object matching a JSON schema
 * @param {object} schema 
 * @param {string} promptHint 
 * @returns {*}
 */
function generateMockFromSchema(schema, promptHint = '') {
  if (!schema) return {};

  const type = schema.type || 'object';

  if (type === 'object') {
    const obj = {};
    const properties = schema.properties || {};
    const required = schema.required || [];

    for (const [key, prop] of Object.entries(properties)) {
      obj[key] = generateMockFromSchema(prop, promptHint);
    }
    return obj;
  }

  if (type === 'array') {
    const itemsSchema = schema.items || { type: 'string' };
    // Generate 2 items for arrays
    return [
      generateMockFromSchema(itemsSchema, promptHint),
      generateMockFromSchema(itemsSchema, promptHint)
    ];
  }

  if (type === 'string') {
    if (schema.enum && schema.enum.length > 0) {
      return schema.enum[0];
    }
    // Contextual string overrides based on typical keys
    if (schema.description && schema.description.toLowerCase().includes('topic')) {
      return 'Artificial Intelligence';
    }
    if (schema.description && schema.description.toLowerCase().includes('reason')) {
      return 'Deep Dive: Offers highly technical insights on modern AI development.';
    }
    if (schema.description && schema.description.toLowerCase().includes('summary')) {
      return 'This is a synthesized summary analyzing the subject matter of the input content.';
    }
    return 'mock_string_value';
  }

  if (type === 'number' || type === 'integer') {
    if (schema.minimum !== undefined && schema.maximum !== undefined) {
      return (schema.minimum + schema.maximum) / 2;
    }
    return 0.8; // default mock score
  }

  if (type === 'boolean') {
    const promptLower = String(promptHint || '').toLowerCase();
    if (promptLower.includes('taylor swift') || promptLower.includes('gossip') || promptLower.includes('drama') || promptLower.includes('celebrity')) {
      return true;
    }
    return false;
  }

  return null;
}

/**
 * Clean helper to strip markdown blocks
 */
function cleanJsonPayload(text) {
  return String(text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

/**
 * Call Gemini API using fetch
 */
async function callGeminiStructured(systemPrompt, userPrompt, schema, temperature = 0.2) {
  if (!geminiApiKey) {
    throw new Error('Gemini API key is not configured');
  }

  const model = GEMINI_MODEL;
  const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent?key=${geminiApiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nUser Content:\n${userPrompt}` }]
        }
      ],
      generationConfig: {
        temperature: temperature,
        responseMimeType: 'application/json',
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API structured request failed with status ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.parse(cleanJsonPayload(rawText));
}

/**
 * Call OpenAI API using client
 */
async function callOpenAiStructured(systemPrompt, userPrompt, schema, temperature = 0.2, model = 'gpt-4o-mini') {
  if (!openai) {
    throw new Error('OpenAI client is not configured');
  }

  const response = await openai.chat.completions.create({
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: temperature,
    response_format: { type: 'json_object' }
  });

  const rawContent = response.choices[0]?.message?.content || '{}';
  return JSON.parse(cleanJsonPayload(rawContent));
}

/**
 * Generate Structured JSON response using the configured LLM provider
 * @param {object} params
 * @param {string} params.systemPrompt
 * @param {string} params.userPrompt
 * @param {object} params.schema JSON-schema for structure verification
 * @param {number} [params.temperature=0.2]
 * @param {string} [params.provider]
 * @param {string} [params.model]
 * @returns {Promise<object>} The parsed JSON object matching the schema
 */
async function generateStructuredJson({ systemPrompt, userPrompt, schema, temperature = 0.2, provider, model }) {
  const activeProvider = provider || process.env.LLM_PROVIDER || (openai ? 'openai' : geminiApiKey ? 'gemini' : 'mock');

  if (activeProvider === 'mock' || isDevMocksEnabled()) {
    return generateMockFromSchema(schema, userPrompt);
  }

  try {
    if (activeProvider === 'openai') {
      return await callOpenAiStructured(systemPrompt, userPrompt, schema, temperature, model);
    } else if (activeProvider === 'gemini') {
      return await callGeminiStructured(systemPrompt, userPrompt, schema, temperature);
    }
  } catch (error) {
    console.error(`[LlmProvider] ${activeProvider} failed: ${error.message}. Falling back to schema-based mock.`);
  }

  // Fallback to schema-based mock if provider fails
  return generateMockFromSchema(schema, userPrompt);
}

module.exports = {
  generateStructuredJson,
  generateMockFromSchema,
};
