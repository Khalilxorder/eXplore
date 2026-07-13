'use strict';

const AI_ADVANTAGE_SOURCES = [
  {
    id: 'openai-news',
    label: 'OpenAI News',
    url: 'https://openai.com/news/',
    feedUrl: 'https://openai.com/news/rss.xml',
    sourceType: 'official',
    monitorType: 'rss',
    priority: 'critical',
    watchFor: ['model releases', 'API access', 'pricing', 'safety policy'],
  },
  {
    id: 'openai-research',
    label: 'OpenAI Research',
    url: 'https://openai.com/research/',
    sourceType: 'official',
    monitorType: 'landing_page',
    priority: 'high',
    watchFor: ['capability jumps', 'evaluation signals', 'agent research'],
  },
  {
    id: 'anthropic-news',
    label: 'Anthropic News',
    url: 'https://www.anthropic.com/news',
    sourceType: 'official',
    monitorType: 'landing_page',
    priority: 'critical',
    watchFor: ['Claude releases', 'developer access', 'enterprise features'],
  },
  {
    id: 'google-ai-blog',
    label: 'Google AI Blog',
    url: 'https://blog.google/technology/ai/',
    feedUrl: 'https://blog.google/technology/ai/rss/',
    sourceType: 'official',
    monitorType: 'rss',
    priority: 'critical',
    watchFor: ['Gemini releases', 'consumer rollout', 'research-to-product changes'],
  },
  {
    id: 'google-deepmind-blog',
    label: 'Google DeepMind Blog',
    url: 'https://deepmind.google/discover/blog/',
    sourceType: 'official',
    monitorType: 'landing_page',
    priority: 'critical',
    watchFor: ['frontier capability', 'science systems', 'agentic research'],
  },
  {
    id: 'google-ai-developers',
    label: 'Google AI Developers',
    url: 'https://developers.googleblog.com/en/search/?technology_categories=AI',
    sourceType: 'developer',
    monitorType: 'landing_page',
    priority: 'high',
    watchFor: ['SDK releases', 'Gemini API changes', 'tooling updates'],
  },
  {
    id: 'meta-ai-blog',
    label: 'Meta AI Blog',
    url: 'https://ai.meta.com/blog/',
    sourceType: 'official',
    monitorType: 'landing_page',
    priority: 'high',
    watchFor: ['Llama releases', 'open model strategy', 'research drops'],
  },
  {
    id: 'microsoft-ai-blog',
    label: 'Microsoft AI Blog',
    url: 'https://blogs.microsoft.com/ai/',
    feedUrl: 'https://blogs.microsoft.com/ai/feed/',
    sourceType: 'official',
    monitorType: 'rss',
    priority: 'high',
    watchFor: ['Copilot shifts', 'enterprise adoption', 'platform releases'],
  },
  {
    id: 'azure-ai-blog',
    label: 'Azure AI Blog',
    url: 'https://techcommunity.microsoft.com/category/ai/blog/azure-ai-services-blog',
    sourceType: 'developer',
    monitorType: 'landing_page',
    priority: 'medium',
    watchFor: ['cloud AI services', 'deployment primitives', 'enterprise controls'],
  },
  {
    id: 'aws-machine-learning',
    label: 'AWS Machine Learning Blog',
    url: 'https://aws.amazon.com/blogs/machine-learning/',
    feedUrl: 'https://aws.amazon.com/blogs/machine-learning/feed/',
    sourceType: 'developer',
    monitorType: 'rss',
    priority: 'medium',
    watchFor: ['Bedrock releases', 'Nova updates', 'deployment economics'],
  },
  {
    id: 'xai-news',
    label: 'xAI News',
    url: 'https://x.ai/news',
    sourceType: 'official',
    monitorType: 'landing_page',
    priority: 'critical',
    watchFor: ['Grok releases', 'API access', 'voice or agent releases'],
  },
  {
    id: 'mistral-news',
    label: 'Mistral AI News',
    url: 'https://mistral.ai/news/',
    sourceType: 'official',
    monitorType: 'landing_page',
    priority: 'high',
    watchFor: ['open model releases', 'enterprise deployments', 'European AI strategy'],
  },
  {
    id: 'huggingface-blog',
    label: 'Hugging Face Blog',
    url: 'https://huggingface.co/blog',
    feedUrl: 'https://huggingface.co/blog/feed.xml',
    sourceType: 'developer',
    monitorType: 'rss',
    priority: 'high',
    watchFor: ['model releases', 'open-source tooling', 'developer workflows'],
  },
  {
    id: 'huggingface-models-api',
    label: 'Hugging Face Models API',
    url: 'https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=30&full=true',
    sourceType: 'developer',
    monitorType: 'api',
    priority: 'high',
    watchFor: ['fast-rising models', 'high-download releases', 'new model families'],
  },
  {
    id: 'huggingface-spaces-api',
    label: 'Hugging Face Spaces API',
    url: 'https://huggingface.co/api/spaces?sort=lastModified&direction=-1&limit=24&full=true',
    sourceType: 'developer',
    monitorType: 'api',
    priority: 'medium',
    watchFor: ['new AI apps', 'demo velocity', 'tool prototypes'],
  },
  {
    id: 'nvidia-ai-blog',
    label: 'NVIDIA AI Blog',
    url: 'https://blogs.nvidia.com/blog/category/deep-learning/',
    sourceType: 'official',
    monitorType: 'landing_page',
    priority: 'high',
    watchFor: ['GPU platform shifts', 'inference economics', 'robotics or data-center releases'],
  },
  {
    id: 'github-ai-blog',
    label: 'GitHub AI Blog',
    url: 'https://github.blog/ai-and-ml/',
    sourceType: 'developer',
    monitorType: 'landing_page',
    priority: 'medium',
    watchFor: ['coding agents', 'Copilot changes', 'developer adoption'],
  },
  {
    id: 'arxiv-ai',
    label: 'arXiv AI and Machine Learning',
    url: 'https://arxiv.org/list/cs.AI/recent',
    sourceType: 'research',
    monitorType: 'landing_page',
    priority: 'medium',
    watchFor: ['new architectures', 'benchmark shifts', 'agent research'],
  },
  {
    id: 'semianalysis',
    label: 'SemiAnalysis',
    url: 'https://www.semianalysis.com/',
    sourceType: 'analysis',
    monitorType: 'landing_page',
    priority: 'high',
    watchFor: ['AI infrastructure economics', 'chip supply', 'data-center constraints'],
  },
  {
    id: 'the-batch',
    label: 'The Batch by DeepLearning.AI',
    url: 'https://www.deeplearning.ai/the-batch/',
    sourceType: 'analysis',
    monitorType: 'newsletter',
    priority: 'medium',
    watchFor: ['industry summaries', 'research translation', 'practical adoption'],
  },
];

const EVENT_SOURCE_MAP = {
  version: '2026-06-04',
  scope: 'event_only_intelligence',
  description: 'Reusable source registry for high-signal event lanes. It maps what to watch, where to watch it, and the default questions each lane should answer before notifying.',
  lanes: [
    {
      id: 'war',
      label: 'War',
      priority: 1,
      intent: 'Detect direct geopolitical escalation, conflict spread, civilian risk, and travel or regional disruption.',
      defaultWatchQuestions: [
        'Did a direct military action, retaliation, strike, invasion, assassination, or mobilization happen?',
        'Did a watched country leader make a confirmed decision, official statement, policy shift, travel move, or diplomatic action?',
        'Does the event affect Jordan, Qatar, Hungary, the EU, the United States, or nearby travel routes?',
        'Is this confirmed by official statements or high-trust press rather than commentary?',
        'What changed from yesterday that requires attention now?',
      ],
      sources: [
        { id: 'reuters-world', label: 'Reuters World', url: 'https://www.reuters.com/world/', sourceType: 'press', monitorType: 'landing_page', priority: 'critical' },
        { id: 'ap-world', label: 'AP World News', url: 'https://apnews.com/world-news', sourceType: 'press', monitorType: 'landing_page', priority: 'critical' },
        { id: 'bbc-world', label: 'BBC World', url: 'https://www.bbc.com/news/world', sourceType: 'press', monitorType: 'landing_page', priority: 'high' },
        { id: 'reuters-politics', label: 'Reuters Politics', url: 'https://www.reuters.com/world/', sourceType: 'press', monitorType: 'landing_page', priority: 'high', watchFor: ['leaders', 'policy decisions', 'diplomacy'] },
        { id: 'un-press', label: 'UN Press', url: 'https://press.un.org/en', sourceType: 'official', monitorType: 'landing_page', priority: 'high', watchFor: ['official statements', 'security council', 'diplomacy'] },
        { id: 'isw', label: 'Institute for the Study of War', url: 'https://www.understandingwar.org/', sourceType: 'analysis', monitorType: 'landing_page', priority: 'high' },
        { id: 'aljazeera-middle-east', label: 'Al Jazeera Middle East', url: 'https://www.aljazeera.com/middle-east/', sourceType: 'press', monitorType: 'landing_page', priority: 'high' },
      ],
    },
    {
      id: 'ai_advantage',
      label: 'AI Advantage',
      priority: 2,
      intent: 'Detect AI releases, capability jumps, cost/access changes, investment access, and developer leverage before they become generic news.',
      defaultWatchQuestions: [
        'What changed in model capability, access, cost, latency, tooling, or deployment power?',
        'Does this create a real advantage for building, research, income, learning, or investment awareness?',
        'Is the signal official, developer-verifiable, or corroborated by high-trust analysis?',
        'What should be tried, watched, ignored, or saved this week?',
      ],
      sources: AI_ADVANTAGE_SOURCES,
    },
    {
      id: 'markets',
      label: 'Markets',
      priority: 3,
      intent: 'Detect market-moving events that affect AI companies, public equities, labor, inflation, rates, or investable access.',
      defaultWatchQuestions: [
        'Did prices, rates, filings, earnings, guidance, or regulation materially change?',
        'Does the event affect AI infrastructure, public technology companies, or personal opportunity timing?',
        'Is there a direct filing, official release, or high-trust market report?',
        'What is the practical action: watch, compare, save, or ignore?',
      ],
      sources: [
        { id: 'reuters-markets', label: 'Reuters Markets', url: 'https://www.reuters.com/markets/', sourceType: 'press', monitorType: 'landing_page', priority: 'critical' },
        { id: 'sec-edgar', label: 'SEC EDGAR', url: 'https://www.sec.gov/edgar/search/', sourceType: 'official', monitorType: 'search', priority: 'critical' },
        { id: 'cnbc-markets', label: 'CNBC Markets', url: 'https://www.cnbc.com/markets/', sourceType: 'press', monitorType: 'landing_page', priority: 'high' },
        { id: 'nasdaq-news', label: 'Nasdaq News', url: 'https://www.nasdaq.com/news-and-insights', sourceType: 'market', monitorType: 'landing_page', priority: 'medium' },
      ],
    },
    {
      id: 'art_meaning',
      label: 'Art/Meaning',
      priority: 4,
      intent: 'Detect cultural, psychological, philosophical, and creative signals that shape meaning, taste, and long-term direction.',
      defaultWatchQuestions: [
        'Does this change how people understand meaning, identity, attention, creativity, or beauty?',
        'Does it connect to psychology, religion, narrative, art, or human development?',
        'Is the source reflective and durable rather than viral commentary?',
        'Should this influence writing, design, research taste, or personal worldview?',
      ],
      sources: [
        { id: 'aeon', label: 'Aeon', url: 'https://aeon.co/', sourceType: 'essay', monitorType: 'landing_page', priority: 'high' },
        { id: 'psyche', label: 'Psyche', url: 'https://psyche.co/', sourceType: 'essay', monitorType: 'landing_page', priority: 'high' },
        { id: 'artsy', label: 'Artsy Editorial', url: 'https://www.artsy.net/articles', sourceType: 'arts', monitorType: 'landing_page', priority: 'medium' },
        { id: 'mit-technology-review-ai-society', label: 'MIT Technology Review AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/', sourceType: 'press', monitorType: 'landing_page', priority: 'medium' },
      ],
    },
    {
      id: 'personal_opportunities',
      label: 'Personal Opportunities',
      priority: 5,
      intent: 'Detect scholarships, labs, internships, research roles, remote jobs, and time-sensitive opportunities that match the user profile.',
      defaultWatchQuestions: [
        'Is the opportunity real, currently open, and suitable for the user profile?',
        'What is the deadline, eligibility gate, location, funding level, and application burden?',
        'Does it connect to AI, psychology, cognitive science, research, scholarships, or remote work?',
        'What is the next concrete application action?',
      ],
      sources: [
        { id: 'euraxess', label: 'EURAXESS', url: 'https://euraxess.ec.europa.eu/jobs', sourceType: 'official', monitorType: 'search', priority: 'critical' },
        { id: 'jordan-moe-king-abdullah-schools', label: 'Jordan Ministry of Education - King Abdullah Schools', url: 'https://www.moe.gov.jo/ar/news', sourceType: 'official', monitorType: 'direct_opportunity', priority: 'critical' },
        { id: 'daad-scholarships', label: 'DAAD Scholarship Database', url: 'https://www.daad.de/en/study-and-research-in-germany/scholarships/', sourceType: 'official', monitorType: 'search', priority: 'high' },
        { id: 'scholarshipportal', label: 'ScholarshipPortal', url: 'https://www.scholarshipportal.com/', sourceType: 'opportunity_index', monitorType: 'search', priority: 'high' },
        { id: 'remoteok', label: 'Remote OK', url: 'https://remoteok.com/', sourceType: 'job_board', monitorType: 'search', priority: 'medium' },
        { id: 'huggingface-jobs', label: 'Hugging Face Jobs', url: 'https://apply.workable.com/huggingface/', sourceType: 'job_board', monitorType: 'landing_page', priority: 'medium' },
      ],
    },
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLaneId(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function getEventSourceMap() {
  return clone(EVENT_SOURCE_MAP);
}

function getLaneSourceMap(laneId = '') {
  const normalized = normalizeLaneId(laneId);
  const lane = EVENT_SOURCE_MAP.lanes.find((entry) => entry.id === normalized);
  return lane ? clone(lane) : null;
}

function getEventSourceMapSummary() {
  const sourceCount = EVENT_SOURCE_MAP.lanes.reduce((sum, lane) => sum + lane.sources.length, 0);
  return {
    version: EVENT_SOURCE_MAP.version,
    scope: EVENT_SOURCE_MAP.scope,
    laneCount: EVENT_SOURCE_MAP.lanes.length,
    sourceCount,
    aiAdvantageSourceCount: AI_ADVANTAGE_SOURCES.length,
    lanes: EVENT_SOURCE_MAP.lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      priority: lane.priority,
      sourceCount: lane.sources.length,
      defaultWatchQuestionCount: lane.defaultWatchQuestions.length,
    })),
  };
}

module.exports = {
  getEventSourceMap,
  getEventSourceMapSummary,
  getLaneSourceMap,
  normalizeLaneId,
};
