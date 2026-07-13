'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  balanceAlerts,
  dedupeAlerts,
  scoreAiItem,
  scoreGeoItem,
  selectLatestOfficialReleaseAlerts,
  shouldKeepCachedAlerts,
  sortAcceptedAlerts,
} = require('../src/services/alertRadarService');

const isoHoursAgo = (hours) => new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

test('keeps the last valid radar cache when a refresh temporarily returns nothing', () => {
  assert.equal(shouldKeepCachedAlerts([], {
    checkedAt: Date.now() - 60_000,
    alerts: [{ id: 'claude-opus-4-8' }],
  }), true);
  assert.equal(shouldKeepCachedAlerts([{ id: 'gpt-next' }], {
    checkedAt: Date.now() - 60_000,
    alerts: [{ id: 'claude-opus-4-8' }],
  }), false);
  assert.equal(shouldKeepCachedAlerts([], {
    checkedAt: 0,
    alerts: [],
  }), false);
});

test('accepts an official AI model launch with a strong release signal', () => {
  const result = scoreAiItem({
    title: 'OpenAI launches new GPT-5 reasoning model with API availability',
    description: 'Official OpenAI blog release introduces GPT-5 reasoning, API access, and pricing availability.',
    publisher: 'OpenAI',
    sourceLabel: 'AI official announcements',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://openai.com/index/gpt-5-release',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.source_type, 'official');
  assert.equal(result.review.rejected_reason, '');
});

test('accepts an official Anthropic launch post from the newsroom path', () => {
  const result = scoreAiItem({
    title: 'Claude Sonnet 4.6 launches with API availability',
    description: 'Anthropic announces Claude Sonnet 4.6 with new reasoning and API support.',
    publisher: 'Anthropic',
    sourceLabel: 'Anthropic news',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://www.anthropic.com/news/claude-sonnet-4-6',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.source_type, 'official');
  assert.equal(result.alert.release_watch_company, 'anthropic');
  assert.equal(result.alert.release_watch_signal, 'official_release');
  assert.equal(result.alert.priority_tag, 'world_impact');
  assert.deepEqual(result.alert.priority_tags, ['world_impact']);
  assert.equal(result.alert.alert_kind, 'major_ai_release');
});

test('accepts Claude Fable and Mythos as official Anthropic model releases', () => {
  const result = scoreAiItem({
    title: 'Claude Fable 5 and Claude Mythos 5',
    description: 'Anthropic releases Fable 5 and Mythos 5 with general availability, pricing, API access, and developer support.',
    publisher: 'Anthropic',
    sourceLabel: 'Anthropic news',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.source_type, 'official');
  assert.equal(result.alert.release_watch_company, 'anthropic');
  assert.equal(result.alert.release_classification, 'model_release');
  assert.equal(result.alert.alert_kind, 'major_ai_release');
});

test('accepts official launch titles that use a model-family name instead of the word model', () => {
  const result = scoreAiItem({
    title: 'OpenAI unveils GPT-5 with broad API availability',
    description: 'Official OpenAI launch post covering GPT-5 rollout, pricing, and developer access.',
    publisher: 'OpenAI',
    sourceLabel: 'OpenAI official feed',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://openai.com/news/gpt-5-availability',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.review.rejected_reason, '');
  assert.equal(result.alert.release_watch_company, 'openai');
});

test('accepts xAI news as an official release-watch source', () => {
  const result = scoreAiItem({
    title: 'xAI launches Grok 4 with API availability and voice features',
    description: 'xAI announces Grok 4 with reasoning, API access, and availability for developers.',
    publisher: 'xAI',
    sourceLabel: 'xAI news',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://x.ai/news/grok-4-launch',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.source_type, 'official');
  assert.equal(result.alert.release_watch_company, 'xai');
  assert.equal(result.alert.release_watch_company_label, 'xAI');
  assert.equal(result.alert.release_watch_signal, 'official_release');
  assert.equal(result.alert.release_classification, 'model_release');
  assert.equal(result.alert.release_classification_label, 'Model release');
  assert.equal(result.alert.release_classification_scope, 'primary_vendor');
  assert.equal(result.alert.fingerprint, result.alert.stable_fingerprint);
  assert.match(result.alert.why_notified, /xAI/i);
  assert.equal(result.alert.priority_tag, 'world_impact');
  assert.equal(result.alert.alert_kind, 'major_ai_release');
});

test('accepts Stability AI and Stable Diffusion launches as first-class official releases', () => {
  const result = scoreAiItem({
    title: 'Stability AI releases Stable Diffusion 5 with API availability',
    description: 'Stability AI introduces Stable Diffusion 5, a new image model with developer access and model weights.',
    publisher: 'Stability AI',
    sourceLabel: 'Stability AI news',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://stability.ai/news-updates/stable-diffusion-5',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.source_type, 'official');
  assert.equal(result.alert.release_watch_company, 'stability_ai');
  assert.equal(result.alert.release_watch_company_label, 'Stability AI');
  assert.equal(result.alert.release_watch_signal, 'official_release');
  assert.equal(result.alert.release_classification, 'model_release');
  assert.equal(result.alert.release_classification_scope, 'primary_vendor');
  assert.equal(result.alert.priority_tag, 'world_impact');
});

test('classifies API pricing coverage explicitly for vendor alerts', () => {
  const result = scoreAiItem({
    title: 'OpenAI updates API pricing and access for developers',
    description: 'OpenAI announces pricing and access changes for the API developer program.',
    publisher: 'OpenAI',
    sourceLabel: 'OpenAI official feed',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://openai.com/news/api-pricing-access',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.release_classification, 'pricing_or_access_change');
  assert.equal(result.alert.release_classification_label, 'Pricing or access change');
  assert.equal(result.alert.release_classification_scope, 'primary_vendor');
  assert.match(result.alert.release_classification_reason, /pricing/i);
});

test('selects fresh company-scoped official releases and skips stale or research coverage', () => {
  const alerts = selectLatestOfficialReleaseAlerts([
    {
      id: 'anthropic-old',
      category: 'ai',
      title: 'Claude Sonnet 4.5 launches with API availability',
      official_source: true,
      release_watch_company: 'anthropic',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'Anthropic',
      release_classification: 'model_release',
      score: 82,
      publishedAt: isoHoursAgo(24 * 7),
    },
    {
      id: 'anthropic-research',
      category: 'ai',
      title: 'Anthropic shares research on interpretability',
      official_source: true,
      release_watch_company: 'anthropic',
      release_watch_signal: 'corroborated_release',
      release_watch_company_label: 'Anthropic',
      score: 96,
      publishedAt: isoHoursAgo(1),
    },
    {
      id: 'anthropic-new',
      category: 'ai',
      title: 'Claude Sonnet 4.6 launches with API availability',
      official_source: true,
      release_watch_company: 'anthropic',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'Anthropic',
      release_classification: 'model_release',
      score: 78,
      publishedAt: isoHoursAgo(2),
    },
    {
      id: 'openai-new',
      category: 'ai',
      title: 'OpenAI launches GPT-5.1 with API availability',
      official_source: true,
      release_watch_company: 'openai',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'OpenAI',
      release_classification: 'model_release',
      score: 88,
      publishedAt: isoHoursAgo(3),
    },
  ], {
    companies: ['anthropic'],
    limit: 5,
  });

  assert.deepEqual(alerts.map((alert) => alert.id), ['anthropic-new']);
});

test('keeps model releases and drops newer general official coverage', () => {
  const alerts = selectLatestOfficialReleaseAlerts([
    {
      id: 'general-newer',
      category: 'ai',
      title: 'OpenAI shares a customer story about AI workflows',
      official_source: true,
      release_watch_company: 'openai',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'OpenAI',
      release_classification: 'general_release',
      score: 96,
      publishedAt: isoHoursAgo(2),
    },
    {
      id: 'model-older',
      category: 'ai',
      title: 'OpenAI launches GPT-5.4-Cyber',
      official_source: true,
      release_watch_company: 'openai',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'OpenAI',
      release_classification: 'model_release',
      score: 84,
      publishedAt: isoHoursAgo(24),
    },
  ], {
    companies: ['openai'],
    limit: 5,
  });

  assert.deepEqual(alerts.map((alert) => alert.id), ['model-older']);
});

test('drops cached official customer stories even when older scoring marked them as releases', () => {
  const alerts = selectLatestOfficialReleaseAlerts([
    {
      id: 'cached-customer-story',
      category: 'ai',
      title: 'How Braintrust turns customer requests into code with Codex',
      official_source: true,
      release_watch_company: 'openai',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'OpenAI',
      release_classification: 'model_release',
      score: 97,
      publishedAt: isoHoursAgo(1),
    },
  ], {
    companies: ['openai'],
    limit: 5,
  });

  assert.deepEqual(alerts, []);
});

test('rejects official case-study posts without release language', () => {
  const result = scoreAiItem({
    title: 'From hours to minutes: How Agentic AI gave marketers time back',
    description: 'AWS Marketing worked with a partner to build an agentic AI solution on Amazon Bedrock for content workflows.',
    publisher: 'AWS',
    sourceLabel: 'AWS Machine Learning feed',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://aws.amazon.com/blogs/machine-learning/from-hours-to-minutes-how-agentic-ai-gave-marketers-time-back-for-what-matters/',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
  assert.equal(result.review.rejected_reason, 'missing_strong_release_signal');
});

test('rejects official customer stories when the body mentions a newer model', () => {
  const result = scoreAiItem({
    title: 'How Braintrust turns customer requests into code with Codex',
    description: 'Braintrust explains how its team uses Codex and GPT-5.5 to move faster in production workflows.',
    publisher: 'OpenAI',
    sourceLabel: 'OpenAI official feed',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://openai.com/index/braintrust',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
  assert.equal(result.review.rejected_reason, 'missing_strong_release_signal');
});

test('rejects generic cloud infrastructure posts as model releases', () => {
  const result = scoreAiItem({
    title: 'Accelerate Generative AI Inference on Amazon SageMaker AI with G7e Instances',
    description: 'AWS explains how SageMaker AI runs generative AI inference workloads and model hosting on G7e instances.',
    publisher: 'AWS',
    sourceLabel: 'AWS Machine Learning feed',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://aws.amazon.com/blogs/machine-learning/accelerate-generative-ai-inference-on-amazon-sagemaker-ai-with-g7e-instances/',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
  assert.equal(result.review.rejected_reason, 'missing_strong_release_signal');
});

test('sorts official releases ahead of non-release coverage in the general feed', () => {
  const alerts = sortAcceptedAlerts([
    {
      id: 'press-release',
      category: 'ai',
      title: 'OpenAI launch story from press',
      official_source: false,
      release_watch_company: 'openai',
      release_watch_signal: 'corroborated_release',
      score: 99,
      publishedAt: '2026-04-18T10:00:00.000Z',
    },
    {
      id: 'official-release',
      category: 'ai',
      title: 'OpenAI launches GPT-5.1',
      official_source: true,
      release_watch_company: 'openai',
      release_watch_signal: 'official_release',
      score: 72,
      publishedAt: isoHoursAgo(1),
    },
  ]);

  assert.equal(alerts[0].id, 'official-release');
});

test('defaults official release selection to the four primary vendors', () => {
  const alerts = selectLatestOfficialReleaseAlerts([
    {
      id: 'openai-release',
      category: 'ai',
      title: 'OpenAI launches GPT-5.1',
      official_source: true,
      release_watch_company: 'openai',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'OpenAI',
      release_classification: 'model_release',
      score: 90,
      publishedAt: isoHoursAgo(1),
    },
    {
      id: 'meta-release',
      category: 'ai',
      title: 'Meta announces Llama release',
      official_source: true,
      release_watch_company: 'meta',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'Meta',
      release_classification: 'model_release',
      score: 95,
      publishedAt: isoHoursAgo(1),
    },
    {
      id: 'amazon-release',
      category: 'ai',
      title: 'AWS announces Nova release',
      official_source: true,
      release_watch_company: 'amazon',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'Amazon / AWS',
      release_classification: 'model_release',
      score: 94,
      publishedAt: isoHoursAgo(1),
    },
  ], {
    limit: 10,
  });

  assert.deepEqual(alerts.map((alert) => alert.id), ['openai-release']);
});

test('allows explicit vendor scope overrides for secondary vendors', () => {
  const alerts = selectLatestOfficialReleaseAlerts([
    {
      id: 'meta-release',
      category: 'ai',
      title: 'Meta announces Llama release',
      official_source: true,
      release_watch_company: 'meta',
      release_watch_signal: 'official_release',
      release_watch_company_label: 'Meta',
      release_classification: 'model_release',
      score: 95,
      publishedAt: isoHoursAgo(1),
    },
  ], {
    limit: 10,
    companies: ['meta'],
  });

  assert.deepEqual(alerts.map((alert) => alert.id), ['meta-release']);
});

test('rejects official research coverage without a real release signal', () => {
  const result = scoreAiItem({
    title: 'Meta research improves canopy height maps with DINO models',
    description: 'AI at Meta shares research collaboration results for canopy height estimation.',
    publisher: 'Meta AI',
    sourceLabel: 'Meta AI blog',
    sourceHint: 'official',
    category: 'ai',
    link: 'https://ai.meta.com/blog/world-resources-institute-dino-canopy-height-maps-v2/',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
  assert.equal(result.review.rejected_reason, 'missing_strong_release_signal');
});

test('rejects AI funding coverage even when it mentions a model company', () => {
  const result = scoreAiItem({
    title: 'Anthropic funding round lifts valuation after enterprise demand',
    description: 'Analysis of Anthropic funding, valuation, and partnership activity.',
    publisher: 'Reuters',
    sourceLabel: 'AI major corroboration',
    sourceHint: 'press',
    category: 'ai',
    link: 'https://www.reuters.com/world/anthropic-funding-round',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
  assert.equal(result.review.rejected_reason, 'negative_or_non_product_coverage');
});

test('accepts a confirmed Anthropic investable-shares alert from high-trust press', () => {
  const result = scoreAiItem({
    title: 'Anthropic files registration statement for initial public offering',
    description: 'Reuters reports that Anthropic filed an S-1 registration statement and plans to list shares under a stock ticker.',
    publisher: 'Reuters',
    sourceLabel: 'AI public investment access',
    sourceHint: 'press',
    category: 'ai',
    link: 'https://www.reuters.com/technology/anthropic-files-s-1',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.release_watch_signal, 'direct_news_notification');
  assert.equal(result.alert.direct_notification_source_id, 'anthropic');
  assert.equal(result.alert.release_classification, 'investment_access_change');
  assert.equal(result.alert.priority_tag, 'investment_access');
});

test('rejects speculative Anthropic IPO chatter without a hard filing or listing fact', () => {
  const result = scoreAiItem({
    title: 'Anthropic may consider an IPO after funding round',
    description: 'Reuters discusses valuation and possible public-market plans without any filing or listing.',
    publisher: 'Reuters',
    sourceLabel: 'AI public investment access',
    sourceHint: 'press',
    category: 'ai',
    link: 'https://www.reuters.com/technology/anthropic-may-consider-ipo',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
  assert.equal(result.review.rejected_reason, 'negative_or_non_product_coverage');
});

test('accepts official King Abdullah Schools application announcement as a direct notification', () => {
  const result = scoreAiItem({
    title: 'King Abdullah Schools of Excellence application opens',
    description: 'The Jordan Ministry of Education receives applications through an official application link and announces the deadline and test date.',
    publisher: 'Jordan Ministry of Education',
    sourceLabel: 'Jordan Ministry of Education news',
    sourceHint: 'official',
    category: 'opportunity',
    link: 'https://www.moe.gov.jo/ar/news/example',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.release_watch_signal, 'direct_news_notification');
  assert.equal(result.alert.direct_notification_source_id, 'king_abdullah_schools');
  assert.equal(result.alert.priority_tag, 'opportunity_deadline');
});

test('rejects King Abdullah Schools background coverage without an application trigger', () => {
  const result = scoreAiItem({
    title: 'King Abdullah Schools of Excellence student activity',
    description: 'A general school activity and student celebration inside the school.',
    publisher: 'Jordan Ministry of Education',
    sourceLabel: 'Jordan Ministry of Education news',
    sourceHint: 'official',
    category: 'opportunity',
    link: 'https://www.moe.gov.jo/ar/news/background',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
});

test('rejects an indirect Qatar travel warning story', () => {
  const result = scoreGeoItem({
    title: 'Travel warning updated for Qatar amid regional security concerns',
    description: 'Officials issued a travel warning and advised caution for visitors.',
    publisher: 'BBC',
    sourceLabel: 'Iran or Qatar escalation',
    sourceHint: 'press',
    category: 'geo',
    link: 'https://www.bbc.com/news/world-middle-east-qatar-warning',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
  assert.equal(result.review.rejected_reason, 'geo_signal_too_indirect');
});

test('accepts a direct Iran escalation story with missile and airspace disruption', () => {
  const result = scoreGeoItem({
    title: 'Missile attack prompts airspace disruption around Iran and Gulf bases',
    description: 'Reuters reports missile fire, military response, and airspace disruption affecting regional bases.',
    publisher: 'Reuters',
    sourceLabel: 'Iran or Qatar escalation',
    sourceHint: 'press',
    category: 'geo',
    link: 'https://www.reuters.com/world/middle-east/iran-missile-airspace',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.notEqual(result.alert.threatLevel, 'Low');
  // Iran is explicitly mentioned in the title — elevated to high_priority with jordan_relevance
  assert.equal(result.alert.priority_tag, 'high_priority');
  assert.ok(result.alert.priority_tags.includes('high_priority'));
  assert.ok(result.alert.priority_tags.includes('jordan_relevance:security'));
});

test('accepts a major political event and tags it separately from regional impact', () => {
  const result = scoreGeoItem({
    title: 'Reuters: President resigns after assassination and parliament vote',
    description: 'Reuters reports a major political crisis after an assassination, resignation, and emergency parliamentary vote.',
    publisher: 'Reuters',
    sourceLabel: 'World News',
    sourceHint: 'press',
    category: 'geo',
    link: 'https://www.reuters.com/world/president-resigns-assassination-parliament-vote',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.priority_tag, 'major_political');
  assert.deepEqual(result.alert.priority_tags, ['major_political']);
  assert.equal(result.alert.alert_kind, 'major_political_event');
  assert.match(result.alert.whyItMatters, /political/i);
});

test('keeps unrelated same-title alerts from different hosts separate during dedupe', () => {
  const alerts = dedupeAlerts([
    {
      id: 'official-1',
      category: 'ai',
      title: 'OpenAI launches GPT-5',
      url: 'https://openai.com/index/gpt-5',
      score: 92,
      official_source: true,
    },
    {
      id: 'press-1',
      category: 'ai',
      title: 'OpenAI launches GPT-5',
      url: 'https://www.theverge.com/2026/03/24/openai-launches-gpt-5',
      score: 76,
      official_source: false,
    },
  ]);

  assert.equal(alerts.length, 2);
});

test('balances mixed alerts by leading score instead of always starting with geo', () => {
  const alerts = balanceAlerts([
    { id: 'geo-1', category: 'geo', score: 40 },
    { id: 'ai-1', category: 'ai', score: 95 },
    { id: 'ai-2', category: 'ai', score: 84 },
  ]);

  assert.equal(alerts[0].id, 'ai-1');
  assert.equal(alerts[1].id, 'geo-1');
});

test('rejects King Abdullah Schools old-year (2025) page', () => {
  const result = scoreAiItem({
    title: 'King Abdullah Schools of Excellence 2025 admission applications',
    description: 'Archive page containing the 2025 registration link and test dates.',
    publisher: 'Jordan Ministry of Education',
    sourceLabel: 'Jordan Ministry of Education news',
    sourceHint: 'official',
    category: 'opportunity',
    link: 'https://www.moe.gov.jo/ar/news/example-2025',
    publishedAt: new Date().toISOString(),
  });

  assert.equal(result.alert, null);
});

test('accepts new 2026/2027 King Abdullah Schools application with Direct priority', () => {
  const result = scoreAiItem({
    title: 'King Abdullah Schools of Excellence 2026/2027 application window',
    description: 'Register now for the new 2026/2027 academic year. Deadline and test date announced.',
    publisher: 'Jordan Ministry of Education',
    sourceLabel: 'Jordan Ministry of Education news',
    sourceHint: 'official',
    category: 'opportunity',
    link: 'https://www.moe.gov.jo/ar/news/example-2026',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(result.alert);
  assert.equal(result.alert.priority, 'Direct');
});

test('ensures geopolitical risk alerts from Jordan/Iran qualify under high priority and tag Jordan Relevance', () => {
  // Security relevance
  const resultSecurity = scoreGeoItem({
    title: 'Tension increases along the Jordan border as military intercepts drone strike',
    description: 'Military forces intercepted a drone strike near the border today.',
    publisher: 'Reuters',
    sourceLabel: 'Israel/Iran/Jordan escalation',
    sourceHint: 'press',
    category: 'geo',
    link: 'https://www.reuters.com/world/middle-east/jordan-drone-intercept',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(resultSecurity.alert);
  assert.notEqual(resultSecurity.alert.threatLevel, 'Low');
  assert.equal(resultSecurity.alert.importance, 'major');
  assert.equal(resultSecurity.alert.priority, 'High');
  assert.equal(resultSecurity.alert.jordan_relevance, 'security');
  assert.ok(resultSecurity.alert.priority_tags.includes('high_priority'));
  assert.ok(resultSecurity.alert.priority_tags.includes('jordan_relevance:security'));

  // Economic relevance
  const resultEconomic = scoreGeoItem({
    title: 'Iran oil production disruption raises energy prices',
    description: 'A major oil and gas market threat raises global energy costs.',
    publisher: 'Bloomberg',
    sourceLabel: 'Israel/Iran/Jordan escalation',
    sourceHint: 'press',
    category: 'geo',
    link: 'https://www.bloomberg.com/news/iran-oil-disruption',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(resultEconomic.alert);
  assert.equal(resultEconomic.alert.jordan_relevance, 'economic');
  assert.ok(resultEconomic.alert.priority_tags.includes('jordan_relevance:economic'));

  // Action relevance
  const resultAction = scoreGeoItem({
    title: 'Iran issues airspace warning and temporary flight closure restriction',
    description: 'Airspace closure alert restricts civilian flights.',
    publisher: 'Reuters',
    sourceLabel: 'Israel/Iran/Jordan escalation',
    sourceHint: 'press',
    category: 'geo',
    link: 'https://www.reuters.com/world/middle-east/iran-airspace-closure',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(resultAction.alert);
  assert.equal(resultAction.alert.jordan_relevance, 'action');
  assert.ok(resultAction.alert.priority_tags.includes('jordan_relevance:action'));
});
