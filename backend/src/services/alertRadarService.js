'use strict';

const crypto = require('crypto');

const CACHE_TTL_MS = 60 * 1000;
const MAX_ITEMS_PER_FEED = 30;
const MAX_CACHED_ALERTS = 60;
const MAX_ITEMS_PER_OFFICIAL_PAGE = 6;
const GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search';
const MAX_REVIEW_LOG_ITEMS = 400;
const HUGGING_FACE_MODELS_URL = 'https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=24';
const HUGGING_FACE_SPACES_URL = 'https://huggingface.co/api/spaces?sort=createdAt&direction=-1&limit=24';
const DEFAULT_DIRECT_OFFICIAL_FEEDS = [
  {
    label: 'OpenAI official feed',
    kind: 'rss',
    feedUrl: 'https://openai.com/news/rss.xml',
    publisher: 'OpenAI',
  },
  {
    label: 'Anthropic news',
    kind: 'official_landing_page',
    landingUrl: 'https://www.anthropic.com/news',
    publisher: 'Anthropic',
    articlePrefixes: ['https://www.anthropic.com/news/'],
    articleLimit: MAX_ITEMS_PER_OFFICIAL_PAGE,
  },
  {
    label: 'Google AI official feed',
    kind: 'rss',
    feedUrl: 'https://blog.google/technology/ai/rss/',
    publisher: 'Google',
  },
  {
    label: 'xAI news',
    kind: 'official_landing_page',
    landingUrl: 'https://x.ai/news',
    publisher: 'xAI',
    articlePrefixes: ['https://x.ai/news/'],
    articleLimit: MAX_ITEMS_PER_OFFICIAL_PAGE,
  },
  {
    label: 'Meta AI blog',
    kind: 'official_landing_page',
    landingUrl: 'https://ai.meta.com/blog/',
    publisher: 'Meta AI',
    articlePrefixes: ['https://ai.meta.com/blog/'],
    excludePatterns: [/\/subscribe\/?$/i],
    articleLimit: MAX_ITEMS_PER_OFFICIAL_PAGE,
  },
  {
    label: 'Microsoft AI official feed',
    kind: 'rss',
    feedUrl: 'https://blogs.microsoft.com/ai/feed/',
    publisher: 'Microsoft',
  },
  {
    label: 'AWS Machine Learning feed',
    kind: 'rss',
    feedUrl: 'https://aws.amazon.com/blogs/machine-learning/feed/',
    publisher: 'AWS',
  },
  {
    label: 'Hugging Face blog feed',
    kind: 'rss',
    feedUrl: 'https://huggingface.co/blog/feed.xml',
    publisher: 'Hugging Face',
  },
  {
    label: 'Mistral AI news',
    kind: 'official_landing_page',
    landingUrl: 'https://mistral.ai/news/',
    publisher: 'Mistral AI',
    articlePrefixes: ['https://mistral.ai/news/'],
    articleLimit: MAX_ITEMS_PER_OFFICIAL_PAGE,
  },
  {
    label: 'Stability AI news',
    kind: 'official_landing_page',
    landingUrl: 'https://stability.ai/news-updates',
    publisher: 'Stability AI',
    articlePrefixes: ['https://stability.ai/news-updates/'],
    articleLimit: MAX_ITEMS_PER_OFFICIAL_PAGE,
  },
  {
    label: 'Jordan Ministry of Education news',
    kind: 'official_landing_page',
    landingUrl: 'https://www.moe.gov.jo/ar/news',
    publisher: 'Jordan Ministry of Education',
    articlePrefixes: ['https://www.moe.gov.jo/ar/news', 'https://moe.gov.jo/ar/news', 'https://www.moe.gov.jo/ar/content', 'https://moe.gov.jo/ar/content'],
    articleLimit: MAX_ITEMS_PER_OFFICIAL_PAGE,
  },
  {
    label: 'Jordan Ministry of Education Facebook',
    kind: 'official_landing_page',
    landingUrl: 'https://www.facebook.com/MinistryOfEducationJordan',
    publisher: 'Jordan Ministry of Education',
    articlePrefixes: ['https://www.facebook.com/'],
    articleLimit: MAX_ITEMS_PER_OFFICIAL_PAGE,
  },
];
const DEFAULT_DIRECT_PRESS_FEEDS = [
  'https://feeds.reuters.com/reuters/technologyNews',
  'https://feeds.reuters.com/reuters/worldNews',
];
const HUGGING_FACE_MODELS_API = 'https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=30&full=true';
const HUGGING_FACE_SPACES_API = 'https://huggingface.co/api/spaces?sort=lastModified&direction=-1&limit=24&full=true';

const SOURCE_DEFINITIONS = [
  {
    id: 'ai-official',
    category: 'ai',
    sourceType: 'official',
    label: 'AI official announcements',
    query:
      '(site:openai.com OR site:anthropic.com OR site:deepmind.google OR site:blog.google OR site:about.fb.com OR site:ai.meta.com OR site:blogs.microsoft.com OR site:microsoft.com OR site:x.ai OR site:aws.amazon.com OR site:huggingface.co OR site:vercel.com OR site:mistral.ai OR site:stability.ai) ' +
      '(model OR release OR launch OR update OR API OR agent OR reasoning OR multimodal OR tool OR app) when:7d',
  },
  {
    id: 'ai-press',
    category: 'ai',
    sourceType: 'press',
    label: 'AI major corroboration',
    query:
      '((site:reuters.com OR site:bloomberg.com OR site:ft.com OR site:wsj.com OR site:theverge.com OR site:techcrunch.com OR site:wired.com OR site:cnbc.com OR site:apnews.com OR site:bbc.com) ' +
      '(OpenAI OR Anthropic OR "Google DeepMind" OR Gemini OR "Meta AI" OR Llama OR Microsoft OR Copilot OR xAI OR Grok OR Amazon OR Bedrock OR Nova OR "Hugging Face" OR Mistral OR "Stability AI" OR "Stable Diffusion" OR "Stable Audio")) ' +
      '(release OR launch OR announced OR unveiled OR introduced OR pricing OR availability OR API OR reasoning OR multimodal OR benchmark OR tool) when:7d',
  },
  {
    id: 'ai-investable-shares',
    category: 'ai',
    sourceType: 'press',
    label: 'AI public investment access',
    query:
      '((OpenAI OR Anthropic OR "Google DeepMind" OR Gemini OR xAI OR Grok) ' +
      '("initial public offering" OR IPO OR "direct listing" OR "public shares" OR "stock ticker" OR "ticker symbol" OR "S-1" OR "registration statement" OR "begins trading" OR "shares listed")) ' +
      '(site:reuters.com OR site:bloomberg.com OR site:ft.com OR site:wsj.com OR site:cnbc.com OR site:sec.gov OR site:openai.com OR site:anthropic.com OR site:x.ai OR site:deepmind.google OR site:blog.google) when:30d',
  },
  {
    id: 'geo-high-trust',
    category: 'geo',
    sourceType: 'press',
    label: 'Israel/Iran/Jordan escalation',
    query:
      '((site:reuters.com OR site:apnews.com OR site:bbc.com OR site:ft.com OR site:bloomberg.com OR site:wsj.com OR site:aljazeera.com) ' +
      '(Israel OR Iran OR Qatar OR Jordan)) ' +
      '(war OR strike OR missile OR attack OR retaliation OR mobilization OR evacuation OR airspace OR border OR military OR base OR warning) when:7d',
  },
  {
    id: 'huggingface-models',
    category: 'ai',
    sourceType: 'official',
    label: 'Hugging Face models',
    kind: 'huggingface_models',
  },
  {
    id: 'huggingface-spaces',
    category: 'ai',
    sourceType: 'official',
    label: 'Hugging Face spaces',
    kind: 'huggingface_spaces',
  },
  {
    id: 'science-discovery',
    category: 'science',
    sourceType: 'press',
    label: 'Science & DNA Breakthroughs',
    query:
      '((site:nature.com OR site:sciencemag.org OR site:technologyreview.com OR site:quantamagazine.org OR site:sciencedaily.com OR site:newscientist.com OR site:statnews.com) ' +
      '(DNA OR genetics OR genome OR CRISPR OR "protein folding" OR "scientific discovery" OR breakthrough OR AI)) ' +
      '(discovered OR developed OR breakthrough OR engineered OR sequenced OR mapped OR "artificial intelligence" OR AlphaFold) when:7d',
  },
];

const OFFICIAL_AI_SOURCE_PATTERNS = [
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bdeepmind\b/i,
  /\bgoogle\b/i,
  /\bmeta\b/i,
  /\bmicrosoft\b/i,
  /\bxai\b/i,
  /\bamazon\b/i,
  /\baws\b/i,
  /\bhugging\s*face\b/i,
  /\bmistral\b/i,
  /\bstability\s*ai\b/i,
  /\bstable\s+(?:diffusion|audio|video|image)\b/i,
];

const HIGH_TRUST_PRESS_PATTERNS = [
  /\breuters\b/i,
  /\bbloomberg\b/i,
  /\bfinancial times\b/i,
  /\bwall street journal\b/i,
  /\bwsj\b/i,
  /\bap news\b/i,
  /\bassociated press\b/i,
  /\bbbc\b/i,
  /\bthe verge\b/i,
  /\btechcrunch\b/i,
  /\bcnbc\b/i,
  /\bwired\b/i,
  /\bal jazeera\b/i,
  /\bsec\b/i,
];

const OFFICIAL_SOURCE_HOST_PATTERNS = [
  /(^|\.)openai\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)deepmind\.google$/i,
  /(^|\.)blog\.google$/i,
  /(^|\.)about\.fb\.com$/i,
  /(^|\.)ai\.meta\.com$/i,
  /(^|\.)blogs\.microsoft\.com$/i,
  /(^|\.)microsoft\.com$/i,
  /(^|\.)x\.ai$/i,
  /(^|\.)aws\.amazon\.com$/i,
  /(^|\.)huggingface\.co$/i,
  /(^|\.)stability\.ai$/i,
  /(^|\.)moe\.gov\.jo$/i,
];

const HIGH_TRUST_PRESS_HOST_PATTERNS = [
  /(^|\.)reuters\.com$/i,
  /(^|\.)bloomberg\.com$/i,
  /(^|\.)ft\.com$/i,
  /(^|\.)wsj\.com$/i,
  /(^|\.)apnews\.com$/i,
  /(^|\.)bbc\.com$/i,
  /(^|\.)theverge\.com$/i,
  /(^|\.)techcrunch\.com$/i,
  /(^|\.)cnbc\.com$/i,
  /(^|\.)wired\.com$/i,
  /(^|\.)aljazeera\.com$/i,
  /(^|\.)sec\.gov$/i,
];

const AI_COMPANY_PATTERNS = [
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bgoogle\b/i,
  /\bgemini\b/i,
  /\bdeepmind\b/i,
  /\bmeta\b/i,
  /\bllama\b/i,
  /\bmicrosoft\b/i,
  /\bcopilot\b/i,
  /\bxai\b/i,
  /\bgrok\b/i,
  /\bamazon\b/i,
  /\bbedrock\b/i,
  /\bnova\b/i,
  /\bhugging\s*face\b/i,
  /\bstability\s*ai\b/i,
  /\bstable\s+(?:diffusion|audio|video|image)\b/i,
];

const AI_RELEASE_WATCH_COMPANIES = [
  {
    id: 'openai',
    label: 'OpenAI',
    companyPatterns: [/\bopenai\b/i, /\bgpt\b/i, /\bo[0-9]+\b/i, /\bchatgpt\b/i, /\bsora\b/i],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    companyPatterns: [/\banthropic\b/i, /\bclaude\b/i, /\bmythos\b/i, /\bsonnet\b/i, /\bopus\b/i, /\bhaiku\b/i],
  },
  {
    id: 'google',
    label: 'Google / DeepMind',
    companyPatterns: [/\bgoogle\b/i, /\bdeepmind\b/i, /\bgemini\b/i, /\bveo\b/i, /\bimagen\b/i],
  },
  {
    id: 'meta',
    label: 'Meta / Llama',
    companyPatterns: [/\bmeta\b/i, /\bllama\b/i, /\bllama\s*\d/i],
  },
  {
    id: 'microsoft',
    label: 'Microsoft',
    companyPatterns: [/\bmicrosoft\b/i, /\bcopilot\b/i, /\bphi[-\s]?\d/i],
  },
  {
    id: 'xai',
    label: 'xAI',
    companyPatterns: [/\bxai\b/i, /\bgrok\b/i, /\bx\.ai\b/i],
  },
  {
    id: 'amazon',
    label: 'Amazon / AWS',
    companyPatterns: [/\bamazon\b/i, /\baws\b/i, /\bbedrock\b/i, /\bnova\b/i],
  },
  {
    id: 'hugging_face',
    label: 'Hugging Face',
    companyPatterns: [/\bhugging\s*face\b/i],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    companyPatterns: [/\bmistral\b/i, /\bmixtral\b/i, /\bcodal\b/i, /\bministral\b/i],
  },
  {
    id: 'stability_ai',
    label: 'Stability AI',
    companyPatterns: [
      /\bstability\s*ai\b/i,
      /\bstable\s+(?:diffusion|audio|video|image)\b/i,
      /\bsd(?:xl|3|4|5)\b/i,
    ],
  },
];

const DEFAULT_RELEASE_WATCH_COMPANY_IDS = new Set(['openai', 'anthropic', 'google', 'xai']);
const PRIMARY_RELEASE_WATCH_COMPANY_IDS = new Set(['openai', 'anthropic', 'google', 'xai', 'meta', 'microsoft', 'mistral', 'amazon', 'hugging_face', 'stability_ai']);

const RADAR_REFERENCE_POINTS = [
  {
    id: 'openai-official',
    companyId: 'openai',
    label: 'OpenAI News',
    publisher: 'OpenAI',
    sourceType: 'official',
    url: 'https://openai.com/news/',
    feedUrl: 'https://openai.com/news/rss.xml',
    monitorType: 'official_release',
    alwaysMonitored: true,
  },
  {
    id: 'anthropic-official',
    companyId: 'anthropic',
    label: 'Anthropic News',
    publisher: 'Anthropic',
    sourceType: 'official',
    url: 'https://www.anthropic.com/news',
    monitorType: 'official_release',
    alwaysMonitored: true,
  },
  {
    id: 'google-ai-official',
    companyId: 'google',
    label: 'Google AI Blog',
    publisher: 'Google / Gemini / DeepMind',
    sourceType: 'official',
    url: 'https://blog.google/technology/ai/',
    feedUrl: 'https://blog.google/technology/ai/rss/',
    monitorType: 'official_release',
    alwaysMonitored: true,
  },
  {
    id: 'xai-official',
    companyId: 'xai',
    label: 'xAI News',
    publisher: 'xAI',
    sourceType: 'official',
    url: 'https://x.ai/news',
    monitorType: 'official_release',
    alwaysMonitored: true,
  },
  {
    id: 'stability-ai-official',
    companyId: 'stability_ai',
    label: 'Stability AI News',
    publisher: 'Stability AI',
    sourceType: 'official',
    url: 'https://stability.ai/news-updates',
    monitorType: 'official_release',
    alwaysMonitored: true,
  },
  {
    id: 'jordan-moe-king-abdullah-schools',
    companyId: 'king_abdullah_schools',
    label: 'Jordan Ministry of Education',
    publisher: 'Jordan Ministry of Education',
    sourceType: 'official',
    url: 'https://www.moe.gov.jo/ar/news',
    monitorType: 'direct_opportunity',
    alwaysMonitored: true,
  },
  {
    id: 'jordan-moe-facebook',
    companyId: 'king_abdullah_schools',
    label: 'Jordan Ministry of Education Facebook',
    publisher: 'Jordan Ministry of Education',
    sourceType: 'official',
    url: 'https://www.facebook.com/MinistryOfEducationJordan',
    monitorType: 'direct_opportunity',
    alwaysMonitored: true,
  },
];

const INVESTABLE_SHARES_TRIGGER_PATTERNS = [
  /\bfiles? (?:confidentially )?for (?:an? )?(?:ipo|initial public offering)\b/i,
  /\bfiled (?:an? )?(?:s-1|registration statement)\b/i,
  /\bform s-1\b/i,
  /\bs-1 filing\b/i,
  /\bregistration statement\b/i,
  /\binitial public offering\b/i,
  /\bdirect listing\b/i,
  /\bpublic offering\b/i,
  /\bshares (?:begin|started|start|will begin|are) trading\b/i,
  /\bshares (?:listed|will list|are listed)\b/i,
  /\bstock ticker\b/i,
  /\bticker symbol\b/i,
  /\bpublicly traded\b/i,
];

const KING_ABDULLAH_SCHOOLS_TRIGGER_PATTERNS = [
  /مدارس[_\s-]*الملك[_\s-]*عبد(?:\s|_)?الله/i,
  /مدارس\s+التميز/i,
  /برنامج\s+مدارس/i,
  /فتح\s+باب\s+(?:التقديم|الترشح|القبول|استقبال\s+طلبات)/i,
  /طلبات\s+(?:الترشح|التقديم|القبول)/i,
  /رابط\s+(?:التقديم|التسجيل)/i,
  /آخر\s+موعد/i,
  /موعد\s+الاختبار/i,
  /application\s+(?:opens?|deadline|link)/i,
  /(?:registration|admission|applications?)\s+(?:opens?|deadline|link|window)/i,
  /(?:deadline|test date|exam date|application link|registration link)/i,
];

const DIRECT_NEWS_SPECULATION_PATTERNS = [
  /\brumou?r\b/i,
  /\bconsider(?:s|ing|ed)?\b/i,
  /\bcould\b/i,
  /\bmay\b/i,
  /\bmight\b/i,
  /\bexplor(?:e|es|ed|ing)\b/i,
  /\bweigh(?:s|ed|ing)?\b/i,
  /\bseek(?:s|ing)?\b/i,
  /\bprepare(?:s|d|ing)?\b/i,
  /\btarget(?:s|ed|ing)?\b/i,
  /\bfunding round\b/i,
  /\bvaluation\b/i,
];

const DIRECT_NEWS_NOTIFICATION_RULES = [
  {
    id: 'anthropic_investable_shares',
    sourceId: 'anthropic',
    sourceLabel: 'Anthropic',
    label: 'Anthropic investable shares',
    reason: 'Notify only if Anthropic becomes directly investable through an official listing, filing, ticker, public offering, or direct listing report.',
    sourceRequirement: 'Official Anthropic source, SEC filing, or high-trust financial/technology press.',
    companyPatterns: [/\banthropic\b/i, /\bclaude\b/i],
    triggerPatterns: INVESTABLE_SHARES_TRIGGER_PATTERNS,
  },
  {
    id: 'openai_investable_shares',
    sourceId: 'openai',
    sourceLabel: 'OpenAI',
    label: 'OpenAI investable shares',
    reason: 'Notify only if OpenAI becomes directly investable through an official listing, filing, ticker, public offering, or direct listing report.',
    sourceRequirement: 'Official OpenAI source, SEC filing, or high-trust financial/technology press.',
    companyPatterns: [/\bopenai\b/i, /\bchatgpt\b/i],
    triggerPatterns: INVESTABLE_SHARES_TRIGGER_PATTERNS,
  },
  {
    id: 'google_investable_shares',
    sourceId: 'google',
    sourceLabel: 'Google / Gemini / DeepMind',
    label: 'Google AI investable shares',
    reason: 'Notify only if a Google AI, Gemini, or DeepMind investment-access event is tied to a listing, filing, ticker, public offering, or direct listing report.',
    sourceRequirement: 'Official Google/DeepMind source, SEC filing, or high-trust financial/technology press.',
    companyPatterns: [/\bgoogle\b/i, /\bgemini\b/i, /\bdeepmind\b/i],
    triggerPatterns: INVESTABLE_SHARES_TRIGGER_PATTERNS,
  },
  {
    id: 'xai_investable_shares',
    sourceId: 'xai',
    sourceLabel: 'xAI',
    label: 'xAI investable shares',
    reason: 'Notify only if xAI becomes directly investable through an official listing, filing, ticker, public offering, or direct listing report.',
    sourceRequirement: 'Official xAI source, SEC filing, or high-trust financial/technology press.',
    companyPatterns: [/\bxai\b/i, /\bx\.ai\b/i, /\bgrok\b/i],
    triggerPatterns: INVESTABLE_SHARES_TRIGGER_PATTERNS,
  },
  {
    id: 'king_abdullah_schools_application',
    sourceId: 'king_abdullah_schools',
    sourceLabel: 'مدارس الملك عبدالله للتميز',
    label: 'إعلان مدارس التميز',
    reason: 'Notify only when an official Jordan Ministry of Education source announces applications, registration link, deadline, conditions, or test date for King Abdullah II Schools for Excellence.',
    sourceRequirement: 'Official Jordan Ministry of Education website/news page or the verified Ministry Facebook page.',
    priorityTag: 'opportunity_deadline',
    priorityTags: ['opportunity_deadline', 'education', 'jordan'],
    category: 'opportunity',
    releaseClassification: 'opportunity_deadline',
    releaseClassificationLabel: 'Opportunity deadline',
    releaseClassificationScope: 'direct_opportunity',
    releaseClassificationImportance: 'major',
    whyItMatters:
      'This may open or close the King Abdullah Schools application window. Check the link, deadline, eligibility, conditions, and test date immediately.',
    companyPatterns: [
      /مدارس[_\s-]*الملك[_\s-]*عبد(?:\s|_)?الله/i,
      /مدارس\s+التميز/i,
      /king\s+abdullah/i,
      /schools?\s+of\s+(?:excellence|distinction)/i,
      /وزارة\s+التربية/i,
    ],
    triggerPatterns: KING_ABDULLAH_SCHOOLS_TRIGGER_PATTERNS,
  },
];

const AI_RELEASE_PATTERNS = [
  // Precise model-name patterns — highest confidence, fire immediately
  { pattern: /claude\s+(opus|sonnet|haiku|mythos|instant|\d)/i, weight: 55 },
  { pattern: /gpt[-\s]?(\d|nano|mini|turbo|o\d)/i, weight: 55 },
  { pattern: /gemini\s+(\d|pro|flash|ultra|nano)/i, weight: 52 },
  { pattern: /llama\s*(\d|\d\.\d)/i, weight: 48 },
  { pattern: /grok\s*(\d|\d\.\d|-mini|-vision)/i, weight: 48 },
  { pattern: /phi[-\s]?(\d|\d\.\d)/i, weight: 40 },
  { pattern: /\bo[1-9]\b|\bo[1-9]-mini|\bo[1-9]-pro/i, weight: 50 },
  { pattern: /\bmythos\b/i, weight: 55 },
  { pattern: /\bstable\s+(?:diffusion|audio|video|image)\s*(?:\d+(?:\.\d+)?|xl|3|4|5)?\b/i, weight: 54 },
  { pattern: /\bsd(?:xl|3|4|5)(?:\s+(?:large|medium|turbo))?\b/i, weight: 48 },
  // General release signals
  { pattern: /\bnew model\b/i, weight: 28 },
  { pattern: /\bmodel(?:s)?\b/i, weight: 8 },
  { pattern: /\brelease(?:d|s)?\b/i, weight: 22 },
  { pattern: /\blaunch(?:ed|es)?\b/i, weight: 22 },
  { pattern: /\bannounce(?:d|s)?\b/i, weight: 18 },
  { pattern: /\bintroduc(?:e|es|ed)\b/i, weight: 18 },
  { pattern: /\bunveil(?:ed|s)?\b/i, weight: 18 },
  { pattern: /\bapi\b/i, weight: 16 },
  { pattern: /\bpricing\b/i, weight: 14 },
  { pattern: /\btool\b/i, weight: 18 },
  { pattern: /\bspace\b/i, weight: 14 },
  { pattern: /\bapp\b/i, weight: 14 },
  { pattern: /\bagent(?:ic)?\b/i, weight: 18 },
  { pattern: /\breasoning\b/i, weight: 18 },
  { pattern: /\bmultimodal\b/i, weight: 18 },
  { pattern: /\bvoice\b/i, weight: 12 },
  { pattern: /\bvideo\b/i, weight: 12 },
  { pattern: /\bcoding\b/i, weight: 12 },
  { pattern: /\bbenchmark\b/i, weight: 12 },
  { pattern: /\benterprise\b/i, weight: 10 },
  { pattern: /\bintegration\b/i, weight: 8 },
  { pattern: /\bupgrade\b/i, weight: 10 },
  { pattern: /\bupdate\b/i, weight: 8 },
];

const AI_STRONG_SIGNAL_PATTERNS = [
  { pattern: /\bnew model\b/i, weight: 24 },
  { pattern: /\brelease(?:d|s)?\b/i, weight: 22 },
  { pattern: /\blaunch(?:ed|es)?\b/i, weight: 22 },
  { pattern: /\bannounce(?:d|s)?\b/i, weight: 18 },
  { pattern: /\bintroduc(?:e|es|ed)\b/i, weight: 18 },
  { pattern: /\bunveil(?:ed|s)?\b/i, weight: 18 },
  { pattern: /\bavailability\b/i, weight: 16 },
  { pattern: /\bapi now supports\b/i, weight: 18 },
  { pattern: /\bnow supports\b/i, weight: 16 },
  { pattern: /\bupgrade(?:d|s)?\b/i, weight: 14 },
];

const AI_GENERIC_CASE_STUDY_TITLE_PATTERN = /\b(how\b|customer story\b|case stud(?:y|ies)\b|builds?\b|turns?\b|doubles?\b|ships faster\b|big bet\b|agentic organization\b)\b/i;

const AI_PRODUCT_SIGNAL_PATTERNS = [
  { pattern: /\bmodel(?:s)?\b/i, weight: 12 },
  { pattern: /\bapi\b/i, weight: 16 },
  { pattern: /\bpricing\b/i, weight: 14 },
  { pattern: /\btool\b/i, weight: 16 },
  { pattern: /\bspace\b/i, weight: 14 },
  { pattern: /\bapp\b/i, weight: 12 },
  { pattern: /\bagent(?:ic)?\b/i, weight: 16 },
  { pattern: /\breasoning\b/i, weight: 16 },
  { pattern: /\bmultimodal\b/i, weight: 16 },
  { pattern: /\bvoice\b/i, weight: 10 },
  { pattern: /\bvideo\b/i, weight: 10 },
  { pattern: /\bcoding\b/i, weight: 10 },
  { pattern: /\bbenchmark\b/i, weight: 10 },
  { pattern: /\benterprise\b/i, weight: 10 },
  { pattern: /\bintegration\b/i, weight: 8 },
  { pattern: /\b(gpt|claude|gemini|llama|grok|copilot|bedrock|nova|gemma|stable\s+(?:diffusion|audio|video|image)|sdxl|sd3|sd4|sd5)\b/i, weight: 16 },
];

const AI_BROAD_AVAILABILITY_PATTERNS = [
  /\bapi\b/i,
  /\bavailability\b/i,
  /\bgeneral(?:ly)? available\b/i,
  /\bga\b/i,
  /\ball users\b/i,
  /\bpricing\b/i,
  /\bdevelopers?\b/i,
  /\bdeveloper access\b/i,
  /\brollout\b/i,
];

const AI_PRECISE_MODEL_NAME_PATTERN = /\b(?:claude\s+(?:opus|sonnet|haiku|fable|mythos|instant|\d+(?:\.\d+)?)|gpt[-\s]?(?:\d+(?:\.\d+)?|nano|mini|turbo|o\d)|gemini\s+(?:\d+(?:\.\d+)?|pro|flash|ultra|nano)|llama\s*(?:\d+(?:\.\d+)?)|grok\s*(?:\d+(?:\.\d+)?|-mini|-vision)|phi[-\s]?(?:\d+(?:\.\d+)?)|o[1-9](?:-mini|-pro)?|nova\s+\w+|gemma\s*[- ]?\d+(?:\.\d+)?|mistral\s+(?:large|small|medium|codestral|devstral)(?:\s*\d+(?:\.\d+)?)?|stable\s+(?:diffusion|audio|video|image)\s*(?:\d+(?:\.\d+)?|xl|3|4|5)?|sd(?:xl|3|4|5)(?:\s+(?:large|medium|turbo))?)\b/i;

const AI_RELEASE_TYPE_DEFINITIONS = [
  {
    id: 'model_release',
    label: 'Model release',
    pushMinImportance: 'important',
    officialScoreThreshold: 32,
    pressScoreThreshold: 66,
    majorScoreThreshold: 58,  // lowered: model-name patterns score 40-55 base, total often 58-70
    patterns: [
      { pattern: /\bnew model\b/i, weight: 36 },
      { pattern: /\bmodel(?:s)?\b/i, weight: 10 },
      { pattern: /\b(gpt|gemma|grok|llama|nova)\s*[- ]?\d+(?:\.\d+)?\b/i, weight: 44 },
      { pattern: /\b(claude|gemini)\s+(sonnet|opus|haiku|fable|mythos|flash|pro)\b/i, weight: 44 },
      { pattern: /\bstable\s+(?:diffusion|audio|video|image)\s*(?:\d+(?:\.\d+)?|xl|3|4|5)?\b/i, weight: 44 },
      { pattern: /\bsd(?:xl|3|4|5)(?:\s+(?:large|medium|turbo))?\b/i, weight: 38 },
      { pattern: /\b(reasoning model|frontier model|foundation model)\b/i, weight: 20 },
    ],
  },
  {
    id: 'api_release',
    label: 'API release',
    pushMinImportance: 'important',
    officialScoreThreshold: 50,
    pressScoreThreshold: 72,
    majorScoreThreshold: 72,  // lowered from 84
    patterns: [
      { pattern: /\bapi\b/i, weight: 20 },
      { pattern: /\bsdk\b/i, weight: 18 },
      { pattern: /\bplatform\b/i, weight: 16 },
      { pattern: /\bdeveloper(?:s)?\b/i, weight: 16 },
      { pattern: /\bavailability\b/i, weight: 14 },
      { pattern: /\bendpoint(?:s)?\b/i, weight: 14 },
      { pattern: /\bpricing\b/i, weight: 10 },
    ],
  },
  {
    id: 'tool_release',
    label: 'Tool release',
    pushMinImportance: 'important',
    officialScoreThreshold: 52,
    pressScoreThreshold: 74,
    majorScoreThreshold: 72,  // lowered from 84
    patterns: [
      { pattern: /\btool\b/i, weight: 18 },
      { pattern: /\bapp\b/i, weight: 16 },
      { pattern: /\bagent(?:ic)?\b/i, weight: 18 },
      { pattern: /\bassistant\b/i, weight: 16 },
      { pattern: /\bstudio\b/i, weight: 14 },
      { pattern: /\bworkspace\b/i, weight: 12 },
      { pattern: /\beditor\b/i, weight: 12 },
      { pattern: /\bcli\b/i, weight: 12 },
      { pattern: /\bspace(?:s)?\b/i, weight: 14 },
    ],
  },
  {
    id: 'major_feature',
    label: 'Major feature',
    pushMinImportance: 'major',
    officialScoreThreshold: 60,
    pressScoreThreshold: 82,
    majorScoreThreshold: 80,  // lowered from 92
    patterns: [
      { pattern: /\bvoice\b/i, weight: 16 },
      { pattern: /\bvideo\b/i, weight: 14 },
      { pattern: /\bmultimodal\b/i, weight: 14 },
      { pattern: /\bcoding\b/i, weight: 14 },
      { pattern: /\bsearch\b/i, weight: 12 },
      { pattern: /\bmemory\b/i, weight: 12 },
      { pattern: /\bbrowser\b/i, weight: 12 },
      { pattern: /\bintegration\b/i, weight: 12 },
      { pattern: /\bupdate(?:d|s)?\b/i, weight: 10 },
      { pattern: /\bupgrade(?:d|s)?\b/i, weight: 12 },
      { pattern: /\bnow supports\b/i, weight: 14 },
    ],
  },
  {
    id: 'pricing_or_access_change',
    label: 'Pricing or access change',
    pushMinImportance: 'important',
    officialScoreThreshold: 42,
    pressScoreThreshold: 66,
    majorScoreThreshold: 72,  // lowered from 82
    patterns: [
      { pattern: /\bpricing\b/i, weight: 24 },
      { pattern: /\bprice(?:s)?\b/i, weight: 18 },
      { pattern: /\bcost\b/i, weight: 12 },
      { pattern: /\bavailability\b/i, weight: 18 },
      { pattern: /\baccess\b/i, weight: 18 },
      { pattern: /\brollout\b/i, weight: 12 },
      { pattern: /\bbeta\b/i, weight: 12 },
      { pattern: /\binvite\b/i, weight: 12 },
      { pattern: /\bwaitlist\b/i, weight: 12 },
      { pattern: /\bearly access\b/i, weight: 16 },
      { pattern: /\bgeneral(?:ly)? available\b/i, weight: 16 },
    ],
  },
];

const AI_RELEASE_TYPE_PRIORITY = new Map([
  ['model_release', 5],
  ['tool_release', 4],
  ['api_release', 3],
  ['major_feature', 2],
  ['pricing_or_access_change', 1],
  ['general_release', 0],
]);

const AI_VALUE_PATTERNS = [
  /\bworkflow\b/i,
  /\bautomation\b/i,
  /\bsearch\b/i,
  /\bdeveloper\b/i,
  /\bproductivity\b/i,
  /\bopen[- ]source\b/i,
];

const AI_CONTEXT_PATTERNS = [
  /\bai\b/i,
  /\bartificial intelligence\b/i,
  /\bgenerative\b/i,
  /\bmachine learning\b/i,
  /\bllm\b/i,
  /\bfoundation model\b/i,
  /\bmodel(?:s)?\b/i,
  /\bagent(?:ic)?\b/i,
  /\breasoning\b/i,
  /\bmultimodal\b/i,
  /\bapi\b/i,
  /\bassistant\b/i,
  /\bcoding\b/i,
  /\bautomation\b/i,
  /\bbedrock\b/i,
  /\bnova\b/i,
  /\bgpt\b/i,
  /\bclaude\b/i,
  /\bgemini\b/i,
  /\bllama\b/i,
  /\bgrok\b/i,
  /\bhugging\s*face\b/i,
];

const HIGH_SIGNAL_MODEL_OWNERS = new Set([
  'black-forest-labs',
  'deepseek-ai',
  'google',
  'meta-llama',
  'microsoft',
  'mistralai',
  'moonshotai',
  'nvidia',
  'openai',
  'openai-community',
  'qwen',
  'runwayml',
  'stabilityai',
]);

const AI_NEGATIVE_PATTERNS = [
  /\brumou?r\b/i,
  /\bopinion\b/i,
  /\beditorial\b/i,
  /\banalysis\b/i,
  /\binterview\b/i,
  /\bstock\b/i,
  /\bearnings\b/i,
  /\blawsuit\b/i,
  /\bpatch\b/i,
  /\bbug(?:fix)?\b/i,
  /\bminor\b/i,
  /\bsmall\b/i,
  /\bpreview\b/i,
  /\bdeal(?:s)?\b/i,
  /\bdiscount\b/i,
  /\bcoupon\b/i,
  /\bsale\b/i,
  /\bprice drop\b/i,
  /\bearnings call\b/i,
  /\bstudio display\b/i,
  /\biphone\b/i,
  /\blaptop\b/i,
  /\bmarket cap\b/i,
  /\bshare price\b/i,
  /\bpartnership rumor\b/i,
  /\bfunding\b/i,
  /\bacquisition\b/i,
  /\bhiring\b/i,
  /\bexec(?:utive)?\b/i,
  /\bpartnership\b/i,
  /\binvestment\b/i,
  /\bvaluation\b/i,
  /\bantitrust\b/i,
  /\bpolicy\b/i,
  /\bregulation\b/i,
  /\bconference talk\b/i,
  /\bdemo\b/i,
  /\bteaser\b/i,
];

const AI_JUNK_PATTERNS = [
  /\bhow to\b/i,
  /\bbest .* ai\b/i,
  /\btop \d+ ai\b/i,
  /\bai assistant\b/i,
  /\bop-ed\b/i,
  /\bnewsletter\b/i,
];

const GEO_CRITICAL_PATTERNS = [
  /\bmissile\b/i,
  /\bairstrike\b/i,
  /\bstrike\b/i,
  /\battack\b/i,
  /\bbomb(?:ing)?\b/i,
  /\bdrone\b/i,
  /\bretaliat(?:e|ion)\b/i,
  /\bevacuat(?:e|ion)\b/i,
  /\bairspace\b/i,
  /\bshipping\b/i,
  /\bbase\b/i,
  /\btroops?\b/i,
  /\bmobili[sz]ation\b/i,
  /\bnuclear\b/i,
];

const GEO_ELEVATED_PATTERNS = [
  /\bwarning\b/i,
  /\bthreat\b/i,
  /\bdiplomatic\b/i,
  /\bsanction\b/i,
  /\bcivilian(?:s)?\b/i,
  /\btravel\b/i,
  /\boil\b/i,
  /\bgas\b/i,
  /\bsecurity\b/i,
];

const GEO_ESCALATION_SUPPORT_PATTERNS = [
  /\bmilitary\b/i,
  /\bairspace\b/i,
  /\bshipping\b/i,
  /\bbase\b/i,
  /\bcentcom\b/i,
  /\bnavy\b/i,
  /\bforces?\b/i,
  /\bgulf\b/i,
  /\bevacu(?:ate|ation)\b/i,
];

const GEO_NEGATIVE_PATTERNS = [
  /\bopinion\b/i,
  /\banalysis\b/i,
  /\bexplainer\b/i,
  /\bpodcast\b/i,
  /\blive blog\b/i,
  /\bbackgrounder\b/i,
];

const GEO_REGIONAL_SCOPE_PATTERNS = [
  /\biran(?:ian)?\b/i,
  /\bisrael(?:i)?\b/i,
  /\bqatar(?:i)?\b/i,
  /\bjordan(?:ian)?\b/i,
  /\bgaza\b/i,
  /\blebanon\b/i,
  /\bsyria(?:n)?\b/i,
  /\biraq(?:i)?\b/i,
  /\byemen(?:i)?\b/i,
  /\bgulf\b/i,
  /\bmiddle east\b/i,
  /\blevant\b/i,
  /\bred sea\b/i,
  /\bwest bank\b/i,
];

const GEO_MAJOR_POLITICAL_CONTEXT_PATTERNS = [
  /\bpresident\b/i,
  /\bprime minister\b/i,
  /\bminister\b/i,
  /\bgovernment\b/i,
  /\bcabinet\b/i,
  /\bparliament\b/i,
  /\bcongress\b/i,
  /\bsenate\b/i,
  /\blawmaker\b/i,
  /\blegislator\b/i,
  /\bcandidate\b/i,
  /\bcampaign\b/i,
  /\bopposition\b/i,
  /\bleader\b/i,
  /\bpolitician\b/i,
  /\bactivist\b/i,
  /\bcommentator\b/i,
  /\bjudge\b/i,
  /\bcourt\b/i,
  /\bprotest\b/i,
  /\brally\b/i,
  /\bspeaker\b/i,
];

const GEO_MAJOR_POLITICAL_EVENT_PATTERNS = [
  /\bassassinat(?:e|ion|ed)\b/i,
  /\bkill(?:ed|ing)?\b/i,
  /\bshot\b/i,
  /\bdeath\b/i,
  /\bdied\b/i,
  /\bresign(?:ation|ed|s)?\b/i,
  /\bimpeach(?:ment|ed)?\b/i,
  /\bcoup\b/i,
  /\belection\b/i,
  /\breferendum\b/i,
  /\bvote\b/i,
  /\bceasefire\b/i,
  /\bpeace deal\b/i,
  /\bsummit\b/i,
  /\btreaty\b/i,
  /\bstate of emergency\b/i,
  /\bmartial law\b/i,
];

const SCIENCE_CRITICAL_PATTERNS = [
  /\bdna\b/i,
  /\bgenetics?\b/i,
  /\bgenome\b/i,
  /\bcrispr\b/i,
  /\bprotein folding\b/i,
  /\bscientific discovery\b/i,
  /\bbreakthrough\b/i,
  /\bengineered\b/i,
  /\bsequenced\b/i,
  /\bmutation\b/i,
];

let cachedRadar = {
  checkedAt: 0,
  alerts: [],
};

function getDirectRadarFeedDefinitions() {
  const configuredOfficialFeeds = String(process.env.PRIORITY_RADAR_OFFICIAL_FEEDS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((feedUrl, index) => ({
      id: `direct-official-feed-${index + 1}`,
      category: 'ai',
      sourceType: 'official',
      kind: 'rss',
      label: `Official AI feed ${index + 1}`,
      feedUrl,
    }));
  const configuredFeeds = String(process.env.PRIORITY_RADAR_DIRECT_FEEDS || process.env.WRITTEN_NEWS_FEEDS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const urls = configuredFeeds.length ? configuredFeeds : DEFAULT_DIRECT_PRESS_FEEDS;

  const officialFeeds = configuredOfficialFeeds.length
    ? configuredOfficialFeeds
    : DEFAULT_DIRECT_OFFICIAL_FEEDS.map((feed, index) => ({
      id: `direct-official-feed-${index + 1}`,
      category: 'ai',
      sourceType: 'official',
      ...feed,
    }));

  const pressFeeds = urls.map((feedUrl, index) => ({
    id: `direct-feed-${index + 1}`,
    category: 'mixed',
    sourceType: 'press',
    kind: 'rss',
    label: feedUrl.includes('reuters') ? 'Reuters direct feed' : 'Direct press feed',
    feedUrl,
  }));

  return [...officialFeeds, ...pressFeeds];
}

function getRadarReferencePoints() {
  return RADAR_REFERENCE_POINTS.map((reference) => ({ ...reference }));
}

function getDirectNotificationRules() {
  return DIRECT_NEWS_NOTIFICATION_RULES.map((rule) => ({
    id: rule.id,
    sourceId: rule.sourceId,
    sourceLabel: rule.sourceLabel,
    label: rule.label,
    reason: rule.reason,
    sourceRequirement: rule.sourceRequirement,
    priorityTag: rule.priorityTag || 'investment_access',
    priorityTags: rule.priorityTags || ['investment_access', 'world_impact'],
  }));
}

function buildGoogleNewsUrl(query) {
  const params = new URLSearchParams({
    q: query,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  });

  return `${GOOGLE_NEWS_BASE}?${params.toString()}`;
}

function decodeEntities(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function parseTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  if (!match) {
    return '';
  }

  return normalizeWhitespace(stripTags(decodeEntities(match[1])));
}

function parseImageFromBlock(block) {
  let match = block.match(/<media:(?:content|thumbnail)[^>]*url=(['"])([\s\S]*?)\1/i);
  if (match && match[2]) return match[2].trim();

  match = block.match(/<enclosure[^>]*url=(['"])([\s\S]*?)\1/i);
  if (match && match[2]) return match[2].trim();

  match = block.match(/<img[^>]*src=(['"])([\s\S]*?)\1/i);
  if (match && match[2]) return match[2].trim();

  return '';
}

function parseFeed(xml, definition) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return items.slice(0, MAX_ITEMS_PER_FEED).map((block) => {
    const title = parseTag(block, 'title');
    const rawLink = parseTag(block, 'link');
    const description = parseTag(block, 'description');
    const publisher = parseTag(block, 'source') || definition.label;
    const publishedAt = parseTag(block, 'pubDate');
    const inferredCategory = definition.category === 'mixed'
      ? (/\b(iran|israel|israeli|qatar|jordan|jordanian|strike|missile|attack|retaliation|evacuation|airspace|military|shipping|oil|gas)\b/i.test(`${title} ${description}`)
        ? 'geo'
        : /\b(dna|genetics|genome|crispr|protein folding|scientific discovery|science|breakthrough|sequence)\b/i.test(`${title} ${description}`)
          ? 'science'
          : 'ai')
      : definition.category;

    const image = parseImageFromBlock(block);

    return {
      title,
      link: rawLink,
      description,
      publisher,
      category: inferredCategory,
      sourceLabel: definition.label,
      sourceHint: definition.sourceType,
      sourceId: definition.id,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
      thumbnail: image || null,
      thumbnailUrl: image || null,
      thumbnail_url: image || null,
      image: image || null,
      imageUrl: image || null,
      coverImage: image || null,
    };
  });
}

function resolveUrl(baseUrl = '', value = '') {
  try {
    return new URL(String(value || '').trim(), baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function extractHtmlAttribute(tag = '', attributeName = '') {
  const match = String(tag).match(new RegExp(`\\b${attributeName}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i'));
  if (!match) {
    return '';
  }

  return normalizeWhitespace(decodeEntities(match[2] || ''));
}

function parseMetaContent(html = '', attributeName = '', attributeValue = '') {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  const matcher = new RegExp(`\\b${attributeName}\\s*=\\s*(['"])${attributeValue}\\1`, 'i');

  for (const tag of tags) {
    if (!matcher.test(tag)) {
      continue;
    }

    const content = extractHtmlAttribute(tag, 'content');
    if (content) {
      return content;
    }
  }

  return '';
}

function parseTitleTag(html = '') {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return '';
  }

  return normalizeWhitespace(stripTags(decodeEntities(match[1] || '')));
}

function normalizePublishedAt(value = '') {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function parsePublishedAt(html = '') {
  const directCandidates = [
    parseMetaContent(html, 'property', 'article:published_time'),
    parseMetaContent(html, 'property', 'og:article:published_time'),
    parseMetaContent(html, 'name', 'article:published_time'),
    parseMetaContent(html, 'name', 'publish_date'),
    parseMetaContent(html, 'name', 'parsely-pub-date'),
    parseMetaContent(html, 'itemprop', 'datePublished'),
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizePublishedAt(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const timeTag = String(html).match(/<time\b[^>]*datetime\s*=\s*(['"])(.*?)\1/i);
  if (timeTag?.[2]) {
    const normalized = normalizePublishedAt(timeTag[2]);
    if (normalized) {
      return normalized;
    }
  }

  const jsonLd = String(html).match(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (jsonLd?.[1]) {
    const normalized = normalizePublishedAt(jsonLd[1]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function cleanArticleTitle(title = '', publisher = '') {
  const normalizedTitle = normalizeWhitespace(title);
  if (!normalizedTitle) {
    return '';
  }

  const publisherText = normalizeWhitespace(publisher);
  if (!publisherText) {
    return normalizedTitle;
  }

  return normalizedTitle
    .replace(new RegExp(`\\s*[|\\-–—:]\\s*${publisherText}$`, 'i'), '')
    .replace(/\s+[|\\-–—:]\s*(news|blog|ai at meta)$/i, '')
    .trim();
}

function extractLandingArticleUrls(html = '', definition = {}) {
  const matches = String(html).matchAll(/href\s*=\s*(['"])(.*?)\1/gi);
  const seen = new Set();
  const urls = [];
  const prefixes = Array.isArray(definition.articlePrefixes) ? definition.articlePrefixes : [];
  const excludePatterns = Array.isArray(definition.excludePatterns) ? definition.excludePatterns : [];
  const landingUrl = String(definition.landingUrl || '').replace(/\/+$/, '');

  for (const match of matches) {
    const href = decodeEntities(match[2] || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) {
      continue;
    }

    const resolved = resolveUrl(definition.landingUrl, href).replace(/#.*$/, '');
    if (!resolved || seen.has(resolved)) {
      continue;
    }

    if (resolved.replace(/\/+$/, '') === landingUrl) {
      continue;
    }

    if (prefixes.length && !prefixes.some((prefix) => resolved.startsWith(prefix))) {
      continue;
    }

    if (excludePatterns.some((pattern) => pattern.test(resolved))) {
      continue;
    }

    seen.add(resolved);
    urls.push(resolved);
  }

  return urls.slice(0, Number(definition.articleLimit) || MAX_ITEMS_PER_OFFICIAL_PAGE);
}

async function fetchOfficialLandingPageItems(definition) {
  const response = await fetch(definition.landingUrl, {
    headers: {
      'User-Agent': 'eXploreRadar/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Landing page request failed: ${definition.id} (${response.status})`);
  }

  const landingHtml = await response.text();
  const articleUrls = extractLandingArticleUrls(landingHtml, definition);
  const settled = await Promise.allSettled(
    articleUrls.map(async (articleUrl) => {
      const articleResponse = await fetch(articleUrl, {
        headers: {
          'User-Agent': 'eXploreRadar/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!articleResponse.ok) {
        throw new Error(`Article request failed (${articleResponse.status})`);
      }

      const html = await articleResponse.text();
      const title = cleanArticleTitle(
        parseMetaContent(html, 'property', 'og:title')
          || parseMetaContent(html, 'name', 'twitter:title')
          || parseTitleTag(html),
        definition.publisher || definition.label
      );
      const description = parseMetaContent(html, 'property', 'og:description')
        || parseMetaContent(html, 'name', 'description')
        || parseMetaContent(html, 'name', 'twitter:description');
      const publishedAt = parsePublishedAt(html);

      const ogImage = parseMetaContent(html, 'property', 'og:image')
        || parseMetaContent(html, 'name', 'twitter:image')
        || parseMetaContent(html, 'property', 'twitter:image');

      if (!title) {
        return null;
      }

      return {
        title,
        link: articleUrl,
        description,
        publisher: definition.publisher || definition.label,
        category: definition.category || 'ai',
        sourceLabel: definition.label,
        sourceHint: definition.sourceType || 'official',
        sourceId: definition.id,
        publishedAt,
        thumbnail: ogImage || null,
        thumbnailUrl: ogImage || null,
        thumbnail_url: ogImage || null,
        image: ogImage || null,
        imageUrl: ogImage || null,
        coverImage: ogImage || null,
      };
    })
  );

  return settled
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);
}

function normalizeOwner(repoId = '') {
  return String(repoId || '').split('/')[0].trim().toLowerCase();
}

function formatHuggingFaceDescription(parts = []) {
  return parts.map((value) => normalizeWhitespace(String(value || ''))).filter(Boolean).join(' | ');
}

function buildHuggingFaceItems(definition, payload = []) {
  const items = [];

  for (const entry of Array.isArray(payload) ? payload : []) {
    const repoId = String(entry.id || '').trim();
    if (!repoId) {
      continue;
    }

    const owner = normalizeOwner(repoId);
    const likes = Number(entry.likes || 0);
    const downloads = Number(entry.downloads || 0);
    const ageHours = hoursSince(entry.createdAt || entry.lastModified);
    const isHighSignalOwner = HIGH_SIGNAL_MODEL_OWNERS.has(owner);
    const modelTag = String(entry.pipeline_tag || entry.sdk || '').trim();
    const engagementStrong = definition.kind === 'huggingface_spaces'
      ? likes >= 12
      : (likes >= 20 || downloads >= 6000);

    if (!engagementStrong) {
      continue;
    }

    if (!isHighSignalOwner && likes < 30 && downloads < 12000) {
      continue;
    }

    if (ageHours > 72) {
      continue;
    }

    const noun = definition.kind === 'huggingface_spaces' ? 'tool' : 'model';
    const signal = definition.kind === 'huggingface_spaces' ? 'app' : (modelTag || 'open-source model');
    items.push({
      title: `New Hugging Face ${noun}: ${repoId}`,
      link: `https://huggingface.co/${definition.kind === 'huggingface_spaces' ? 'spaces/' : ''}${repoId}`,
      description: formatHuggingFaceDescription([
        `${signal} launch on Hugging Face`,
        likes > 0 ? `${likes} likes` : '',
        downloads > 0 ? `${downloads} downloads` : '',
        entry.library_name ? `library ${entry.library_name}` : '',
      ]),
      publisher: 'Hugging Face',
      category: 'ai',
      sourceLabel: definition.label,
      sourceHint: definition.sourceType,
      sourceId: definition.id,
      publishedAt: entry.createdAt || entry.lastModified || null,
    });
  }

  return items;
}

function hashAlertId(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function hoursSince(value) {
  if (!value) {
    return 999;
  }

  const delta = Date.now() - new Date(value).getTime();
  return delta / (1000 * 60 * 60);
}

function getHostname(value = '') {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (error) {
    return '';
  }
}

function matchesHostPattern(hostname, patterns = []) {
  if (!hostname) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(hostname));
}

function normalizeSlug(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/https?:\/\/[^/]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeTitleKey(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeAlertText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildAlertFingerprint(alert = {}) {
  const host = getHostname(alert.url || '');
  const hostKey = host || 'no-host';
  const useTitleFingerprint = hostKey === 'news.google.com';
  const releaseWatchCompany = String(alert.release_watch_company || alert.vendor_scope || '').trim().toLowerCase();
  const releaseClassification = String(alert.release_classification || alert.release_classification_type || '').trim().toLowerCase();
  const slugSource = useTitleFingerprint
    ? `${alert.source || ''}-${normalizeTitleKey(alert.title || '')}`
    : alert.url || alert.title || '';
  const slug = normalizeSlug(
    [releaseWatchCompany, releaseClassification, slugSource]
      .filter(Boolean)
      .join('-')
  );
  return `${alert.category || 'unknown'}:${hostKey}:${slug}`;
}

function isPrimaryReleaseWatchCompany(companyId = '') {
  return PRIMARY_RELEASE_WATCH_COMPANY_IDS.has(String(companyId || '').trim().toLowerCase());
}

function scoreReleaseWatchCompanyEvidence(item, company) {
  const hostname = getHostname(item.link || '');
  const segments = [
    { value: normalizeAlertText(item.title).toLowerCase(), weight: 6, label: 'title' },
    { value: normalizeAlertText(item.description).toLowerCase(), weight: 5, label: 'description' },
    { value: normalizeAlertText(item.publisher).toLowerCase(), weight: 3, label: 'publisher' },
    { value: normalizeAlertText(item.sourceLabel).toLowerCase(), weight: 2, label: 'source label' },
    { value: String(hostname || '').toLowerCase(), weight: 4, label: 'host' },
  ];

  const matchedParts = [];
  let score = 0;

  for (const segment of segments) {
    if (!segment.value) {
      continue;
    }

    const hit = company.companyPatterns.some((pattern) => pattern.test(segment.value));
    if (!hit) {
      continue;
    }

    score += segment.weight;
    matchedParts.push(segment.label);
  }

  return {
    score,
    matchedParts,
  };
}

function pickThreatLevel(score) {
  if (score >= 70) {
    return 'Critical';
  }
  if (score >= 50) {
    return 'High';
  }
  if (score >= 30) {
    return 'Elevated';
  }
  return 'Low';
}

function classifySource(item) {
  const hostname = getHostname(item.link || '').toLowerCase();
  const sourceText = `${item.publisher || ''} ${item.sourceLabel || ''}`;
  const isMoeFacebook = (hostname.includes('facebook.com') || hostname.includes('fb.com')) &&
    (/MinistryOfEducationJordan/i.test(item.link || '') || 
     /Jordan Ministry of Education|وزارة التربية والتعليم/i.test(sourceText));
  
  const officialSource = matchesHostPattern(hostname, OFFICIAL_SOURCE_HOST_PATTERNS)
    || OFFICIAL_AI_SOURCE_PATTERNS.some((pattern) => pattern.test(sourceText))
    || isMoeFacebook;
  const trustedPress = matchesHostPattern(hostname, HIGH_TRUST_PRESS_HOST_PATTERNS)
    || HIGH_TRUST_PRESS_PATTERNS.some((pattern) => pattern.test(sourceText));
  const sourceType = officialSource ? 'official' : trustedPress ? 'press' : (item.sourceHint || 'unknown');
  return {
    sourceType,
    officialSource,
    trustedPress,
  };
}

function classifyReleaseWatchCompany(item) {
  let bestCompany = null;
  let bestEvidence = null;

  for (const company of AI_RELEASE_WATCH_COMPANIES) {
    const evidence = scoreReleaseWatchCompanyEvidence(item, company);
    if (!evidence.score) {
      continue;
    }

    if (!bestEvidence || evidence.score > bestEvidence.score) {
      bestCompany = company;
      bestEvidence = evidence;
      continue;
    }

    if (evidence.score === bestEvidence.score) {
      const bestIsPrimary = isPrimaryReleaseWatchCompany(bestCompany?.id);
      const nextIsPrimary = isPrimaryReleaseWatchCompany(company.id);
      if (nextIsPrimary && !bestIsPrimary) {
        bestCompany = company;
        bestEvidence = evidence;
      }
    }
  }

  if (!bestCompany || !bestEvidence || bestEvidence.score < 6) {
    return null;
  }

  return bestCompany;
}

function buildReleaseWatchMetadata(item, classification, signals = {}) {
  const company = classification || classifyReleaseWatchCompany(item);
  if (!company) {
    return {
      release_watch_company: 'unknown',
      release_watch_company_label: '',
      release_watch_signal: 'unclassified',
      release_watch_scope: 'unclassified',
      release_watch_reason: 'No explicit company family matched this AI release signal.',
    };
  }

  const releaseHits = Array.isArray(signals.releaseHits) ? signals.releaseHits : [];
  const strongHits = Array.isArray(signals.strongHits) ? signals.strongHits : [];
  const productHits = Array.isArray(signals.productHits) ? signals.productHits : [];
  const signalStrength = signals.officialSource
    ? 'official_release'
    : 'corroborated_release';
  const companyEvidence = scoreReleaseWatchCompanyEvidence(item, company);
  const scope = isPrimaryReleaseWatchCompany(company.id) ? 'primary_vendor' : 'secondary_vendor';

  const matchedParts = [
    companyEvidence.matchedParts.length ? `company mention in ${companyEvidence.matchedParts.join(', ')}` : '',
    releaseHits.length ? 'release language' : '',
    strongHits.length ? 'strong launch phrasing' : '',
    productHits.length ? 'product vocabulary' : '',
  ].filter(Boolean);

  return {
    release_watch_company: company.id,
    release_watch_company_label: company.label,
    release_watch_signal: signalStrength,
    release_watch_scope: scope,
    release_watch_reason: matchedParts.length
      ? `${company.label} release-watch hit with ${matchedParts.join(', ')}.`
      : `${company.label} release-watch hit.`,
  };
}

function buildReleaseClassification(item, signals = {}) {
  const text = `${item.title} ${item.description} ${item.publisher} ${item.sourceLabel}`.toLowerCase();
  const officialSource = Boolean(signals.officialSource);
  const trustedPress = Boolean(signals.trustedPress);
  const releaseWatchCompany = signals.releaseWatchCompany || classifyReleaseWatchCompany(item);

  const candidates = AI_RELEASE_TYPE_DEFINITIONS
    .map((definition) => {
      const matchedPatterns = definition.patterns.filter(({ pattern }) => pattern.test(text));
      const score = matchedPatterns.reduce((sum, { weight }) => sum + weight, 0);
      return {
        ...definition,
        score,
        matchedPatterns,
      };
    })
    .filter((candidate) => candidate.score > 0);

  const thresholdField = officialSource
    ? 'officialScoreThreshold'
    : trustedPress
      ? 'pressScoreThreshold'
      : '';

  const eligible = candidates.filter((candidate) => (
    thresholdField
      ? candidate.score >= candidate[thresholdField]
      : false
  ));

  const selected = eligible.sort((left, right) => {
    const leftPriority = AI_RELEASE_TYPE_PRIORITY.get(left.id) || 0;
    const rightPriority = AI_RELEASE_TYPE_PRIORITY.get(right.id) || 0;

    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }

    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.matchedPatterns.length !== left.matchedPatterns.length) {
      return right.matchedPatterns.length - left.matchedPatterns.length;
    }

    return AI_RELEASE_TYPE_DEFINITIONS.findIndex((definition) => definition.id === left.id)
      - AI_RELEASE_TYPE_DEFINITIONS.findIndex((definition) => definition.id === right.id);
  })[0] || null;

  const releaseClassification = selected?.id || 'general_release';
  const releaseClassificationLabel = selected?.label || 'General release';
  const releaseClassificationImportance = selected
    ? (selected.score >= selected.majorScoreThreshold ? 'major' : 'important')
    : 'important';
  const matchedParts = selected
    ? selected.matchedPatterns.map(({ pattern }) => pattern.source)
    : [];
  const scope = releaseWatchCompany
    ? (isPrimaryReleaseWatchCompany(releaseWatchCompany.id) ? 'primary_vendor' : 'secondary_vendor')
    : 'unclassified';
  const reasonParts = [
    releaseWatchCompany?.label || '',
    releaseClassificationLabel !== 'General release' ? releaseClassificationLabel.toLowerCase() : '',
    officialSource ? 'official source' : trustedPress ? 'press corroboration' : '',
    matchedParts.length ? `matched ${matchedParts.slice(0, 3).join(', ')}` : '',
  ].filter(Boolean);

  return {
    release_classification: releaseClassification,
    release_classification_label: releaseClassificationLabel,
    release_classification_reason: reasonParts.length
      ? `${reasonParts.join(' · ')}.`
      : 'General AI release signal.',
    release_classification_scope: scope,
    release_classification_score: selected?.score || 0,
    release_classification_importance: releaseClassificationImportance,
  };
}

function buildWhyNotifiedMessage({
  releaseClassification = {},
  releaseWatchMetadata = {},
  qualifiedReason = '',
  score = 0,
} = {}) {
  const parts = [];

  if (releaseWatchMetadata.release_watch_company_label) {
    parts.push(releaseWatchMetadata.release_watch_company_label);
  }

  if (releaseClassification.release_classification_label && releaseClassification.release_classification_label !== 'General release') {
    parts.push(releaseClassification.release_classification_label);
  } else if (releaseWatchMetadata.release_watch_signal === 'official_release') {
    parts.push('official release');
  } else if (releaseWatchMetadata.release_watch_signal === 'corroborated_release') {
    parts.push('corroborated release');
  }

  if (qualifiedReason) {
    parts.push(String(qualifiedReason).replace(/\.$/, ''));
  }

  if (score >= 78) {
    parts.push('high-impact');
  }

  return parts.length ? `${parts.join(' · ')}.` : 'Matched the current release-watch rules.';
}

function getReferencePointForCompany(companyId = '') {
  return RADAR_REFERENCE_POINTS.find((reference) => reference.companyId === companyId) || null;
}

function hasHardInvestableEvidence(text = '') {
  return /\b(s-1|registration statement|filed|files|filing|prices|priced|begins trading|start trading|starts trading|started trading|stock ticker|ticker symbol|direct listing|listed|publicly traded)\b/i.test(text);
}

function isSpeculativeDirectNews(text = '') {
  if (hasHardInvestableEvidence(text)) {
    return false;
  }

  return DIRECT_NEWS_SPECULATION_PATTERNS.some((pattern) => pattern.test(text));
}

function isOldYearPage(item) {
  const text = `${item.title} ${item.description} ${item.link}`.toLowerCase();
  const hasOldYear = /\b(2025|2024|2023|2022|2021|2020)\b/.test(text) || /٢٠٢٥|٢٠٢٤|٢٠٢٣|٢٠٢٢/i.test(text);
  const hasNewYear = /\b(2026|2027|2026\/2027|2027\/2026)\b/.test(text) || /٢٠٢٦|٢٠٢٧/i.test(text);
  return hasOldYear && !hasNewYear;
}

function matchDirectNotificationRule(item, context = {}) {
  const text = `${item.title} ${item.description} ${item.publisher} ${item.sourceLabel}`.toLowerCase();
  if ((!context.officialSource && !context.trustedPress) || isSpeculativeDirectNews(text)) {
    return null;
  }

  for (const rule of DIRECT_NEWS_NOTIFICATION_RULES) {
    if (!rule.companyPatterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    // Special filter for King Abdullah Schools: reject old-year pages
    if (rule.id === 'king_abdullah_schools_application') {
      if (isOldYearPage(item)) {
        continue;
      }
    }

    const triggerMatches = rule.triggerPatterns
      .filter((pattern) => pattern.test(text))
      .map((pattern) => pattern.source);
    if (!triggerMatches.length) {
      continue;
    }

    return {
      ...rule,
      triggerMatches,
      referencePoint: getReferencePointForCompany(rule.sourceId),
    };
  }

  return null;
}

function buildDirectNotificationEvaluation(item, context, directRule) {
  const score = context.officialSource ? 100 : 92;
  const sourceReference = directRule.referencePoint || getReferencePointForCompany(directRule.sourceId);
  const qualifiedReason = `${directRule.sourceRequirement} Matched direct trigger: ${directRule.label}.`;
  const directReason = `${directRule.sourceLabel} direct notification: ${directRule.reason}`;
  const category = directRule.category || 'ai';
  const releaseClassification = directRule.releaseClassification || 'investment_access_change';
  const releaseClassificationLabel = directRule.releaseClassificationLabel || 'Investment access change';
  const releaseClassificationScope = directRule.releaseClassificationScope || 'primary_vendor';
  const releaseClassificationImportance = directRule.releaseClassificationImportance || 'major';
  const whyItMatters =
    directRule.whyItMatters ||
    'This may change whether the company is directly investable. Verify the source before acting; this is a news alert, not investment advice.';
  const priorityMetadata = buildPriorityMetadata({
    alertKind: 'direct_news_notification',
    priorityTag: directRule.priorityTag || 'investment_access',
    priorityTags: directRule.priorityTags || ['investment_access', 'world_impact'],
    priorityReason: directRule.reason,
  });
  const stableFingerprint = buildAlertFingerprint({
    category,
    url: item.link,
    title: item.title,
    release_watch_company: directRule.sourceId,
    release_classification: releaseClassification,
  });
  const alert = {
    id: hashAlertId(`${category}-direct`, item.link || item.title, item.publishedAt || '', directRule.id),
    category,
    title: item.title,
    url: item.link,
    source: item.publisher,
    publishedAt: item.publishedAt,
    summary: item.description || 'Direct source notification matched.',
    importance: 'major',
    score,
    source_type: context.sourceType,
    official_source: Boolean(context.officialSource),
    qualified_reason: qualifiedReason,
    rejected_reason: '',
    release_watch_company: directRule.sourceId,
    release_watch_company_label: directRule.sourceLabel,
    release_watch_signal: 'direct_news_notification',
    release_watch_scope: 'primary_vendor',
    release_watch_reason: qualifiedReason,
    release_classification: releaseClassification,
    release_classification_label: releaseClassificationLabel,
    release_classification_reason: directReason,
    release_classification_scope: releaseClassificationScope,
    release_classification_score: score,
    release_classification_importance: releaseClassificationImportance,
    direct_notification_rule_id: directRule.id,
    direct_notification_label: directRule.label,
    direct_notification_source_id: directRule.sourceId,
    direct_notification_source_label: directRule.sourceLabel,
    direct_notification_reason: directReason,
    direct_notification_source_requirement: directRule.sourceRequirement,
    priority: 'Direct',
    direct_notification_trigger_matches: directRule.triggerMatches,
    source_reference: sourceReference,
    source_reference_points: sourceReference ? [sourceReference] : [],
    whyItMatters,
    why_notified: directReason,
    whyNotified: directReason,
    thumbnail: item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.image || item.imageUrl || item.coverImage || null,
    thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || item.thumbnail || item.image || item.imageUrl || item.coverImage || null,
    thumbnail_url: item.thumbnail_url || item.thumbnailUrl || item.thumbnail || item.image || item.imageUrl || item.coverImage || null,
    image: item.image || item.imageUrl || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.coverImage || null,
    imageUrl: item.imageUrl || item.image || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.coverImage || null,
    coverImage: item.coverImage || item.image || item.imageUrl || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || null,
    ...priorityMetadata,
    fingerprint: stableFingerprint,
    stable_fingerprint: stableFingerprint,
  };

  return {
    alert,
    review: buildReviewEntry(item, {
      sourceType: context.sourceType,
      officialSource: context.officialSource,
      score,
      qualifiedReason,
      raw: {
        ...alert,
      },
    }),
  };
}

function buildReviewEntry(item, fields = {}) {
  const reviewedAt = new Date().toISOString();
  const rejectedReason = fields.rejectedReason || '';
  const qualifiedReason = fields.qualifiedReason || '';
  return {
    id: hashAlertId('review', item.category, item.title, item.publisher || '', item.publishedAt || '', rejectedReason || 'accepted'),
    category: item.category,
    title: item.title,
    url: item.link || '',
    source: item.publisher || '',
    publishedAt: item.publishedAt || null,
    source_type: fields.sourceType || item.sourceHint || 'unknown',
    official_source: Boolean(fields.officialSource),
    score: Number(fields.score || 0),
    qualified_reason: qualifiedReason,
    rejected_reason: rejectedReason,
    reviewed_at: reviewedAt,
    raw: {
      source_id: item.sourceId || '',
      source_label: item.sourceLabel || '',
      ...fields.raw,
    },
  };
}

function countPatternHits(text = '', patterns = []) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function buildPriorityMetadata({
  alertKind = 'general',
  priorityTag = '',
  priorityTags = [],
  priorityReason = '',
} = {}) {
  const tags = Array.from(
    new Set(
      [priorityTag, ...(Array.isArray(priorityTags) ? priorityTags : [])]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );

  return {
    alert_kind: alertKind,
    priority_tag: tags[0] || '',
    priority_tags: tags,
    priority_reason: priorityReason,
  };
}

function scoreAiItem(item) {
  const text = `${item.title} ${item.description} ${item.publisher} ${item.sourceLabel}`.toLowerCase();
  const { sourceType, officialSource, trustedPress } = classifySource(item);
  const releaseWatchCompany = classifyReleaseWatchCompany(item);
  const directNotificationRule = matchDirectNotificationRule(item, {
    sourceType,
    officialSource,
    trustedPress,
  });
  const releaseHits = [];
  const strongHits = [];
  const productHits = [];
  let score = 0;

  if (directNotificationRule) {
    return buildDirectNotificationEvaluation(item, {
      sourceType,
      officialSource,
      trustedPress,
    }, directNotificationRule);
  }

  if (!AI_COMPANY_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score: 0,
        rejectedReason: 'missing_major_ai_company',
      }),
    };
  }

  if (AI_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score: 0,
        rejectedReason: 'negative_or_non_product_coverage',
      }),
    };
  }

  if (AI_JUNK_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score: 0,
        rejectedReason: 'generic_ai_noise',
      }),
    };
  }

  if (!AI_CONTEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score: 0,
        rejectedReason: 'missing_ai_context',
      }),
    };
  }

  if (officialSource) {
    score += 24;
  } else if (trustedPress) {
    score += 14;
  } else {
    score += 4;
  }

  if (/\b(official|blog|newsroom)\b/i.test(`${item.publisher} ${item.sourceLabel}`)) {
    score += 8;
  }

  for (const entry of AI_RELEASE_PATTERNS) {
    if (entry.pattern.test(text)) {
      score += entry.weight;
      releaseHits.push(entry.pattern.source);
    }
  }

  for (const entry of AI_STRONG_SIGNAL_PATTERNS) {
    if (entry.pattern.test(text)) {
      score += entry.weight;
      strongHits.push(entry.pattern.source);
    }
  }

  for (const entry of AI_PRODUCT_SIGNAL_PATTERNS) {
    if (entry.pattern.test(text)) {
      score += entry.weight;
      productHits.push(entry.pattern.source);
    }
  }

  if (AI_VALUE_PATTERNS.some((pattern) => pattern.test(text))) {
    score += 10;
  }

  if (/\b(gpt|claude|gemini|llama|grok|copilot|bedrock|nova)\b/i.test(text)) {
    score += 14;
  }

  if (/\bhugging\s*face\b/i.test(text) && /\b(space|model|tool|app|assistant)\b/i.test(text)) {
    score += 16;
  }

  const ageHours = hoursSince(item.publishedAt);
  if (ageHours <= 12) {
    score += 12;
  } else if (ageHours <= 36) {
    score += 6;
  }

  score = Math.max(0, Math.min(score, 100));
  const hasPreciseModelName = AI_PRECISE_MODEL_NAME_PATTERN.test(text);
  const titleHasPreciseModelName = AI_PRECISE_MODEL_NAME_PATTERN.test(String(item.title || ''));
  const titleHasStrongReleaseLanguage = AI_STRONG_SIGNAL_PATTERNS.some(({ pattern }) => pattern.test(String(item.title || '')));
  if (
    AI_GENERIC_CASE_STUDY_TITLE_PATTERN.test(String(item.title || ''))
    && !titleHasPreciseModelName
    && !titleHasStrongReleaseLanguage
  ) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score,
        rejectedReason: 'missing_strong_release_signal',
      }),
    };
  }
  const strongReleaseLanguage = strongHits.length > 0 || hasPreciseModelName;
  const hasOfficialVendorReleaseSignal = Boolean(
    officialSource
    && releaseWatchCompany
    && strongReleaseLanguage
    && productHits.length > 0
  );

  if (!hasOfficialVendorReleaseSignal && (releaseHits.length === 0 || strongHits.length === 0 || productHits.length === 0)) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score,
        rejectedReason: 'missing_strong_release_signal',
      }),
    };
  }

  if (!officialSource && !trustedPress) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score,
        rejectedReason: 'untrusted_source_for_ai_claim',
      }),
    };
  }

  const scoreThreshold = officialSource ? 44 : 68;
  if (score < scoreThreshold) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score,
        rejectedReason: 'below_quality_threshold',
      }),
    };
  }

  const qualifiedReason = officialSource
    ? 'Official vendor source with a clear model/platform release signal.'
    : 'High-trust press corroboration with a clear model/platform release signal.';
  const releaseWatchMetadata = buildReleaseWatchMetadata(item, releaseWatchCompany, {
    officialSource,
    releaseHits,
    strongHits,
    productHits,
  });
  const releaseClassification = buildReleaseClassification(item, {
    officialSource,
    trustedPress,
    releaseWatchCompany,
  });

  if (releaseClassification.release_classification === 'general_release') {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        officialSource,
        score,
        rejectedReason: 'missing_strong_release_signal',
        raw: {
          release_classification: releaseClassification.release_classification,
          release_classification_label: releaseClassification.release_classification_label,
        },
      }),
    };
  }

  const whyNotified = buildWhyNotifiedMessage({
    releaseClassification,
    releaseWatchMetadata,
    qualifiedReason,
    score,
  });
  const priorityMetadata = buildPriorityMetadata({
    alertKind: 'major_ai_release',
    priorityTag: 'world_impact',
    priorityTags: ['world_impact'],
    priorityReason: releaseClassification.release_classification_label || qualifiedReason,
  });
  const stableFingerprint = buildAlertFingerprint({
    category: 'ai',
    url: item.link,
    title: item.title,
    release_watch_company: releaseWatchMetadata.release_watch_company,
    release_classification: releaseClassification.release_classification,
  });

  const alert = {
    id: hashAlertId('ai', item.link || item.title, item.publishedAt || ''),
    category: 'ai',
    title: item.title,
    url: item.link,
    source: item.publisher,
    publishedAt: item.publishedAt,
    summary: item.description || 'Important AI update detected.',
    importance: score >= 78 ? 'major' : 'important',
    score,
    source_type: sourceType,
    official_source: officialSource,
    qualified_reason: qualifiedReason,
    rejected_reason: '',
    release_watch_company: releaseWatchMetadata.release_watch_company,
    release_watch_company_label: releaseWatchMetadata.release_watch_company_label,
    release_watch_signal: releaseWatchMetadata.release_watch_signal,
    release_watch_scope: releaseWatchMetadata.release_watch_scope,
    release_watch_reason: releaseWatchMetadata.release_watch_reason,
    release_classification: releaseClassification.release_classification,
    release_classification_label: releaseClassification.release_classification_label,
    release_classification_reason: releaseClassification.release_classification_reason,
    release_classification_scope: releaseClassification.release_classification_scope,
    release_classification_score: releaseClassification.release_classification_score,
    release_classification_importance: releaseClassification.release_classification_importance,
    whyItMatters:
      score >= 78
        ? 'This looks like a high-impact launch or upgrade rather than a routine AI update.'
        : 'This appears to be a meaningful AI change with practical or commercial impact.',
    why_notified: whyNotified,
    whyNotified,
    thumbnail: item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.image || item.imageUrl || item.coverImage || null,
    thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || item.thumbnail || item.image || item.imageUrl || item.coverImage || null,
    thumbnail_url: item.thumbnail_url || item.thumbnailUrl || item.thumbnail || item.image || item.imageUrl || item.coverImage || null,
    image: item.image || item.imageUrl || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.coverImage || null,
    imageUrl: item.imageUrl || item.image || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.coverImage || null,
    coverImage: item.coverImage || item.image || item.imageUrl || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || null,
    ...priorityMetadata,
    fingerprint: stableFingerprint,
    stable_fingerprint: stableFingerprint,
  };

  return {
    alert,
    review: buildReviewEntry(item, {
      sourceType,
      officialSource,
      score,
      qualifiedReason,
      raw: {
        release_watch_company: releaseWatchMetadata.release_watch_company,
        release_watch_company_label: releaseWatchMetadata.release_watch_company_label,
        release_watch_signal: releaseWatchMetadata.release_watch_signal,
        release_watch_scope: releaseWatchMetadata.release_watch_scope,
        release_watch_reason: releaseWatchMetadata.release_watch_reason,
        release_classification: releaseClassification.release_classification,
        release_classification_label: releaseClassification.release_classification_label,
        release_classification_reason: releaseClassification.release_classification_reason,
        release_classification_scope: releaseClassification.release_classification_scope,
        release_classification_score: releaseClassification.release_classification_score,
        release_classification_importance: releaseClassification.release_classification_importance,
        why_notified: whyNotified,
        ...priorityMetadata,
        fingerprint: stableFingerprint,
      },
    }),
  };
}

function scoreGeoItem(item) {
  const text = `${item.title} ${item.description} ${item.publisher} ${item.sourceLabel}`.toLowerCase();
  const { sourceType, trustedPress } = classifySource(item);
  const criticalHits = GEO_CRITICAL_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const elevatedHits = GEO_ELEVATED_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const supportHits = GEO_ESCALATION_SUPPORT_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const regionalScopeHits = countPatternHits(text, GEO_REGIONAL_SCOPE_PATTERNS);
  const politicalContextHits = countPatternHits(text, GEO_MAJOR_POLITICAL_CONTEXT_PATTERNS);
  const politicalEventHits = countPatternHits(text, GEO_MAJOR_POLITICAL_EVENT_PATTERNS);
  const majorPoliticalSignal = politicalContextHits > 0 && politicalEventHits > 0;
  const contentText = `${item.title} ${item.description}`.toLowerCase();
  const isJordanOrIran = /\b(jordan(?:ian)?|iran(?:ian)?)\b/i.test(contentText);
  let score = 0;

  if (!majorPoliticalSignal && regionalScopeHits === 0 && !isJordanOrIran) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        score: 0,
        rejectedReason: 'missing_regional_or_major_political_scope',
      }),
    };
  }

  if (GEO_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        score: 0,
        rejectedReason: 'analysis_or_background_only',
      }),
    };
  }

  if (!trustedPress) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        score: 0,
        rejectedReason: 'source_not_in_high_trust_geo_set',
      }),
    };
  }

  if (!majorPoliticalSignal && !isJordanOrIran && criticalHits === 0 && !(elevatedHits > 0 && supportHits > 0)) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        score: 0,
        rejectedReason: 'geo_signal_too_indirect',
      }),
    };
  }

  if (majorPoliticalSignal) {
    score += politicalEventHits * 16;
    score += politicalContextHits * 6;
    score += 10;
  } else {
    score += criticalHits * 18;
    score += elevatedHits * 10;
    score += supportHits * 6;
  }

  score += regionalScopeHits * 4;

  if (/\b(us|american|israel|israeli|jordan|jordanian|gulf|military|centcom|forces)\b/i.test(text)) {
    score += 10;
  }

  const ageHours = hoursSince(item.publishedAt);
  if (ageHours <= 12) {
    score += 12;
  } else if (ageHours <= 36) {
    score += 6;
  }

  if (isJordanOrIran) {
    score = Math.max(score, 78);
  }

  score = Math.max(0, Math.min(score, 100));
  const threatLevel = pickThreatLevel(score);
  if (threatLevel === 'Low') {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType,
        score,
        rejectedReason: 'geo_threat_below_elevated',
      }),
    };
  }

  const getJordanRelevance = (t) => {
    const hasEconomic = /\b(economic|economy|oil|gas|trade|financial|finance|market|aid|budget|tourism|price|prices|stock|stocks|energy|sanctions|sanction)\b/i.test(t);
    const hasSecurity = /\b(security|missile|attack|strike|war|military|forces|troops|clash|bomb|drone|defense|retaliation|evacuate|combat|hostage|hostages|clashes|artillery|airstrike|airstrikes|shooting|shelling)\b/i.test(t);
    const hasAction = /\b(evacuation|action|closure|mobilization|response|intercept|alert|warning|threat|close|restrict|deploy|airspace|border|flee|fleeing|ban|embargo)\b/i.test(t);

    if (hasEconomic && !hasSecurity) return 'economic';
    if (hasSecurity) return 'security';
    if (hasEconomic) return 'economic';
    if (hasAction) return 'action';
    return 'security';
  };

  const relevance = getJordanRelevance(contentText);
  const priorityTag = isJordanOrIran ? 'high_priority' : (majorPoliticalSignal ? 'major_political' : 'regional_impact');
  const priorityTags = isJordanOrIran
    ? ['high_priority', `jordan_relevance:${relevance}`, ...(majorPoliticalSignal ? ['major_political'] : ['regional_impact'])]
    : (majorPoliticalSignal && regionalScopeHits > 0
      ? ['major_political', 'regional_impact']
      : [priorityTag]);
  const qualifiedReason = isJordanOrIran
    ? `High-priority Jordan/Iran alert with ${relevance} relevance.`
    : (majorPoliticalSignal
      ? 'High-trust geopolitics source with major political event indicators.'
      : `High-trust geopolitics source with ${threatLevel} escalation indicators.`);

  const priorityMetadata = buildPriorityMetadata({
    alertKind: isJordanOrIran ? 'high_priority_geo_alert' : (majorPoliticalSignal ? 'major_political_event' : 'regional_impact_event'),
    priorityTag,
    priorityTags,
    priorityReason: qualifiedReason,
  });

  const alert = {
    id: hashAlertId('geo', item.link || item.title, item.publishedAt || ''),
    category: 'geo',
    title: item.title,
    url: item.link,
    source: item.publisher,
    publishedAt: item.publishedAt,
    summary: item.description || 'Important regional security development detected.',
    threatLevel,
    score,
    source_type: sourceType,
    official_source: false,
    qualified_reason: qualifiedReason,
    rejected_reason: '',
    thumbnail: item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.image || item.imageUrl || item.coverImage || null,
    thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || item.thumbnail || item.image || item.imageUrl || item.coverImage || null,
    thumbnail_url: item.thumbnail_url || item.thumbnailUrl || item.thumbnail || item.image || item.imageUrl || item.coverImage || null,
    image: item.image || item.imageUrl || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.coverImage || null,
    imageUrl: item.imageUrl || item.image || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.coverImage || null,
    coverImage: item.coverImage || item.image || item.imageUrl || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || null,
    ...priorityMetadata,
    whyItMatters:
      isJordanOrIran
        ? `This alert is highly relevant to regional risk regarding Jordan and Iran (${relevance}).`
        : (majorPoliticalSignal
          ? 'This is a major political event that can quickly reshape the news cycle and downstream public response.'
          : threatLevel === 'Critical'
          ? 'This suggests direct escalation or disruption that could rapidly affect regional security.'
          : 'This may raise regional risk above the normal background noise and is worth tracking.'),
    fingerprint: buildAlertFingerprint({
      category: 'geo',
      url: item.link,
      title: item.title,
    }),
  };

  if (isJordanOrIran) {
    alert.jordan_relevance = relevance;
    alert.jordanRelevance = relevance;
    alert.importance = 'major';
    alert.priority = 'High';
  }

  return {
    alert,
    review: buildReviewEntry(item, {
      sourceType,
      score,
      qualifiedReason,
      raw: {
        ...priorityMetadata,
      },
    }),
  };
}

function normalizeItem(item) {
  if (!item.title || !item.link) {
    return {
      alert: null,
      review: buildReviewEntry(item, {
        sourceType: item.sourceHint || 'unknown',
        score: 0,
        rejectedReason: 'missing_title_or_link',
      }),
    };
  }

  if (item.category === 'ai') {
    return scoreAiItem(item);
  }

  if (item.category === 'geo') {
    return scoreGeoItem(item);
  }

  return null;
}

function dedupeAlerts(alerts) {
  const byKey = new Map();

  for (const alert of alerts) {
    const key = alert.fingerprint || buildAlertFingerprint(alert);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, alert);
      continue;
    }

    const existingRank = Number(existing.score || 0) + (existing.official_source ? 20 : 0);
    const nextRank = Number(alert.score || 0) + (alert.official_source ? 20 : 0);
    if (nextRank > existingRank) {
      byKey.set(key, alert);
    }
  }

  return [...byKey.values()];
}

function balanceAlerts(alerts) {
  const aiAlerts = alerts.filter((alert) => alert.category === 'ai');
  const geoAlerts = alerts.filter((alert) => alert.category === 'geo');
  const balanced = [];

  const leadCategory = (
    !geoAlerts.length
      ? 'ai'
      : !aiAlerts.length
        ? 'geo'
        : Number(aiAlerts[0]?.score || 0) >= Number(geoAlerts[0]?.score || 0)
          ? 'ai'
          : 'geo'
  );

  if (leadCategory === 'ai') {
    if (aiAlerts.length > 0) {
      balanced.push(aiAlerts.shift());
    }
    if (geoAlerts.length > 0) {
      balanced.push(geoAlerts.shift());
    }
  } else {
    if (geoAlerts.length > 0) {
      balanced.push(geoAlerts.shift());
    }
    if (aiAlerts.length > 0) {
      balanced.push(aiAlerts.shift());
    }
  }

  return balanced.concat(aiAlerts, geoAlerts);
}

function getAlertPublishedAtMs(alert = {}) {
  const publishedAt = new Date(alert.publishedAt || alert.seenAt || alert.updatedAt || 0).getTime();
  return Number.isFinite(publishedAt) ? publishedAt : 0;
}

function isOfficialReleaseAlert(alert = {}) {
  const title = String(alert?.title || '');
  const genericCaseStudyTitle = AI_GENERIC_CASE_STUDY_TITLE_PATTERN.test(title);
  const titleHasPreciseModelName = AI_PRECISE_MODEL_NAME_PATTERN.test(title);
  const titleHasStrongReleaseLanguage = AI_STRONG_SIGNAL_PATTERNS.some(({ pattern }) => pattern.test(title));
  return Boolean(
    alert
    && alert.category === 'ai'
    && alert.official_source
    && alert.release_watch_company
    && String(alert.release_watch_signal || '').toLowerCase() === 'official_release'
    && (!genericCaseStudyTitle || titleHasPreciseModelName || titleHasStrongReleaseLanguage)
  );
}

function sortAcceptedAlerts(alerts = []) {
  return [...alerts].sort((left, right) => {
    const leftOfficialRelease = isOfficialReleaseAlert(left);
    const rightOfficialRelease = isOfficialReleaseAlert(right);
    const leftPublishedAt = getAlertPublishedAtMs(left);
    const rightPublishedAt = getAlertPublishedAtMs(right);

    if (leftOfficialRelease !== rightOfficialRelease) {
      return rightOfficialRelease ? 1 : -1;
    }

    if (leftOfficialRelease && rightOfficialRelease && leftPublishedAt !== rightPublishedAt) {
      return rightPublishedAt - leftPublishedAt;
    }

    const leftRank = Number(left.score || 0) + (left.official_source ? 18 : 0);
    const rightRank = Number(right.score || 0) + (right.official_source ? 18 : 0);

    if (rightRank !== leftRank) {
      return rightRank - leftRank;
    }

    return rightPublishedAt - leftPublishedAt;
  });
}

function normalizeCompanySelection(companies = []) {
  const values = Array.isArray(companies)
    ? companies
    : String(companies || '')
      .split(',');

  return new Set(
    values
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeReleaseImportance(value = 'important') {
  const normalized = String(value || 'important').trim().toLowerCase();
  return normalized === 'major' ? 'major' : 'important';
}

function meetsMinimumReleaseImportance(alert = {}, minimumImportance = 'important') {
  const required = normalizeReleaseImportance(minimumImportance);
  if (required === 'important') {
    return true;
  }

  return String(alert.importance || 'important').trim().toLowerCase() === 'major';
}

function sortLatestOfficialReleaseAlerts(alerts = []) {
  return [...alerts].sort((left, right) => {
    const leftPublishedAt = getAlertPublishedAtMs(left);
    const rightPublishedAt = getAlertPublishedAtMs(right);
    const leftPrimary = isPrimaryReleaseWatchCompany(left.release_watch_company);
    const rightPrimary = isPrimaryReleaseWatchCompany(right.release_watch_company);
    const leftReleasePriority = AI_RELEASE_TYPE_PRIORITY.get(String(left.release_classification || '').toLowerCase()) || 0;
    const rightReleasePriority = AI_RELEASE_TYPE_PRIORITY.get(String(right.release_classification || '').toLowerCase()) || 0;

    if (rightReleasePriority !== leftReleasePriority) {
      return rightReleasePriority - leftReleasePriority;
    }

    const leftRank = Number(left.score || 0) + (left.official_source ? 18 : 0) + (leftPrimary ? 8 : 0);
    const rightRank = Number(right.score || 0) + (right.official_source ? 18 : 0) + (rightPrimary ? 8 : 0);

    if (rightRank !== leftRank) {
      return rightRank - leftRank;
    }

    if (leftPublishedAt !== rightPublishedAt) {
      return rightPublishedAt - leftPublishedAt;
    }

    const leftCompany = String(left.release_watch_company_label || left.release_watch_company || '').toLowerCase();
    const rightCompany = String(right.release_watch_company_label || right.release_watch_company || '').toLowerCase();
    if (leftCompany !== rightCompany) {
      return leftCompany.localeCompare(rightCompany);
    }

    return String(right.title || '').localeCompare(String(left.title || ''));
  });
}

function selectLatestOfficialReleaseAlerts(alerts = [], options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, MAX_CACHED_ALERTS));
  const selectedCompanies = normalizeCompanySelection(
    options.companies ?? options.company ?? options.releaseWatchCompany ?? []
  );
  const minimumImportance = normalizeReleaseImportance(options.minImportance ?? options.minimumImportance);
  const MAX_AGE_DAYS = 3;
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  const officialAlerts = dedupeAlerts(
    (Array.isArray(alerts) ? alerts : []).filter((alert) => {
      if (!isOfficialReleaseAlert(alert)) {
        return false;
      }

      const publishedAtMs = getAlertPublishedAtMs(alert);
      if (publishedAtMs && (Date.now() - publishedAtMs) > maxAgeMs) {
        return false;
      }

      if (!meetsMinimumReleaseImportance(alert, minimumImportance)) {
        return false;
      }

      const releasePriority = AI_RELEASE_TYPE_PRIORITY.get(String(alert.release_classification || '').toLowerCase()) || 0;
      if (releasePriority <= 0) {
        return false;
      }

      if (!selectedCompanies.size) {
        return true;
      }

      return selectedCompanies.has(String(alert.release_watch_company || '').toLowerCase());
    })
  );

  const primaryOfficialAlerts = officialAlerts.filter((alert) => isPrimaryReleaseWatchCompany(alert.release_watch_company));
  const defaultOfficialAlerts = officialAlerts.filter((alert) => DEFAULT_RELEASE_WATCH_COMPANY_IDS.has(String(alert.release_watch_company || '').toLowerCase()));
  const scopedAlerts = selectedCompanies.size
    ? officialAlerts
      .filter((alert) => selectedCompanies.has(String(alert.release_watch_company || '').toLowerCase()))
    : (defaultOfficialAlerts.length > 0
      ? defaultOfficialAlerts
      : (primaryOfficialAlerts.length > 0 ? primaryOfficialAlerts : officialAlerts));

  return sortLatestOfficialReleaseAlerts(scopedAlerts).slice(0, limit);
}

async function fetchSourceDefinition(definition) {
  if (definition.kind === 'huggingface_models' || definition.kind === 'huggingface_spaces') {
    const targetUrl = definition.kind === 'huggingface_spaces' ? HUGGING_FACE_SPACES_API : HUGGING_FACE_MODELS_API;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'eXploreRadar/1.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Feed request failed: ${definition.id} (${response.status})`);
    }

    return buildHuggingFaceItems(definition, await response.json());
  }

  if (definition.kind === 'official_landing_page') {
    return fetchOfficialLandingPageItems(definition);
  }

  const targetUrl = definition.feedUrl || buildGoogleNewsUrl(definition.query);
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'eXploreRadar/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Feed request failed: ${definition.id} (${response.status})`);
  }

  const xml = await response.text();
  return parseFeed(xml, definition);
}

async function fetchHuggingFaceSignals() {
  const requests = [
    { url: HUGGING_FACE_MODELS_URL, kind: 'model' },
    { url: HUGGING_FACE_SPACES_URL, kind: 'space' },
  ];
  const settled = await Promise.allSettled(
    requests.map(async (request) => {
      const response = await fetch(request.url, {
        headers: {
          'User-Agent': 'eXploreRadar/1.0',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Hugging Face API request failed (${response.status})`);
      }

      return {
        kind: request.kind,
        items: await response.json(),
      };
    })
  );

  const normalized = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value.items)) {
      continue;
    }

    for (const item of result.value.items) {
      const likes = Number(item.likes || 0);
      const downloads = Number(item.downloads || 0);
      const createdAt = item.createdAt || item.lastModified || null;
      const repoId = item.id || item.modelId || item.name;
      if (!repoId || !createdAt) {
        continue;
      }

      const isModel = result.value.kind === 'model';
      const isSpace = result.value.kind === 'space';
      const engagementOk = isModel
        ? (likes >= 12 || downloads >= 4000)
        : (likes >= 8);

      if (!engagementOk) {
        continue;
      }

      normalized.push({
        title: isModel
          ? `New Hugging Face model: ${repoId}`
          : `New Hugging Face tool: ${repoId}`,
        link: `https://huggingface.co/${isSpace ? 'spaces/' : ''}${repoId}`,
        description: [
          isModel ? 'High-signal new model on Hugging Face.' : 'High-signal new AI tool on Hugging Face.',
          item.pipeline_tag ? `Type: ${item.pipeline_tag}.` : '',
          likes ? `Likes: ${likes}.` : '',
          downloads ? `Downloads: ${downloads}.` : '',
          Array.isArray(item.tags) && item.tags.length ? `Tags: ${item.tags.slice(0, 4).join(', ')}.` : '',
        ].filter(Boolean).join(' '),
        publisher: 'Hugging Face',
        category: 'ai',
        sourceLabel: isModel ? 'Hugging Face model registry' : 'Hugging Face Spaces',
        sourceHint: 'official',
        sourceId: isModel ? 'huggingface-model-api' : 'huggingface-space-api',
        publishedAt: new Date(createdAt).toISOString(),
      });
    }
  }

  return normalized;
}

async function collectAlerts() {
  const directFeedDefinitions = getDirectRadarFeedDefinitions();
  const settled = await Promise.allSettled(
    [...SOURCE_DEFINITIONS, ...directFeedDefinitions].map(async (definition) => fetchSourceDefinition(definition))
  );

  const feedItems = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      feedItems.push(...result.value);
    }
  }

  const reviews = [];
  const acceptedAlerts = [];

  for (const item of feedItems) {
    const evaluation = normalizeItem(item);
    if (!evaluation?.review) {
      continue;
    }

    reviews.push(evaluation.review);
    if (evaluation.alert) {
      acceptedAlerts.push(evaluation.alert);
    }
  }

  const alerts = balanceAlerts(dedupeAlerts(sortAcceptedAlerts(acceptedAlerts)));

  return {
    alerts: alerts.slice(0, MAX_CACHED_ALERTS),
    reviewLog: reviews.slice(0, MAX_REVIEW_LOG_ITEMS),
  };
}

function shouldKeepCachedAlerts(nextAlerts, radar = cachedRadar) {
  return !nextAlerts.length && Boolean(radar.checkedAt) && radar.alerts.length > 0;
}

async function getPriorityAlerts() {
  const now = Date.now();
  if (cachedRadar.checkedAt && now - cachedRadar.checkedAt < CACHE_TTL_MS) {
    return {
      checkedAt: new Date(cachedRadar.checkedAt).toISOString(),
      alerts: cachedRadar.alerts,
      reviewLog: [],
      cacheAgeMs: now - cachedRadar.checkedAt,
    };
  }

  try {
    const payload = await collectAlerts();
    if (shouldKeepCachedAlerts(payload.alerts)) {
      return {
        checkedAt: new Date(cachedRadar.checkedAt).toISOString(),
        alerts: cachedRadar.alerts,
        reviewLog: payload.reviewLog || [],
        cacheAgeMs: now - cachedRadar.checkedAt,
      };
    }

    cachedRadar = {
      checkedAt: now,
      alerts: payload.alerts,
    };

    return {
      checkedAt: new Date(cachedRadar.checkedAt).toISOString(),
      alerts: cachedRadar.alerts,
      reviewLog: payload.reviewLog || [],
      cacheAgeMs: 0,
    };
  } catch (error) {
    if (!cachedRadar.checkedAt) {
      throw error;
    }
  }

  return {
    checkedAt: new Date(cachedRadar.checkedAt).toISOString(),
    alerts: cachedRadar.alerts,
    reviewLog: [],
    cacheAgeMs: now - cachedRadar.checkedAt,
  };
}

module.exports = {
  buildAlertFingerprint,
  balanceAlerts,
  dedupeAlerts,
  getDirectNotificationRules,
  getDirectRadarFeedDefinitions,
  getPriorityAlerts,
  getRadarReferencePoints,
  isOfficialReleaseAlert,
  matchDirectNotificationRule,
  scoreAiItem,
  scoreGeoItem,
  selectLatestOfficialReleaseAlerts,
  shouldKeepCachedAlerts,
  sortAcceptedAlerts,
};
