const EVENT_PRIORITY_STORAGE_KEY = 'explore-event-only-priorities-v1';

export const EVENT_PRIORITY_LEVELS = [
  { key: 'watch', label: 'Watch' },
  { key: 'important', label: 'Important' },
  { key: 'direct', label: 'Direct' },
];

const EVENT_PRIORITY_KEYS = new Set(EVENT_PRIORITY_LEVELS.map((level) => level.key));
const DIRECT_NEWS_COMPANY_IDS = new Set(['anthropic', 'openai', 'google', 'xai']);
const PRIORITY_RADAR_COMPANY_MATCHERS = [
  {
    companyId: 'anthropic',
    label: 'Anthropic',
    patterns: [/\banthropic\b/i, /\bclaude\b/i, /\bfable\b/i, /\bmythos\b/i, /\bopus\b/i, /\bsonnet\b/i, /\bhaiku\b/i],
  },
  {
    companyId: 'openai',
    label: 'OpenAI',
    patterns: [/\bopenai\b/i, /\bchatgpt\b/i, /\bgpt[-\s]?\w*/i, /\bsora\b/i, /\bcodex\b/i],
  },
  {
    companyId: 'google',
    label: 'Google / Gemini / DeepMind',
    patterns: [/\bgoogle\b/i, /\bgemini\b/i, /\bdeepmind\b/i, /\bgemma\b/i, /\bveo\b/i, /\bimagen\b/i],
  },
  {
    companyId: 'xai',
    label: 'xAI',
    patterns: [/\bx\.ai\b/i, /\bxai\b/i, /\bgrok\b/i],
  },
  {
    companyId: 'meta',
    label: 'Meta / Llama',
    patterns: [/\bmeta\b/i, /\bllama\b/i],
  },
  {
    companyId: 'microsoft',
    label: 'Microsoft / Copilot',
    patterns: [/\bmicrosoft\b/i, /\bcopilot\b/i, /\bazure\b/i, /\bphi[-\s]?\w*/i],
  },
  {
    companyId: 'amazon',
    label: 'Amazon / AWS',
    patterns: [/\bamazon\b/i, /\baws\b/i, /\bbedrock\b/i, /\bnova\b/i],
  },
  {
    companyId: 'hugging_face',
    label: 'Hugging Face',
    patterns: [/\bhugging\s*face\b/i, /\bhuggingface\b/i],
  },
  {
    companyId: 'mistral',
    label: 'Mistral AI',
    patterns: [/\bmistral\b/i, /\bmixtral\b/i, /\bministral\b/i],
  },
];

function normalizeDirectSourceId(value = '') {
  return normalizeComparable(value)
    .replace(/[^a-z0-9_:]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'amid',
  'among',
  'and',
  'announced',
  'are',
  'around',
  'been',
  'being',
  'but',
  'can',
  'could',
  'from',
  'has',
  'have',
  'into',
  'latest',
  'more',
  'new',
  'news',
  'now',
  'over',
  'said',
  'says',
  'that',
  'the',
  'their',
  'this',
  'through',
  'today',
  'update',
  'with',
]);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase();
}

function getUrlHost(value = '') {
  try {
    return new URL(String(value || '').trim()).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function buildSourceNeedles(source = {}) {
  const label = normalizeComparable(source.label);
  const host = getUrlHost(source.url || source.feedUrl);
  const id = normalizeComparable(source.id).replace(/[-_]+/g, ' ');
  return [...new Set([label, host, id].filter((entry) => entry.length >= 3))];
}

function matchSourceMap(item = {}, sourceMap = null) {
  const lanes = Array.isArray(sourceMap?.lanes) ? sourceMap.lanes : [];
  if (!lanes.length) {
    return null;
  }

  const itemHost = getUrlHost(item?.url || item?.alert?.url);
  const haystack = normalizeComparable([
    item?.title,
    item?.summary,
    item?.reason,
    item?.whyShown,
    item?.source,
    item?.publisher,
    item?.feedSectionTitle,
    itemHost,
  ].filter(Boolean).join(' '));

  let best = null;
  for (const lane of lanes) {
    for (const source of Array.isArray(lane.sources) ? lane.sources : []) {
      const needles = buildSourceNeedles(source);
      const host = getUrlHost(source.url || source.feedUrl);
      const hostMatch = Boolean(host && itemHost && host === itemHost);
      const textMatch = needles.some((needle) => haystack.includes(needle));
      if (!hostMatch && !textMatch) {
        continue;
      }

      const score = (hostMatch ? 30 : 0)
        + (source.priority === 'critical' ? 16 : source.priority === 'high' ? 10 : 4)
        + Math.max(0, 8 - Number(lane.priority || 9));
      if (!best || score > best.score) {
        best = {
          lane: {
            id: lane.id,
            label: lane.label,
            priority: Number(lane.priority || 9),
          },
          source: {
            id: source.id,
            label: source.label,
            priority: source.priority || '',
            sourceType: source.sourceType || '',
            monitorType: source.monitorType || '',
            url: source.url || source.feedUrl || '',
          },
          score,
        };
      }
    }
  }

  return best;
}

function mapLaneToEventType(laneMatch, fallbackType) {
  const laneId = laneMatch?.lane?.id || '';
  if (laneId === 'war') {
    return {
      key: 'risk',
      label: 'War',
      cue: '!',
      meaning: 'Risk Level Changed',
    };
  }
  if (laneId === 'markets') {
    return {
      key: 'market',
      label: 'Markets',
      cue: '$',
      meaning: 'Market Power Shifted',
    };
  }
  if (laneId === 'art_meaning') {
    return {
      key: 'meaning',
      label: 'Meaning',
      cue: 'M',
      meaning: 'Meaning Signal Found',
    };
  }
  if (laneId === 'personal_opportunities') {
    return {
      key: 'opportunity',
      label: 'Opportunity',
      cue: 'O',
      meaning: 'Opportunity Window Opened',
    };
  }

  return fallbackType;
}

function hashText(value = '') {
  return normalizeText(value).split('').reduce((hash, char) => {
    return ((hash << 5) - hash) + char.charCodeAt(0);
  }, 0);
}

function toThreeWords(value, fallback = 'Signal Worth Watching') {
  const words = normalizeText(value)
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 3);

  const fallbackWords = fallback.split(/\s+/).slice(0, 3);
  while (words.length < 3) {
    words.push(fallbackWords[words.length] || 'Signal');
  }

  return words
    .slice(0, 3)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function getEventType(item = {}) {
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.whyShown || ''} ${item?.source || ''}`.toLowerCase();

  if (/\b(price|pricing|paid|subscription|available|access|api|sdk|developer|beta|preview|ga|general availability)\b/.test(text)) {
    return {
      key: 'access',
      label: 'Access',
      cue: 'API',
      meaning: 'Access Window Opened',
    };
  }

  if (/\b(release|released|launch|launched|rollout|rolled out|version|model|gpt|claude|fable|mythos|gemini|llama|grok|mistral|qwen|deepseek)\b/.test(text)) {
    return {
      key: 'release',
      label: 'Release',
      cue: 'R',
      meaning: 'Capability Just Changed',
    };
  }

  if (/\b(open source|open-source|weights|github|repo|code|plugin|extension|tool|agent|app)\b/.test(text)) {
    return {
      key: 'tool',
      label: 'Tool',
      cue: 'T',
      meaning: 'Useful Tool Appeared',
    };
  }

  if (/\b(policy|regulation|regulated|law|lawsuit|ban|court|government|election|minister|parliament)\b/.test(text)) {
    return {
      key: 'policy',
      label: 'Policy',
      cue: 'P',
      meaning: 'Policy Risk Shifted',
    };
  }

  if (/\b(war|iran|jordan|conflict|attack|escalation|border|military|security|outage|breach|vulnerability)\b/.test(text)) {
    return {
      key: 'risk',
      label: 'Risk',
      cue: '!',
      meaning: 'Risk Level Changed',
    };
  }

  if (/\b(funding|acquisition|acquires|merger|market|shares|stock|valuation|partnership|deal)\b/.test(text)) {
    return {
      key: 'market',
      label: 'Market',
      cue: '$',
      meaning: 'Market Power Shifted',
    };
  }

  if (item?.hasTranscript || /transcript|interview|podcast|youtube|video/.test(text)) {
    return {
      key: 'transcript',
      label: 'Transcript',
      cue: 'Q',
      meaning: 'Leader Signal Surfaced',
    };
  }

  return {
    key: 'signal',
    label: 'Signal',
    cue: 'S',
    meaning: toThreeWords(`${item?.reason || ''} ${item?.summary || ''} ${item?.title || ''}`),
  };
}

export function getEventPriorityStorageKey(item = {}) {
  const seed = normalizeText(`${item?.url || ''}|${item?.id || ''}|${item?.source || ''}|${item?.title || ''}`).toLowerCase();
  return `event:${Math.abs(hashText(seed)).toString(36)}`;
}

export function loadEventPriorityMap() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(EVENT_PRIORITY_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => EVENT_PRIORITY_KEYS.has(value))
    );
  } catch {
    return {};
  }
}

export function saveEventPriorityLevel(item = {}, levelKey = '', existingMap = loadEventPriorityMap()) {
  if (typeof window === 'undefined') {
    return existingMap || {};
  }

  const storageKey = getEventPriorityStorageKey(item);
  const nextMap = { ...(existingMap || {}) };
  if (EVENT_PRIORITY_KEYS.has(levelKey)) {
    nextMap[storageKey] = levelKey;
  }

  const entries = Object.entries(nextMap).slice(-100);
  const cappedMap = Object.fromEntries(entries);
  window.localStorage.setItem(EVENT_PRIORITY_STORAGE_KEY, JSON.stringify(cappedMap));
  return cappedMap;
}

export function getEventPriorityLevel(item = {}, priorityMap = {}) {
  const levelKey = priorityMap[getEventPriorityStorageKey(item)];
  return EVENT_PRIORITY_LEVELS.find((level) => level.key === levelKey) || null;
}

export function buildEventOnlyIntelligence(item = {}, priorityMap = {}, sourceMap = null) {
  const sourceMapMatch = matchSourceMap(item, sourceMap);
  const eventType = mapLaneToEventType(sourceMapMatch, getEventType(item));
  const title = normalizeText(item?.title || item?.headline || item?.name || eventType.label);
  const source = normalizeText(sourceMapMatch?.source?.label || item?.source || item?.publisher || item?.feedSectionTitle || 'Latest news');
  const priority = getEventPriorityLevel(item, priorityMap);

  return {
    eventType,
    title: title || `${eventType.label} event`,
    meaning: toThreeWords(item?.threeWordMeaning || item?.meaning || eventType.meaning, eventType.meaning),
    source,
    priority,
    storageKey: getEventPriorityStorageKey(item),
    sourceMapMatch,
  };
}

export function getEventOnlyPriorityScore(item = {}, priorityMap = {}, sourceMap = null) {
  const event = buildEventOnlyIntelligence(item, priorityMap, sourceMap);
  const explicitPriority = event.priority?.key === 'direct'
    ? 10000
    : event.priority?.key === 'important'
      ? 5000
      : event.priority?.key === 'watch'
        ? 1000
        : 0;
  const laneBoost = event.sourceMapMatch
    ? Math.max(0, 500 - (Number(event.sourceMapMatch.lane.priority || 9) * 55))
    : 0;
  const sourceBoost = Number(event.sourceMapMatch?.score || 0) * 3;
  return explicitPriority + laneBoost + sourceBoost;
}

export function inferPriorityRadarCompanyFromEvent(item = {}, event = {}) {
  const source = event?.sourceMapMatch?.source || {};
  const text = normalizeComparable([
    source.id,
    source.label,
    source.url,
    item?.title,
    item?.summary,
    item?.reason,
    item?.whyShown,
    item?.source,
    item?.publisher,
    item?.url,
    item?.alert?.url,
  ].filter(Boolean).join(' ')).replace(/[-_]+/g, ' ');

  for (const matcher of PRIORITY_RADAR_COMPANY_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(text))) {
      return {
        companyId: matcher.companyId,
        directSourceId: matcher.companyId,
        label: matcher.label,
        supportsDirectNews: DIRECT_NEWS_COMPANY_IDS.has(matcher.companyId),
      };
    }
  }

  if (source.id) {
    return {
      companyId: '',
      directSourceId: normalizeDirectSourceId(source.id),
      label: source.label || source.id,
      supportsDirectNews: true,
    };
  }

  return null;
}
