'use client';

import { useEffect, useState } from 'react';
import {
  fetchNotificationPreferences,
  fetchTemplate,
  refineTemplate,
  restoreTemplateVersion,
  saveTemplateWorkspace,
  updateNotificationPreferences,
  fetchNewsPaths,
} from '../lib/api';
import { useAuth } from './AuthProvider';
import { loadPriorityRadarSettings, savePriorityRadarSettings } from '../lib/alertRadar';
import { buildOperatingBrief, parseInterestIntent } from '../lib/intelligenceProfile';
import {
  VIDEO_LIBRARY_CATEGORY_OPTIONS,
  buildVideoLibrarySearchProfiles,
  detectVideoCategoryKeysFromText,
  detectVideoCreatorKeysFromText,
  getVideoLibraryCategoryLabel,
  getVideoLibraryCreatorLabel,
  normalizeVideoCategoryKeys,
  normalizeVideoCreatorKeys,
  normalizeVideoLibraryPreferences,
} from '../data/videoLibrary';

const DRAFT_KEYS = {
  questions: 'explore-template-draft-questions',
  style: 'explore-template-draft-style',
  note: 'explore-template-draft-note',
  topics: 'explore-template-draft-topics',
  avoid: 'explore-template-draft-avoid',
  companies: 'explore-template-draft-companies',
  people: 'explore-template-draft-people',
  leaderCountry: 'explore-template-draft-leader-country',
  leaderName: 'explore-template-draft-leader-name',
  alertStyle: 'explore-template-draft-alert-style',
  sourcePrefs: 'explore-template-draft-source-prefs',
  videoCreators: 'explore-template-draft-video-creators',
  videoCategories: 'explore-template-draft-video-categories',
  inlinePlayback: 'explore-template-draft-inline-playback',
};

const RELEASE_WATCH_COMPANIES = [
  { key: 'anthropic', label: 'Anthropic', patterns: [/\banthropic\b/i, /\bclaude\b/i, /\bmythos\b/i, /\bsonnet\b/i, /\bopus\b/i, /\bhaiku\b/i] },
  { key: 'openai', label: 'OpenAI', patterns: [/\bopenai\b/i, /\bgpt\b/i, /\bchatgpt\b/i, /\bo[1-9]\b/i, /\bsora\b/i] },
  { key: 'google', label: 'Gemini / DeepMind', patterns: [/\bgemini\b/i, /\bdeepmind\b/i, /\bgoogle\s+ai\b/i, /\bveo\b/i, /\bimagen\b/i] },
  { key: 'meta', label: 'Meta / Llama', patterns: [/\bmeta\b/i, /\bllama\b/i] },
  { key: 'xai', label: 'Grok / xAI', patterns: [/\bgrok\b/i, /\bxai\b/i, /\bx\.ai\b/i] },
  { key: 'microsoft', label: 'Microsoft / Copilot', patterns: [/\bmicrosoft\b/i, /\bcopilot\b/i, /\bphi\b/i] },
];

const DEFAULT_WORKSPACE_MEMORY = {
  priorityTopics: ['AI releases', 'AI tools I can use now', 'Deep Science & DNA breakthroughs', 'Iran / regional risk', 'Mohammed bin Rashid leadership', 'Dario Amodei writings and articles', 'Mohammed bin Rashid videos and leadership', 'Sheikh Mohammed bin Rashid Al Maktoum', 'Dario Amodei'],
  avoidTopics: ['Celebrity AI chatter', 'Hype', 'Repeated context', 'Opinion without new info'],
  trackedCompanies: ['anthropic', 'openai', 'google', 'meta', 'xai'],
  peopleOfInterest: ['Sheikh Mohammed bin Rashid Al Maktoum | Dubai leader; UAE Prime Minister; official statement; leadership; personality; governance; innovation', 'Dario Amodei'],
  videoLibrary: {
    creators: ['mohammed-bin-rashid', 'dario-amodei', 'jordan-peterson', 'steve-jobs', 'niles-hollowell-dhar'],
    categories: VIDEO_LIBRARY_CATEGORY_OPTIONS.map((option) => option.key),
    inlinePlayback: true,
  },
  sourcePreferences: {
    officialFirst: true,
    written: true,
    socialVideo: true,
    socialPhoto: false,
    trustedSourcesOnly: true,
  },
  alertStyle: 'strict',
};

const ALERT_STYLE_OPTIONS = [
  { key: 'strict', label: 'Strict', description: 'Only the sharpest official signals should interrupt me.' },
  { key: 'balanced', label: 'Balanced', description: 'Keep important updates, but stay selective.' },
  { key: 'broad', label: 'Broad', description: 'Let more relevant updates through into the live system.' },
];

const SOURCE_PREFERENCE_OPTIONS = [
  { key: 'officialFirst', label: 'Official sources first' },
  { key: 'written', label: 'Written reporting' },
  { key: 'socialVideo', label: 'Social video' },
  { key: 'socialPhoto', label: 'Social photo' },
  { key: 'trustedSourcesOnly', label: 'Trusted sources only' },
];

const QUICK_RULE_PACKS = [
  {
    id: 'simple-ai-iran',
    label: 'Simple AI + Iran pack',
    description: 'Seed the document with high-signal AI release and regional-risk questions.',
    questions: [
      'Which Anthropic, OpenAI, Gemini / DeepMind, or Grok releases change what I can use right now?',
      'Which official AI launches matter enough to notify me right away?',
      'Which Iran / Qatar or nearby regional escalations change safety, access, money, or decisions?',
    ],
    styles: [
      'Keep summaries short and direct.',
      'Lead with what changed and why it matters.',
      'Ignore fluff, hype, celebrity chatter, and repeated context.',
    ],
  },
  {
    id: 'ai-release-focus',
    label: 'AI release focus',
    description: 'Push the document toward official model, tool, and API releases.',
    questions: [
      'Which official AI releases actually change what I can use or build with right now?',
      'Which Anthropic, OpenAI, Gemini / DeepMind, Meta, or Grok updates are real product shifts instead of noise?',
      'Which new AI tools or APIs just became available that I should know about?',
    ],
    styles: [
      'Prefer official release facts over commentary.',
      'Name the company and the concrete capability change early.',
      'If a new model or tool is usable today, say so clearly at the start.',
    ],
  },
  {
    id: 'regional-risk-focus',
    label: 'Regional risk focus',
    description: 'Keep the regional side focused on meaningful Iran / nearby escalation.',
    questions: [
      'Which Iran / Qatar or nearby regional developments raise real risk instead of routine background noise?',
      'Which regional escalations affect safety, access, money, travel, or infrastructure?',
    ],
    styles: [
      'Call out threat level clearly when regional risk rises.',
      'Cut repeated war background unless it changes the situation.',
    ],
  },
];

const AI_PROMPT_PRESETS = [
  {
    id: 'release-watch',
    label: 'Focus on releases',
    text: 'Focus on official releases from Anthropic, OpenAI, Gemini / DeepMind, and Grok / xAI. Remove broader AI chatter unless it changes what I can actually use.',
  },
  {
    id: 'ignore-fluff',
    label: 'Ignore fluff',
    text: 'Ignore hype, celebrity AI gossip, vague trend pieces, and repeated context. Keep only meaningful updates.',
  },
  {
    id: 'shorter',
    label: 'Make it shorter',
    text: 'Rewrite the style so summaries are shorter, plainer, and more direct. Lead with the takeaway and why it matters.',
  },
  {
    id: 'regional-risk',
    label: 'Tighten regional risk',
    text: 'Keep Iran / regional risk coverage, but only when it affects safety, access, escalation level, or practical decisions.',
  },
];

function formatTimestamp(value) {
  if (!value) {
    return 'Just now';
  }

  try {
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
}

function renderChipItems(items = [], { emptyLabel, toneClass = 'active', limit = 4 } = {}) {
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  if (!normalizedItems.length) {
    return (
      <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
        {emptyLabel}
      </span>
    );
  }

  return normalizedItems.slice(0, limit).map((item) => (
    <span key={item} className={`chip ${toneClass}`.trim()}>
      {item}
    </span>
  ));
}

function toDocumentText(lines = []) {
  return lines.map((line) => `- ${line}`).join('\n');
}

function parseDocumentText(value = '') {
  return String(value || '')
    .split(/\r?\n/g)
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function mergeDocumentText(currentValue = '', additions = []) {
  const existing = parseDocumentText(currentValue);
  const seen = new Set(existing.map((line) => line.toLowerCase()));
  const merged = [...existing];

  for (const line of additions) {
    const normalized = String(line || '').trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalized);
  }

  return toDocumentText(merged);
}

function detectReleaseWatchCompanies(...values) {
  const text = values.join(' ').toLowerCase();
  return RELEASE_WATCH_COMPANIES.filter((company) => (
    company.patterns.some((pattern) => pattern.test(text))
  ));
}

function hasRegionalRiskFocus(...values) {
  return /\biran\b|\bqatar\b|\bregional\b|\bescalat/i.test(values.join(' '));
}

function hasAntiFluffRule(...values) {
  return /\bfluff\b|\bhype\b|\bfiller\b|\bnoise\b|\bgossip\b/i.test(values.join(' '));
}

function hasShortSummaryRule(...values) {
  return /\bshort\b|\bshorter\b|\bcompact\b|\bplain\b|\bdirect\b/i.test(values.join(' '));
}

function hasAiReleaseIntent(...values) {
  return /\b(ai|release|releases|model|tool|api|anthropic|openai|gemini|deepmind|grok|xai|x\.ai|claude|chatgpt|gpt)\b/i.test(values.join(' '));
}

function normalizeTrackedCompanies(companies = []) {
  const normalized = [];

  for (const entry of Array.isArray(companies) ? companies : []) {
    const key = String(entry || '').trim().toLowerCase();
    if (!key || normalized.includes(key) || !RELEASE_WATCH_COMPANIES.some((company) => company.key === key)) {
      continue;
    }
    normalized.push(key);
  }

  return normalized.length ? normalized : DEFAULT_WORKSPACE_MEMORY.trackedCompanies;
}

function normalizePeopleOfInterest(people = []) {
  const normalized = [];

  for (const entry of Array.isArray(people) ? people : []) {
    const label = String(entry || '').trim();
    if (!label) {
      continue;
    }

    const key = label.toLowerCase();
    if (normalized.some((item) => item.toLowerCase() === key)) {
      continue;
    }

    normalized.push(label);
  }

  return normalized;
}

function normalizeWorkspaceMemory(memory = {}) {
  const sourcePreferences = memory?.sourcePreferences && typeof memory.sourcePreferences === 'object'
    ? memory.sourcePreferences
    : {};
  const videoLibrary = normalizeVideoLibraryPreferences(
    memory?.videoLibrary,
    DEFAULT_WORKSPACE_MEMORY.videoLibrary,
  );

  return {
    priorityTopics: parseDocumentText(toDocumentText(memory?.priorityTopics || DEFAULT_WORKSPACE_MEMORY.priorityTopics)),
    avoidTopics: parseDocumentText(toDocumentText(memory?.avoidTopics || DEFAULT_WORKSPACE_MEMORY.avoidTopics)),
    trackedCompanies: normalizeTrackedCompanies(memory?.trackedCompanies || DEFAULT_WORKSPACE_MEMORY.trackedCompanies),
    peopleOfInterest: normalizePeopleOfInterest(memory?.peopleOfInterest || DEFAULT_WORKSPACE_MEMORY.peopleOfInterest),
    videoLibrary,
    sourcePreferences: {
      officialFirst: sourcePreferences.officialFirst !== false,
      written: sourcePreferences.written !== false,
      socialVideo: sourcePreferences.socialVideo !== false,
      socialPhoto: Boolean(sourcePreferences.socialPhoto),
      trustedSourcesOnly: sourcePreferences.trustedSourcesOnly !== false,
    },
    alertStyle: ALERT_STYLE_OPTIONS.some((option) => option.key === memory?.alertStyle)
      ? memory.alertStyle
      : DEFAULT_WORKSPACE_MEMORY.alertStyle,
  };
}

function buildRadarSettingsFromWorkspace(workspace = {}) {
  const currentSettings = loadPriorityRadarSettings();
  const watchQuestions = Array.isArray(workspace.watchQuestions) ? workspace.watchQuestions : [];
  const briefingStyle = Array.isArray(workspace.briefingStyle) ? workspace.briefingStyle : [];
  const workspaceMemory = normalizeWorkspaceMemory(workspace.workspaceMemory || {});
  const detectedCompanies = workspaceMemory.trackedCompanies.length
    ? workspaceMemory.trackedCompanies
    : detectReleaseWatchCompanies(...watchQuestions, ...briefingStyle).map((company) => company.key);
  const aiIntent = workspaceMemory.priorityTopics.some((topic) => /\b(ai|release|model|tool|api|company)\b/i.test(topic))
    || hasAiReleaseIntent(...watchQuestions, ...briefingStyle);
  const politicalIntent = [
    ...workspaceMemory.priorityTopics,
    ...workspaceMemory.peopleOfInterest,
    ...watchQuestions,
    ...briefingStyle,
  ].some((entry) => /\bleader|president|prime minister|government|election|policy|diplomacy|parliament|minister|country\b/i.test(entry));
  const geoIntent = workspaceMemory.priorityTopics.some((topic) => /\biran|regional|qatar|risk|war|escalat/i.test(topic))
    || politicalIntent
    || hasRegionalRiskFocus(...watchQuestions, ...briefingStyle);
  const fallbackCompanies = Object.entries(currentSettings.releaseWatch?.companies || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => companyKey);
  const releaseWatchCompanies = detectedCompanies.length
    ? detectedCompanies
    : aiIntent
      ? (fallbackCompanies.length ? fallbackCompanies : RELEASE_WATCH_COMPANIES.map((company) => company.key))
      : [];

  return {
    ...currentSettings,
    enabled: aiIntent || geoIntent || currentSettings.enabled,
    pollMinutes: workspaceMemory.alertStyle === 'strict' ? 5 : workspaceMemory.alertStyle === 'balanced' ? 10 : 15,
    categories: {
      ai: aiIntent,
      geo: geoIntent,
    },
    releaseWatch: {
      ...currentSettings.releaseWatch,
      enabled: aiIntent,
      minImportance: workspaceMemory.alertStyle === 'strict' ? 'major' : 'important',
      companies: Object.fromEntries(
        RELEASE_WATCH_COMPANIES.map((company) => [company.key, releaseWatchCompanies.includes(company.key)])
      ),
    },
  };
}

function loadDraft(key, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return localStorage.getItem(key) || fallback;
}

function saveDraft(key, value) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!value) {
    localStorage.removeItem(key);
    return;
  }

  localStorage.setItem(key, value);
}

function WorkspaceHistory({ versions = [], busy, onRestore }) {
  return (
    <div className="card" style={{ padding: 'var(--space-medium)', display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
      <div>
        <h2 className="section-title">Saved versions</h2>
        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
          Every AI edit or document save creates a snapshot you can restore.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
        {versions.slice(0, 6).map((version, index) => (
          <div key={version.id} className="subtle-panel" style={{ background: 'var(--surface)', padding: 'var(--space-small)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-tight)', alignItems: 'flex-start' }}>
              <div>
                <strong style={{ font: 'var(--font-body)' }}>
                  Version {version.versionNumber}
                </strong>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {formatTimestamp(version.createdAt)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || index === 0}
                onClick={() => onRestore(version.id)}
              >
                {index === 0 ? 'Current' : 'Restore'}
              </button>
            </div>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: 'var(--space-tight)' }}>
              {version.changeSummary || 'Saved workspace update.'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceMessages({ messages = [] }) {
  const recentMessages = messages.slice(-6).reverse();

  return (
    <div className="card" style={{ padding: 'var(--space-medium)', display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
      <div>
        <h2 className="section-title">Recent edits</h2>
        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
          This is the short conversation history behind the saved document.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
        {recentMessages.map((message) => (
          <div
            key={message.id}
            className="subtle-panel"
            style={{
              background: message.role === 'user' ? 'var(--surface)' : 'color-mix(in srgb, var(--surface-elevated) 92%, var(--accent) 8%)',
              borderColor: message.role === 'user'
                ? 'var(--border)'
                : 'color-mix(in srgb, var(--accent) 20%, var(--border))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-tight)', alignItems: 'center', marginBottom: 'var(--space-tight)' }}>
              <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                {message.role === 'user' ? 'You' : 'AI editor'}
              </strong>
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {formatTimestamp(message.createdAt)}
              </span>
            </div>
            <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
              {message.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemMapBranch({ node, level = 0 }) {
  if (!node) {
    return null;
  }

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div
        className="subtle-panel"
        style={{
          background: level === 0 ? 'color-mix(in srgb, var(--surface-elevated) 94%, var(--accent) 6%)' : 'var(--surface)',
          borderColor: level === 0
            ? 'color-mix(in srgb, var(--accent) 26%, var(--border))'
            : 'var(--border)',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-tight)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
            {level > 0 ? '> ' : ''}
            {node.label}
          </strong>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {node.value && (
              <code
                style={{
                  font: 'var(--font-caption)',
                  color: 'var(--text-primary)',
                  background: 'color-mix(in srgb, var(--surface) 82%, var(--chrome-bg))',
                  padding: '4px 8px',
                  borderRadius: '999px',
                  wordBreak: 'break-all',
                }}
              >
                {node.value}
              </code>
            )}
            {node.badge && <span className="status-pill is-live">{node.badge}</span>}
          </div>
        </div>
        {node.meta && (
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
            {node.meta}
          </p>
        )}
      </div>

      {hasChildren && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginLeft: level === 0 ? '12px' : '16px',
            paddingLeft: '12px',
            borderLeft: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border))',
          }}
        >
          {node.children.map((child, index) => (
            <SystemMapBranch
              key={`${node.label}-${child.label}-${index}`}
              node={child}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemMapSection({ systemMap }) {
  if (!systemMap) {
    return null;
  }

  const summary = systemMap.summary || {};

  return (
    <section className="card workspace-section-card workspace-section-card--map" style={{ padding: 'var(--space-medium)', display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
      <div>
        <h2 className="section-title">Models, functions, and sources</h2>
        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
          This is the live backend map behind your interest template. It shows which models are being used, what they do, and which monitored sources feed the app.
        </p>
      </div>

      <div className="subtle-panel accent-panel workspace-highlight-panel workspace-map-summary" style={{ gap: 'var(--space-base)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-small)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span className="workspace-doc-kicker">Active provider</span>
            <span className="chip active">{summary.activeProvider || 'mock'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span className="workspace-doc-kicker">Gemini API keys</span>
            <span className={`chip ${summary.geminiConfigured ? 'active' : ''}`}>
              {Number(summary.geminiKeyCount || 0)} configured
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span className="workspace-doc-kicker">OpenAI backup</span>
            <span className={`chip ${summary.openaiConfigured ? 'active' : ''}`}>
              {summary.openaiConfigured ? 'Available' : 'Not configured'}
            </span>
          </div>
        </div>

        <div className="workspace-map-notice">
          <span className="workspace-map-notice-badge">Live tree</span>
          <p>
            Changes here are driven by backend config, so the map updates when model routing or source coverage changes.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
        {(systemMap.tree || []).map((node, index) => (
          <SystemMapBranch key={`${node.label}-${index}`} node={node} />
        ))}
      </div>
    </section>
  );
}

function truncateBrainText(value = '', maxLength = 150) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildRecentChangeEntries(state = {}) {
  const versions = Array.isArray(state?.versions) ? state.versions : [];
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  const entries = [];

  const latestVersion = versions[0];
  if (latestVersion) {
    entries.push({
      tone: 'blue',
      label: `Saved version ${latestVersion.versionNumber || '1'}`,
      detail: latestVersion.changeSummary || 'Saved workspace update.',
      meta: formatTimestamp(latestVersion.createdAt),
    });
  }

  const latestMessage = messages[messages.length - 1];
  if (latestMessage) {
    entries.push({
      tone: latestMessage.role === 'assistant' ? 'orange' : 'blue',
      label: latestMessage.role === 'assistant' ? 'AI editor response' : 'You edited the brief',
      detail: truncateBrainText(latestMessage.content, 140) || 'Recent conversation update.',
      meta: formatTimestamp(latestMessage.createdAt),
    });
  }

  const previousVersion = versions[1];
  if (previousVersion) {
    entries.push({
      tone: 'orange',
      label: `Previous version ${previousVersion.versionNumber || '2'}`,
      detail: previousVersion.changeSummary || 'Earlier saved workspace snapshot.',
      meta: formatTimestamp(previousVersion.createdAt),
    });
  }

  return entries.slice(0, 3);
}

function buildInterestBrainSnapshot(state = {}) {
  const workspace = state?.workspace && typeof state.workspace === 'object' ? state.workspace : {};
  const workspaceMemory = normalizeWorkspaceMemory(workspace.workspaceMemory || {});
  const operatingBrief = buildOperatingBrief(state);
  const systemSummary = state?.systemMap?.summary || {};
  const radarSettings = buildRadarSettingsFromWorkspace(workspace);

  const sourcePosture = [
    workspaceMemory.sourcePreferences.officialFirst !== false ? 'Official first' : '',
    workspaceMemory.sourcePreferences.written !== false ? 'Written reporting' : '',
    workspaceMemory.sourcePreferences.socialVideo !== false ? 'Video signals' : '',
    workspaceMemory.sourcePreferences.socialPhoto ? 'Photo signals' : '',
    workspaceMemory.sourcePreferences.trustedSourcesOnly !== false ? 'Trusted only' : '',
  ].filter(Boolean);

  const alertPosture = [
    workspaceMemory.alertStyle === 'strict'
      ? 'Strict alerts'
      : workspaceMemory.alertStyle === 'balanced'
        ? 'Balanced alerts'
        : 'Broad alerts',
    radarSettings.enabled ? 'Priority radar on' : 'Priority radar off',
    `AI ${radarSettings.categories?.ai !== false ? 'on' : 'off'}`,
    `Geo ${radarSettings.categories?.geo !== false ? 'on' : 'off'}`,
    `Poll every ${Number(radarSettings.pollMinutes || 15)} min`,
  ];

  const modelRoute = [
    `Provider: ${systemSummary.activeProvider || 'mock'}`,
    `Gemini keys: ${Number(systemSummary.geminiKeyCount || 0)}`,
    `OpenAI backup: ${systemSummary.openaiConfigured ? 'available' : 'off'}`,
  ];

  return {
    mission: operatingBrief.summary,
    currentFocus: operatingBrief.watchQuestions.length
      ? operatingBrief.watchQuestions.slice(0, 3)
      : operatingBrief.priorityTopics.slice(0, 3),
    trackedCompanies: operatingBrief.trackedCompanies,
    peopleOfInterest: operatingBrief.peopleOfInterest,
    sourcePosture,
    alertPosture,
    modelRoute,
    recentChanges: buildRecentChangeEntries(state),
  };
}

function InterestBrainSection({ state }) {
  if (!state) {
    return null;
  }

  const brain = buildInterestBrainSnapshot(state);
  const systemSummary = state?.systemMap?.summary || {};

  return (
    <section className="card workspace-section-card workspace-section-card--brain interest-brain-card">
      <div>
        <h2 className="section-title">Interest Brain</h2>
        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
          This is the live profile eXplore is carrying for you. It combines your mission, watched voices, company priorities, source posture, alert posture, and recent edits so the app can explain itself before it recommends anything.
        </p>
      </div>

      <div className="subtle-panel accent-panel interest-brain-summary-panel">
        <div className="interest-brain-summary-grid">
          <div className="interest-brain-summary-block">
            <span className="workspace-doc-kicker">Current mission</span>
            <p className="interest-brain-summary-copy">{brain.mission}</p>
          </div>
          <div className="interest-brain-summary-block">
            <span className="workspace-doc-kicker">Source posture</span>
            <div className="interest-brain-chip-row">
              {renderChipItems(brain.sourcePosture, { emptyLabel: 'No source posture yet.' })}
            </div>
          </div>
          <div className="interest-brain-summary-block">
            <span className="workspace-doc-kicker">Alert posture</span>
            <div className="interest-brain-chip-row">
              {renderChipItems(brain.alertPosture, { emptyLabel: 'No alert posture yet.' })}
            </div>
          </div>
          <div className="interest-brain-summary-block">
            <span className="workspace-doc-kicker">Model route</span>
            <div className="interest-brain-chip-row">
              {renderChipItems(brain.modelRoute, { emptyLabel: 'No model route yet.' })}
            </div>
          </div>
        </div>
      </div>

      <div className="interest-brain-grid">
        <div className="interest-brain-panel">
          <span className="workspace-doc-kicker">Current focus</span>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginTop: '8px' }}>
            {brain.currentFocus.length
              ? brain.currentFocus.join(' / ')
              : 'No focus points saved yet.'}
          </p>
          <div className="interest-brain-chip-row">
            {renderChipItems(brain.currentFocus, { emptyLabel: 'Add questions to sharpen the brief.' })}
          </div>
        </div>

        <div className="interest-brain-panel">
          <span className="workspace-doc-kicker">Tracked companies and voices</span>
          <div className="interest-brain-section-stack">
            <div>
              <p className="interest-brain-panel-label">Companies</p>
              <div className="interest-brain-chip-row">
                {renderChipItems(brain.trackedCompanies, { emptyLabel: 'No companies saved yet.' })}
              </div>
            </div>
            <div>
              <p className="interest-brain-panel-label">People of interest</p>
              <div className="interest-brain-chip-row">
                {renderChipItems(brain.peopleOfInterest, { emptyLabel: 'Add voices you want tracked.' })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="interest-brain-timeline">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
          <div>
            <span className="workspace-doc-kicker">Recent changes</span>
            <p className="interest-brain-timeline-copy">
              Saved versions and recent edits are shown here so the profile feels like a living brief, not a static settings form.
            </p>
          </div>
          <span className="status-pill is-live">
            {systemSummary.updatedAt ? 'Live profile' : 'Profile ready'}
          </span>
        </div>

        {brain.recentChanges.length ? (
          <div className="interest-brain-timeline-list">
            {brain.recentChanges.map((entry) => (
              <div
                key={`${entry.label}-${entry.meta}`}
                className="interest-brain-timeline-item"
                data-tone={entry.tone}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>{entry.label}</strong>
                  <span className="interest-brain-timeline-meta">{entry.meta}</span>
                </div>
                <p>{entry.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="interest-brain-timeline-empty">
            No saved changes yet. Once you edit the template, the latest versions and AI edits will appear here.
          </div>
        )}
      </div>
    </section>
  );
}

function GoalSection() {
  return (
    <section className="card" style={{ padding: 'var(--space-medium)', marginBottom: 'var(--space-base)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
        <div>
          <span className="workspace-doc-kicker">MY GOAL IN LIFE (my wish in life)</span>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginTop: '8px' }}>
            [Define your ultimate life goal here — what you are building towards every day.]
          </p>
        </div>

        <div style={{ height: '1px', background: 'var(--border)' }} />

        <div>
          <span className="workspace-doc-kicker">Goal in relation to learning in the future</span>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginTop: '8px' }}>
            [Define your continuous learning objectives and how they support your life goal.]
          </p>
        </div>

        <div style={{ height: '1px', background: 'var(--border)' }} />

        <div>
          <span className="workspace-doc-kicker">Lower order representations (Prompts &amp; Ideas)</span>
          <ul style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginLeft: '16px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', listStyleType: 'disc' }}>
            <li>Iran / Jordan war regional updates</li>
            <li>Steve Jobs, Jordan Peterson, and Niles Hollowell-Dhar / Skrillex (Learn from them)</li>
            <li>AI releases and new tools I can use now</li>
          </ul>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '12px' }}>
            <em>All configured prompts and ideas are collected in <code style={{ background: 'var(--surface)', padding: '2px 4px', borderRadius: '4px' }}>docs/my-ai-prompts.md</code> in the project root.</em>
          </p>
        </div>
      </div>
    </section>
  );
}

export default function TemplateScreen({ onBack, onNavigate, embedded }) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [styleDraft, setStyleDraft] = useState('');
  const [aiNote, setAiNote] = useState('');
  const [topicDraft, setTopicDraft] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [newTopicDraft, setNewTopicDraft] = useState('');
  const [avoidDraft, setAvoidDraft] = useState('');
  const [newsPaths, setNewsPaths] = useState([]);
  const [trackedCompaniesDraft, setTrackedCompaniesDraft] = useState(DEFAULT_WORKSPACE_MEMORY.trackedCompanies);
  const [peopleDraft, setPeopleDraft] = useState(DEFAULT_WORKSPACE_MEMORY.peopleOfInterest);
  const [leaderCountryDraft, setLeaderCountryDraft] = useState('');
  const [leaderNameDraft, setLeaderNameDraft] = useState('');
  const [videoCreatorsDraft, setVideoCreatorsDraft] = useState(DEFAULT_WORKSPACE_MEMORY.videoLibrary.creators);
  const [videoCreatorsRawDraft, setVideoCreatorsRawDraft] = useState('');
  const [videoCategoriesDraft, setVideoCategoriesDraft] = useState(DEFAULT_WORKSPACE_MEMORY.videoLibrary.categories);
  const [videoCategoriesRawDraft, setVideoCategoriesRawDraft] = useState('');
  const [inlinePlaybackDraft, setInlinePlaybackDraft] = useState(DEFAULT_WORKSPACE_MEMORY.videoLibrary.inlinePlayback);
  const [alertStyleDraft, setAlertStyleDraft] = useState(DEFAULT_WORKSPACE_MEMORY.alertStyle);
  const [sourcePreferenceDraft, setSourcePreferenceDraft] = useState(DEFAULT_WORKSPACE_MEMORY.sourcePreferences);
  const [draftReady, setDraftReady] = useState(false);
  // Free-form interests input — user can type anything like "I need tools" or "show claude releases"
  const INTERESTS_DRAFT_KEY = 'explore-template-draft-interests';
  const [interestsDraft, setInterestsDraft] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(INTERESTS_DRAFT_KEY) || '';
    return '';
  });
  const [interestsFeedback, setInterestsFeedback] = useState('');
  const parsedIntent = parseInterestIntent(interestsDraft);
  const detectedVideoCreators = detectVideoCreatorKeysFromText(interestsDraft);
  const detectedVideoCategories = detectVideoCategoryKeysFromText(interestsDraft);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [data, newsPathsData] = await Promise.all([
        fetchTemplate(),
        fetchNewsPaths().catch(() => null),
      ]);
      if (!data || cancelled) {
        setLoading(false);
        return;
      }

      if (newsPathsData?.paths) {
        setNewsPaths(newsPathsData.paths);
      }

      setState(data);
      setQuestionDraft(loadDraft(DRAFT_KEYS.questions, toDocumentText(data?.workspace?.watchQuestions || [])));
      setStyleDraft(loadDraft(DRAFT_KEYS.style, toDocumentText(data?.workspace?.briefingStyle || [])));
      setAiNote(loadDraft(DRAFT_KEYS.note, ''));
      const workspaceMemory = normalizeWorkspaceMemory(data?.workspace?.workspaceMemory || {});
      setTopicDraft(loadDraft(DRAFT_KEYS.topics, toDocumentText(workspaceMemory.priorityTopics)));
      setAvoidDraft(loadDraft(DRAFT_KEYS.avoid, toDocumentText(workspaceMemory.avoidTopics)));
      setTrackedCompaniesDraft(normalizeTrackedCompanies(parseDocumentText(loadDraft(DRAFT_KEYS.companies, toDocumentText(workspaceMemory.trackedCompanies)))));
      setPeopleDraft(normalizePeopleOfInterest(parseDocumentText(loadDraft(DRAFT_KEYS.people, toDocumentText(workspaceMemory.peopleOfInterest)))));
      setLeaderCountryDraft(loadDraft(DRAFT_KEYS.leaderCountry, ''));
      setLeaderNameDraft(loadDraft(DRAFT_KEYS.leaderName, ''));
      const rawVideoCreators = loadDraft(DRAFT_KEYS.videoCreators, toDocumentText(workspaceMemory.videoLibrary.creators.map(c => getVideoLibraryCreatorLabel(c))));
      setVideoCreatorsRawDraft(rawVideoCreators);
      setVideoCreatorsDraft(normalizeVideoCreatorKeys(
        parseDocumentText(rawVideoCreators),
        workspaceMemory.videoLibrary.creators,
      ));
      
      const rawVideoCategories = loadDraft(DRAFT_KEYS.videoCategories, toDocumentText(workspaceMemory.videoLibrary.categories.map(c => getVideoLibraryCategoryLabel(c))));
      setVideoCategoriesRawDraft(rawVideoCategories);
      setVideoCategoriesDraft(normalizeVideoCategoryKeys(
        parseDocumentText(rawVideoCategories),
        workspaceMemory.videoLibrary.categories,
      ));
      setInlinePlaybackDraft(loadDraft(DRAFT_KEYS.inlinePlayback, workspaceMemory.videoLibrary.inlinePlayback ? 'true' : 'false') !== 'false');
      setAlertStyleDraft(loadDraft(DRAFT_KEYS.alertStyle, workspaceMemory.alertStyle || DEFAULT_WORKSPACE_MEMORY.alertStyle));
      try {
        setSourcePreferenceDraft(JSON.parse(loadDraft(DRAFT_KEYS.sourcePrefs, JSON.stringify(workspaceMemory.sourcePreferences))));
      } catch {
        setSourcePreferenceDraft(workspaceMemory.sourcePreferences);
      }
      setDraftReady(true);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    saveDraft(DRAFT_KEYS.questions, questionDraft);
    saveDraft(DRAFT_KEYS.style, styleDraft);
    saveDraft(DRAFT_KEYS.note, aiNote);
    saveDraft(DRAFT_KEYS.topics, topicDraft);
    saveDraft(DRAFT_KEYS.avoid, avoidDraft);
    saveDraft(DRAFT_KEYS.companies, toDocumentText(trackedCompaniesDraft));
    saveDraft(DRAFT_KEYS.people, toDocumentText(peopleDraft));
    saveDraft(DRAFT_KEYS.leaderCountry, leaderCountryDraft);
    saveDraft(DRAFT_KEYS.leaderName, leaderNameDraft);
    saveDraft(DRAFT_KEYS.videoCreators, videoCreatorsRawDraft);
    saveDraft(DRAFT_KEYS.videoCategories, videoCategoriesRawDraft);
    saveDraft(DRAFT_KEYS.inlinePlayback, inlinePlaybackDraft ? 'true' : 'false');
    saveDraft(DRAFT_KEYS.alertStyle, alertStyleDraft);
    saveDraft(DRAFT_KEYS.sourcePrefs, JSON.stringify(sourcePreferenceDraft));
    if (typeof window !== 'undefined') localStorage.setItem(INTERESTS_DRAFT_KEY, interestsDraft);
  }, [draftReady, questionDraft, styleDraft, aiNote, topicDraft, avoidDraft, trackedCompaniesDraft, peopleDraft, leaderCountryDraft, leaderNameDraft, videoCreatorsDraft, videoCategoriesDraft, videoCreatorsRawDraft, videoCategoriesRawDraft, inlinePlaybackDraft, alertStyleDraft, sourcePreferenceDraft, interestsDraft]);

  useEffect(() => {
    if (!draftReady) {
      return undefined;
    }

    let cancelled = false;
    const refreshTemplate = async () => {
      const data = await fetchTemplate();
      if (data && !cancelled) {
        setState(data);
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshTemplate();
    }, 60000);

    const handleFocus = () => {
      void refreshTemplate();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [draftReady]);

  const applyTemplateState = (data, options = {}) => {
    if (!data) {
      return;
    }

    setState(data);

    if (options.resetDrafts) {
      setQuestionDraft(toDocumentText(data?.workspace?.watchQuestions || []));
      setStyleDraft(toDocumentText(data?.workspace?.briefingStyle || []));
      const workspaceMemory = normalizeWorkspaceMemory(data?.workspace?.workspaceMemory || {});
      setTopicDraft(toDocumentText(workspaceMemory.priorityTopics));
      setAvoidDraft(toDocumentText(workspaceMemory.avoidTopics));
      setTrackedCompaniesDraft(workspaceMemory.trackedCompanies);
      setPeopleDraft(workspaceMemory.peopleOfInterest);
      setVideoCreatorsDraft(workspaceMemory.videoLibrary.creators);
      setVideoCreatorsRawDraft(toDocumentText(workspaceMemory.videoLibrary.creators.map(c => getVideoLibraryCreatorLabel(c))));
      setVideoCategoriesDraft(workspaceMemory.videoLibrary.categories);
      setVideoCategoriesRawDraft(toDocumentText(workspaceMemory.videoLibrary.categories.map(c => getVideoLibraryCategoryLabel(c))));
      setInlinePlaybackDraft(workspaceMemory.videoLibrary.inlinePlayback);
      setAlertStyleDraft(workspaceMemory.alertStyle);
      setSourcePreferenceDraft(workspaceMemory.sourcePreferences);
      setAiNote('');
      saveDraft(DRAFT_KEYS.note, '');
    }
  };

  const syncWorkspaceIntent = async (workspace = {}) => {
    const nextSettings = buildRadarSettingsFromWorkspace(workspace);
    const savedSettings = await savePriorityRadarSettings(nextSettings);

    if (user) {
      const currentPreferences = await fetchNotificationPreferences();
      const companies = Object.entries(savedSettings.releaseWatch?.companies || {})
        .filter(([, enabled]) => enabled)
        .map(([companyKey]) => companyKey);

      await updateNotificationPreferences({
        alerts_enabled: savedSettings.enabled,
        ai_enabled: savedSettings.categories?.ai !== false,
        geo_enabled: Boolean(savedSettings.categories?.geo),
        push_enabled: currentPreferences?.push_enabled === true,
        local_fallback_enabled: savedSettings.enabled,
        ai_release_watch_enabled: savedSettings.releaseWatch?.enabled !== false,
        ai_release_watch_companies: companies,
        ai_release_watch_min_importance: workspace?.workspaceMemory?.alertStyle === 'strict' ? 'major' : 'important',
      });
    }
  };

  const buildWorkspaceMemoryFromDrafts = (overrides = {}) => normalizeWorkspaceMemory({
    priorityTopics: overrides.priorityTopics || parseDocumentText(topicDraft),
    avoidTopics: overrides.avoidTopics || parseDocumentText(avoidDraft),
    trackedCompanies: overrides.trackedCompanies || trackedCompaniesDraft,
    peopleOfInterest: overrides.peopleOfInterest || peopleDraft,
    videoLibrary: {
      creators: overrides.videoCreators || videoCreatorsDraft,
      categories: overrides.videoCategories || videoCategoriesDraft,
      inlinePlayback: overrides.inlinePlayback ?? inlinePlaybackDraft,
    },
    sourcePreferences: overrides.sourcePreferences || sourcePreferenceDraft,
    alertStyle: overrides.alertStyle || alertStyleDraft,
  });

  const persistWorkspaceDraft = async ({
    watchQuestions = parseDocumentText(questionDraft),
    briefingStyle = parseDocumentText(styleDraft),
    workspaceMemory: rawWorkspaceMemory = buildWorkspaceMemoryFromDrafts(),
    successMessage = 'Saved the document. These points are now the live rules.',
  } = {}) => {
    const workspaceMemory = normalizeWorkspaceMemory(rawWorkspaceMemory);

    if (!watchQuestions.length) {
      setFeedback('Add at least one question the app should keep watching.');
      return null;
    }

    if (!briefingStyle.length) {
      setFeedback('Add at least one rule for how the news should be written to you.');
      return null;
    }

    setBusy(true);
    setFeedback('');
    try {
      const data = await saveTemplateWorkspace({ watchQuestions, briefingStyle, workspaceMemory });
      if (data) {
        await syncWorkspaceIntent({ watchQuestions, briefingStyle, workspaceMemory });
        applyTemplateState(data, { resetDrafts: true });
        setFeedback(successMessage);
        return data;
      }
      setFeedback('The document could not be saved right now.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleSaveWorkspace = async () => {
    await persistWorkspaceDraft();
  };

  const handleApplyAiEdit = async () => {
    if (!aiNote.trim()) {
      setFeedback('Tell the AI what to add, remove, or rewrite first.');
      return;
    }

    setBusy(true);
    setFeedback('');
    const data = await refineTemplate(aiNote.trim());
    if (data) {
      await syncWorkspaceIntent(data?.workspace || {});
      applyTemplateState(data, { resetDrafts: true });
      if (data?.refinement?.status === 'needs_clarification') {
        setFeedback('The AI needs one follow-up answer before changing the document.');
      } else {
        setFeedback('Applied your note and updated the saved document.');
      }
    } else {
      setFeedback('The AI edit could not be applied right now.');
    }
    setBusy(false);
  };

  const handleResetDraft = () => {
    setQuestionDraft(toDocumentText(state?.workspace?.watchQuestions || []));
    setStyleDraft(toDocumentText(state?.workspace?.briefingStyle || []));
    const workspaceMemory = normalizeWorkspaceMemory(state?.workspace?.workspaceMemory || {});
    setTopicDraft(toDocumentText(workspaceMemory.priorityTopics));
    setAvoidDraft(toDocumentText(workspaceMemory.avoidTopics));
    setTrackedCompaniesDraft(workspaceMemory.trackedCompanies);
    setPeopleDraft(workspaceMemory.peopleOfInterest);
    setVideoCreatorsDraft(workspaceMemory.videoLibrary.creators);
    setVideoCategoriesDraft(workspaceMemory.videoLibrary.categories);
    setInlinePlaybackDraft(workspaceMemory.videoLibrary.inlinePlayback);
    setAlertStyleDraft(workspaceMemory.alertStyle);
    setSourcePreferenceDraft(workspaceMemory.sourcePreferences);
    setAiNote('');
    setFeedback('Restored the draft to the last saved version.');
  };

  const handleRestoreVersion = async (versionId) => {
    setBusy(true);
    setFeedback('');
    const data = await restoreTemplateVersion(versionId);
    if (data) {
      await syncWorkspaceIntent(data?.workspace || {});
      applyTemplateState(data, { resetDrafts: true });
      setFeedback('Restored that saved version.');
    } else {
      setFeedback('That version could not be restored.');
    }
    setBusy(false);
  };

  const applyInterestsIntent = () => {
    const intent = parseInterestIntent(interestsDraft);
    const videoCreators = detectVideoCreatorKeysFromText(interestsDraft);
    const videoCategories = detectVideoCategoryKeysFromText(interestsDraft);
    if (!intent.hasAnySignal && !videoCreators.length && !videoCategories.length) {
      setInterestsFeedback('Try writing something like "I need AI tools I can use today" or "show me new Claude and GPT releases".');
      return;
    }
    const additions = [];
    if (intent.toolIntent) {
      additions.push('Which AI tools or APIs just became available that I can actually use or build with today?');
    }
    if (intent.releaseIntent || intent.modelIntent) {
      additions.push('Which official AI model releases are real product changes, not just announcements?');
    }
    if (intent.wantsRealTime) {
      additions.push('Which AI releases just dropped in the last 24 hours?');
    }
    if (additions.length) {
      setQuestionDraft((current) => mergeDocumentText(current, additions));
    }
    if (intent.toolIntent || intent.releaseIntent) {
      setStyleDraft((current) => mergeDocumentText(current, [
        'Lead with what changed and whether it is usable today.',
        'Ignore hype and commentary unless it describes a real new capability.',
      ]));
    }
    if (intent.companies.length) {
      setTrackedCompaniesDraft((current) => {
        const merged = [...new Set([...current, ...intent.companies])];
        return merged;
      });
    }
    if (videoCreators.length) {
      setVideoCreatorsDraft((current) => normalizeVideoCreatorKeys([...current, ...videoCreators]));
    }
    if (videoCategories.length) {
      setVideoCategoriesDraft((current) => normalizeVideoCategoryKeys([...current, ...videoCategories]));
    }
    if (intent.alertStyle) setAlertStyleDraft(intent.alertStyle);
    if (intent.minImportance) {
      const topicLine = intent.minImportance === 'major'
        ? 'Only major AI releases — skip minor updates'
        : 'All AI releases including smaller updates';
      setTopicDraft((current) => mergeDocumentText(current, [topicLine]));
    }
    setInterestsFeedback('Applied your intent to the document draft. Review below and save.');
  };

  const applyRulePack = (pack) => {
    setQuestionDraft((current) => mergeDocumentText(current, pack.questions || []));
    setStyleDraft((current) => mergeDocumentText(current, pack.styles || []));
    setFeedback(`Added ${pack.label.toLowerCase()} to the draft.`);
  };

  const persistLeaderWatch = async ({ country, leader, extraTopics = [], extraQuestions = [], extraStyle = [] }) => {
    const normalizedCountry = String(country || '').trim();
    const normalizedLeader = String(leader || '').trim();

    if (!normalizedCountry || !normalizedLeader) {
      setFeedback('Add both the country and the leader name first.');
      return;
    }

    const personEntry = `${normalizedLeader} | ${normalizedCountry} leader; ${normalizedCountry} government; official statement; policy; diplomacy; leadership; personality`;
    const nextPeople = normalizePeopleOfInterest([...peopleDraft, personEntry]);
    const nextTopicText = mergeDocumentText(topicDraft, [
      `${normalizedCountry} leadership watch`,
      `${normalizedLeader} / ${normalizedCountry}`,
      ...extraTopics,
    ]);
    const nextQuestionText = mergeDocumentText(questionDraft, [
      `Which confirmed decisions, statements, travel, policy, election, conflict, or diplomatic moves from ${normalizedLeader} in ${normalizedCountry} matter now?`,
      `Which ${normalizedCountry} leadership events change safety, markets, travel, war risk, or opportunity timing?`,
      ...extraQuestions,
    ]);
    const nextStyleText = mergeDocumentText(styleDraft, [
      `For ${normalizedLeader} / ${normalizedCountry}, show only confirmed changes from official or high-trust sources; ignore routine commentary.`,
      ...extraStyle,
    ]);
    const nextTopics = parseDocumentText(nextTopicText);
    const nextQuestions = parseDocumentText(nextQuestionText);
    const nextStyle = parseDocumentText(nextStyleText);

    setPeopleDraft(nextPeople);
    setTopicDraft(nextTopicText);
    setQuestionDraft(nextQuestionText);
    setStyleDraft(nextStyleText);

    await persistWorkspaceDraft({
      watchQuestions: nextQuestions,
      briefingStyle: nextStyle,
      workspaceMemory: buildWorkspaceMemoryFromDrafts({
        priorityTopics: nextTopics,
        peopleOfInterest: nextPeople,
      }),
      successMessage: `Saved ${normalizedLeader} / ${normalizedCountry} as a live leader watch.`,
    });
  };

  const handleAddCountryLeaderWatch = async () => {
    await persistLeaderWatch({
      country: leaderCountryDraft,
      leader: leaderNameDraft,
    });
  };

  const handleAddMohammedBinRashidWatch = async () => {
    setLeaderCountryDraft('Dubai / UAE');
    setLeaderNameDraft('Sheikh Mohammed bin Rashid Al Maktoum');
    await persistLeaderWatch({
      country: 'Dubai / UAE',
      leader: 'Sheikh Mohammed bin Rashid Al Maktoum',
      extraTopics: [
        'Mohammed bin Rashid leadership',
        'محمد بن راشد آل مكتوم',
        'Dubai future governance',
      ],
      extraQuestions: [
        'Which valuable resources explain Sheikh Mohammed bin Rashid Al Maktoum personality, leadership style, decision speed, poetry, ambition, risk appetite, and Dubai state-building?',
        'Which Sheikh Mohammed bin Rashid speeches, interviews, initiatives, books, and official projects reveal his personality and governing philosophy?',
      ],
      extraStyle: [
        'For Sheikh Mohammed bin Rashid, prioritize personality, leadership psychology, governance pattern, original speeches, official initiatives, serious interviews, and valuable long-form resources.',
        'Show Sheikh Mohammed bin Rashid before other Middle East leader figures when the topic is leadership, personality, Dubai, UAE, state-building, or vision.',
      ],
    });
  };

  const handleToggleNewsPath = async (path, enabled) => {
    const currentQuestions = parseDocumentText(questionDraft);
    const pathQuestionPrefix = `Which ${path.label} (`;
    let nextQuestions = [...currentQuestions];

    if (enabled) {
      const alreadyHas = currentQuestions.some(q => q.startsWith(pathQuestionPrefix) || q.toLowerCase().includes(path.id));
      if (!alreadyHas) {
        const newQuestion = `Which ${path.label} (${path.keywords.join(', ')}) updates are important?`;
        nextQuestions.push(newQuestion);
      }
    } else {
      nextQuestions = currentQuestions.filter(q => !q.startsWith(pathQuestionPrefix) && !q.toLowerCase().includes(path.id));
    }

    const watchQuestions = nextQuestions;
    setQuestionDraft(toDocumentText(watchQuestions));

    const briefingStyle = parseDocumentText(styleDraft);
    const workspaceMemory = normalizeWorkspaceMemory({
      priorityTopics: parseDocumentText(topicDraft),
      avoidTopics: parseDocumentText(avoidDraft),
      trackedCompanies: trackedCompaniesDraft,
      peopleOfInterest: peopleDraft,
      videoLibrary: {
        creators: videoCreatorsDraft,
        categories: videoCategoriesDraft,
        inlinePlayback: inlinePlaybackDraft,
      },
      sourcePreferences: sourcePreferenceDraft,
      alertStyle: alertStyleDraft,
    });

    setBusy(true);
    setFeedback('');
    const data = await saveTemplateWorkspace({ watchQuestions, briefingStyle, workspaceMemory });
    if (data) {
      await syncWorkspaceIntent({ watchQuestions, briefingStyle, workspaceMemory });
      applyTemplateState(data, { resetDrafts: true });
      setFeedback(`News path "${path.label}" ${enabled ? 'enabled' : 'disabled'}.`);
    } else {
      setFeedback('Failed to update news path.');
    }
    setBusy(false);
  };

  const toggleTrackedCompany = (companyKey) => {
    setTrackedCompaniesDraft((current) => {
      const next = current.includes(companyKey)
        ? current.filter((entry) => entry !== companyKey)
        : [...current, companyKey];
      return next.length ? next : current;
    });
  };

  const toggleVideoCategory = (categoryKey) => {
    setVideoCategoriesDraft((current) => {
      const next = current.includes(categoryKey)
        ? current.filter((entry) => entry !== categoryKey)
        : [...current, categoryKey];

      return next.length ? next : current;
    });
  };

  const toggleSourcePreference = (preferenceKey) => {
    setSourcePreferenceDraft((current) => ({
      ...current,
      [preferenceKey]: !current[preferenceKey],
    }));
  };

  const loadAiPromptPreset = (preset) => {
    setAiNote(preset.text);
    setFeedback('Loaded a guided AI prompt. Tweak it if you want, then apply it.');
  };

  if (loading) {
    return (
      <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
          <div className="skeleton" style={{ height: '140px' }} />
          <div className="skeleton" style={{ height: '420px' }} />
          <div className="skeleton" style={{ height: '260px' }} />
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="page-enter" style={{ padding: 'var(--space-base) 0 var(--space-large)' }}>
        <div className="container page-shell">
          <div className="page-header">
            <div className="page-header-copy">
              <span className="page-kicker">Editable workspace</span>
              <h1 style={{ font: 'var(--font-h1)' }}>News Rules</h1>
            </div>
          </div>

          <GoalSection />

          <div className="card">
            <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)' }}>
              Sign in and connect the backend to edit saved rules. Local drafts are kept on this device.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const workspaceMemory = normalizeWorkspaceMemory({
    priorityTopics: parseDocumentText(topicDraft),
    avoidTopics: parseDocumentText(avoidDraft),
    trackedCompanies: trackedCompaniesDraft,
    peopleOfInterest: peopleDraft,
    videoLibrary: {
      creators: videoCreatorsDraft,
      categories: videoCategoriesDraft,
      inlinePlayback: inlinePlaybackDraft,
    },
    sourcePreferences: sourcePreferenceDraft,
    alertStyle: alertStyleDraft,
  });
  const topicItems = parseDocumentText(topicDraft);
  const avoidItems = parseDocumentText(avoidDraft);
  const activeTopic = selectedTopic && topicItems.includes(selectedTopic)
    ? selectedTopic
    : topicItems[0] || '';

  const addTopic = () => {
    const nextTopic = newTopicDraft.trim();
    if (!nextTopic) return;
    const nextTopics = [...new Set([...topicItems, nextTopic])];
    setTopicDraft(toDocumentText(nextTopics));
    setSelectedTopic(nextTopic);
    setNewTopicDraft('');
  };

  const removeTopic = (topic) => {
    const nextTopics = topicItems.filter((entry) => entry !== topic);
    setTopicDraft(toDocumentText(nextTopics));
    setSelectedTopic(nextTopics[0] || '');
  };

  return (
    <div className={embedded ? "embedded-rules-workspace" : "page-enter"} style={embedded ? { display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' } : { padding: 'var(--space-base) 0 var(--space-large)' }}>
      <div className={embedded ? "" : "container page-shell"}>
        {!embedded && (
          <div className="page-header">
            <div className="page-header-copy">
              <span className="page-kicker">Editable workspace</span>
              <h1 style={{ font: 'var(--font-h1)' }}>News Rules</h1>
              <p className="page-subtitle">
                This is the natural-language control center for what matters to you. Write what eXplore should watch, what to ignore, and how it should phrase the signal back to you.
              </p>
            </div>
            <span className="status-pill is-live">Draft auto-saves locally</span>
          </div>
        )}

        <GoalSection />

        {!embedded && (
          <section className="card" style={{ padding: 'var(--space-medium)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              The live document below is the main control surface. The supporting sections around it only help you edit, explain, and reuse that same document more quickly.
            </p>
          </section>
        )}

        <InterestBrainSection state={state} />

        
        {/* ── TOPICS NET ── */}
        <section className="card workspace-section-card" style={{ padding: 'var(--space-medium)', display: 'flex', flexDirection: 'column', gap: 'var(--space-large)', marginBottom: 'var(--space-large)', background: 'var(--surface)', border: '1px solid var(--border-soft)' }}>
          <div>
            <h2 className="section-title">Topics NET</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
              I wish for... and those.. (General ideas, interpretations, and overarching rules that the AI adjusts).
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <span className="workspace-doc-kicker">All user&apos;s ideas (Modify what you need)</span>
            
            <textarea
              value={interestsDraft}
              onChange={(e) => { setInterestsDraft(e.target.value); setInterestsFeedback(''); }}
              placeholder="e.g. I need to know about new AI tools I can use, or track deep science and DNA breakthroughs. Show me Claude, GPT, Gemini, Llama releases as fast as possible."
              rows={3}
              style={{
                width: '100%', resize: 'vertical', font: 'var(--font-body)',
                background: 'var(--surface)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: '10px',
                padding: '12px 14px', lineHeight: '1.6', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-small)', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !interestsDraft.trim()} onClick={applyInterestsIntent}>
                Apply ideas
              </button>
              {interestsDraft.trim() && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setInterestsDraft(''); setInterestsFeedback(''); }}>
                  Clear
                </button>
              )}
            </div>
            {interestsFeedback && (
              <p style={{ font: 'var(--font-caption)', color: interestsFeedback.startsWith('Applied') ? 'var(--success)' : 'var(--text-secondary)' }}>
                {interestsFeedback}
              </p>
            )}

            {(parsedIntent.hasAnySignal || detectedVideoCreators.length || detectedVideoCategories.length) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: 'var(--space-tight)' }}>
                <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Detected intent:</span>
                {parsedIntent.toolIntent && <span className="chip active">Tool intent</span>}
                {parsedIntent.releaseIntent && <span className="chip active">Release watch</span>}
                {parsedIntent.modelIntent && <span className="chip active">Model names</span>}
                {parsedIntent.wantsRealTime && <span className="chip active">Real-time</span>}
                {detectedVideoCreators.map((creatorKey) => (
                  <span key={creatorKey} className="chip active">{getVideoLibraryCreatorLabel(creatorKey)}</span>
                ))}
                {detectedVideoCategories.map((categoryKey) => (
                  <span key={categoryKey} className="chip">{getVideoLibraryCategoryLabel(categoryKey)}</span>
                ))}
                {parsedIntent.companies.map((c) => <span key={c} className="chip active">{c}</span>)}
                {parsedIntent.minImportance && <span className="chip">{parsedIntent.minImportance === 'major' ? 'Major only' : 'All updates'}</span>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', marginTop: 'var(--space-base)' }}>
            <span className="workspace-doc-kicker">Interpretation (20 Networks of topics)</span>
            <div className="workspace-memory-panel" style={{ background: 'var(--surface)', padding: 'var(--space-small)', borderRadius: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-small)' }}>
                <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>Topics</strong>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    className="workspace-sheet-input"
                    value={newTopicDraft}
                    onChange={(event) => setNewTopicDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTopic();
                      }
                    }}
                    placeholder="New topic"
                    style={{ minWidth: '150px' }}
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addTopic} disabled={!newTopicDraft.trim()}>
                    Add
                  </button>
                </div>
              </div>

              <div className="scroll-row" style={{ gap: '8px', marginBottom: 'var(--space-small)' }}>
                {topicItems.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className={`chip ${activeTopic === topic ? 'active' : ''}`}
                    onClick={() => setSelectedTopic(topic)}
                  >
                    {topic}
                  </button>
                ))}
              </div>

              {activeTopic ? (
                <div className="subtle-panel" style={{ background: 'var(--surface-elevated)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>{activeTopic}</strong>
                      <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        Outline: watch this topic, prefer official or trusted sources, suppress repeated or low-signal items, and rank only items that change a decision.
                      </p>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeTopic(activeTopic)}>
                      Remove
                    </button>
                  </div>
                  {avoidItems.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                      {avoidItems.slice(0, 6).map((item) => (
                        <span key={item} className="chip">{`Avoid: ${item}`}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="subtle-panel" style={{ color: 'var(--text-secondary)' }}>
                  Add a topic to start a watch lane.
                </div>
              )}
            </div>
            
            <div className="workspace-memory-grid">
              <div className="workspace-memory-panel">
                <label className="workspace-sheet-label" htmlFor="interest-topics">Watch harder for</label>
                <textarea
                  id="interest-topics"
                  className="workspace-sheet-textarea"
                  value={topicDraft}
                  onChange={(event) => setTopicDraft(event.target.value)}
                  placeholder={'- AI releases\n- New tools I can use now\n- Iran / regional risk'}
                  rows={4}
                />
              </div>

              <div className="workspace-memory-panel">
                <label className="workspace-sheet-label" htmlFor="interest-avoid">Ignore / suppress</label>
                <textarea
                  id="interest-avoid"
                  className="workspace-sheet-textarea"
                  value={avoidDraft}
                  onChange={(event) => setAvoidDraft(event.target.value)}
                  placeholder={'- Hype\n- Celebrity AI chatter\n- Repeated context'}
                  rows={4}
                />
              </div>
            </div>
            
            <div style={{ marginTop: 'var(--space-small)' }}>
              <span className="workspace-doc-kicker" style={{ display: 'block', marginBottom: '8px' }}>Optional Starter Packs</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-small)' }}>
                {QUICK_RULE_PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    className="subtle-panel"
                    onClick={() => applyRulePack(pack)}
                    style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: '4px' }}
                  >
                    <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>{pack.label}</strong>
                    <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>{pack.description}</p>
                  </button>
                ))}
              </div>
            </div>
            
            {newsPaths.length > 0 && (
              <div style={{ marginTop: 'var(--space-small)' }}>
                <span className="workspace-doc-kicker" style={{ display: 'block', marginBottom: '8px' }}>News Paths Presets</span>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Toggle preset paths to automatically add or remove matching rules from your watched questions.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {newsPaths.map((path) => {
                    const pathQuestionPrefix = `Which ${path.label} (`;
                    const isEnabled = parseDocumentText(questionDraft).some(
                      q => q.startsWith(pathQuestionPrefix) || q.toLowerCase().includes(path.id)
                    );
                    return (
                      <button
                        key={path.id}
                        type="button"
                        className={`chip ${isEnabled ? 'active' : ''}`}
                        onClick={() => void handleToggleNewsPath(path, !isEnabled)}
                        disabled={busy}
                        style={{ cursor: 'pointer' }}
                      >
                        {path.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', marginTop: 'var(--space-base)' }}>
            <span className="workspace-doc-kicker">Rules and Guidelines (General / Specific to Topics)</span>
            <div className="workspace-memory-grid">
              <div className="workspace-memory-panel">
                <label className="workspace-sheet-label">General (Alert Tone)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  {ALERT_STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`workspace-choice ${alertStyleDraft === option.key ? 'is-active' : ''}`}
                      onClick={() => setAlertStyleDraft(option.key)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="workspace-memory-panel">
                <label className="workspace-sheet-label">Specific to Topics (Source Bias)</label>
                <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  {SOURCE_PREFERENCE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`chip ${sourcePreferenceDraft[option.key] ? 'active' : ''}`}
                      onClick={() => toggleSourcePreference(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── REFERENCES NET ── */}
        <section className="card workspace-section-card" style={{ padding: 'var(--space-medium)', display: 'flex', flexDirection: 'column', gap: 'var(--space-base)', marginBottom: 'var(--space-large)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <h2 className="section-title">References NET</h2>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
                Exact websites, platforms, people, and specific AI commands tied to topics.
              </p>
            </div>
            
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={handleResetDraft}>
                Reset drafting state
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={handleSaveWorkspace}>
                {busy ? 'Saving...' : 'Save Document Network'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <span className="workspace-doc-kicker">Topic: AI / Tech Releases</span>
            
            <div className="workspace-memory-panel" style={{ background: 'var(--surface)', padding: 'var(--space-small)', borderRadius: '10px' }}>
              <label className="workspace-sheet-label">AI Platforms (OpenAI, Anthropic, etc)</label>
              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', paddingBottom: 'var(--space-tight)' }}>
                {RELEASE_WATCH_COMPANIES.map((company) => (
                  <button
                    key={company.key}
                    type="button"
                    className={`chip ${trackedCompaniesDraft.includes(company.key) ? 'active' : ''}`}
                    onClick={() => toggleTrackedCompany(company.key)}
                  >
                    {company.label}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="workspace-memory-panel" style={{ background: 'var(--surface)', padding: 'var(--space-small)', borderRadius: '10px' }}>
               <label className="workspace-sheet-label">Youtube video references (in-app surface)</label>
               <textarea
                className="workspace-sheet-textarea"
                value={videoCreatorsRawDraft}
                onChange={(event) => {
                  setVideoCreatorsRawDraft(event.target.value);
                  setVideoCreatorsDraft(normalizeVideoCreatorKeys(parseDocumentText(event.target.value)));
                }}
                placeholder={'- Jordan Peterson\n- Steve Jobs\n- Niles Hollowell-Dhar / KSHMR'}
                rows={3}
                style={{ marginBottom: '8px' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-tight)' }}>
                {VIDEO_LIBRARY_CATEGORY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`chip ${videoCategoriesDraft.includes(option.key) ? 'active' : ''}`}
                    onClick={() => {
                      const newCategories = videoCategoriesDraft.includes(option.key)
                        ? videoCategoriesDraft.filter((entry) => entry !== option.key)
                        : [...videoCategoriesDraft, option.key];
                      setVideoCategoriesDraft(newCategories);
                      setVideoCategoriesRawDraft(toDocumentText(newCategories.map(c => getVideoLibraryCategoryLabel(c))));
                    }}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`chip ${inlinePlaybackDraft ? 'active' : ''}`}
                  onClick={() => setInlinePlaybackDraft((current) => !current)}
                >
                  {inlinePlaybackDraft ? 'Inline playback on' : 'Inline playback off'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', marginTop: 'var(--space-base)' }}>
            <span className="workspace-doc-kicker">AI prompt / rules / commands</span>
            
            <div className="workspace-memory-grid">
              <div className="workspace-memory-panel">
                <label className="workspace-sheet-label" htmlFor="watch-questions">
                  Watch commands (Questions to watch)
                </label>
                <textarea
                  id="watch-questions"
                  className="workspace-sheet-textarea"
                  value={questionDraft}
                  onChange={(event) => setQuestionDraft(event.target.value)}
                  placeholder={'- Which Anthropic, OpenAI, Gemini / DeepMind releases change what I can use?'}
                  rows={6}
                />
              </div>

              <div className="workspace-memory-panel">
                <label className="workspace-sheet-label" htmlFor="brief-style">
                  Briefing commands (How to write)
                </label>
                <textarea
                  id="brief-style"
                  className="workspace-sheet-textarea"
                  value={styleDraft}
                  onChange={(event) => setStyleDraft(event.target.value)}
                  placeholder={'- Use short direct titles.\n- Explain why it matters in one clear sentence.'}
                  rows={6}
                />
              </div>
            </div>

            <div className="workspace-memory-panel" style={{ background: 'var(--surface)', padding: 'var(--space-small)', borderRadius: '10px' }}>
              <label className="workspace-sheet-label">AI Editor Note</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-tight)', marginBottom: '8px' }}>
                {AI_PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="chip"
                    onClick={() => loadAiPromptPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <textarea
                className="text-surface"
                value={aiNote}
                onChange={(event) => setAiNote(event.target.value)}
                placeholder="Example: Focus on Anthropic, OpenAI, Gemini. Ignore fluff. Make summaries shorter."
                rows={3}
              />
              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--space-tight)' }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={handleApplyAiEdit}>
                  {busy ? 'Applying...' : 'Apply with AI'}
                </button>
                <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                  The AI updates the saved document, not just a hidden config.
                </span>
              </div>

              {state?.pendingClarification?.question && (
                <div className="subtle-panel accent-panel" style={{ marginTop: 'var(--space-small)' }}>
                  <strong style={{ font: 'var(--font-caption)' }}>AI follow-up</strong>
                  <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginTop: 'var(--space-tight)' }}>
                    {state.pendingClarification.question}
                  </p>
                </div>
              )}

              {feedback && (
                <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginTop: 'var(--space-tight)' }}>
                  {feedback}
                </p>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', marginTop: 'var(--space-base)' }}>
            <span className="workspace-doc-kicker">Topic: Politics / Regional Risk</span>

            <div className="workspace-memory-panel">
              <label className="workspace-sheet-label">
                Country leader watch
              </label>
              <div className="country-leader-watch">
                <input
                  type="text"
                  className="text-surface"
                  value={leaderCountryDraft}
                  onChange={(event) => setLeaderCountryDraft(event.target.value)}
                  placeholder="Country"
                  aria-label="Country to watch"
                />
                <input
                  type="text"
                  className="text-surface"
                  value={leaderNameDraft}
                  onChange={(event) => setLeaderNameDraft(event.target.value)}
                  placeholder="Leader name"
                  aria-label="Leader name to watch"
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAddCountryLeaderWatch}
                  disabled={busy}
                >
                  Add + save
                </button>
              </div>
              <div style={{ marginTop: '8px', display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="chip active"
                  onClick={handleAddMohammedBinRashidWatch}
                  disabled={busy}
                >
                  Add Sheikh Mohammed bin Rashid
                </button>
              </div>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '8px' }}>
                Adds and saves leader news, official statements, policy, diplomacy, personality, and risk questions into the same live monitor.
              </p>
            </div>
            
            <div className="workspace-memory-panel">
              <label className="workspace-sheet-label" htmlFor="people-of-interest">
                People of interest (Targeted Figures)
              </label>
              <textarea
                id="people-of-interest"
                className="workspace-sheet-textarea"
                value={toDocumentText(peopleDraft)}
                onChange={(event) => setPeopleDraft(normalizePeopleOfInterest(parseDocumentText(event.target.value)))}
                placeholder={'- Sam Altman\n- Dario Amodei\n- Anwar Ibrahim'}
                rows={4}
              />
            </div>
          </div>
        </section>
        
        <SystemMapSection systemMap={state.systemMap} />

        <section className="balanced-grid">

          <WorkspaceHistory versions={state.versions || []} busy={busy} onRestore={handleRestoreVersion} />
          <WorkspaceMessages messages={state.messages || []} />
        </section>
      </div>
    </div>
  );
}
