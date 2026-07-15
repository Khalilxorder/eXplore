'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIRECT_LATEST_RELEASE_COMPANIES,
  isDirectOfficialLabReleaseAlert,
  isPartnerMarketingNewsItem,
  isPlatformAvailabilityNewsItem,
  isVideoOnlyNewsItem,
  selectDistinctDirectEvents,
} = require('../src/services/directFeedQualityService');

test('limits direct official releases to the four monitored labs and their own domains', () => {
  assert.deepEqual(DIRECT_LATEST_RELEASE_COMPANIES, ['openai', 'anthropic', 'google', 'xai']);

  assert.equal(isDirectOfficialLabReleaseAlert({
    category: 'ai',
    official_source: true,
    release_watch_signal: 'official_release',
    release_watch_company: 'anthropic',
    url: 'https://www.anthropic.com/news/claude-release',
  }), true);

  assert.equal(isDirectOfficialLabReleaseAlert({
    category: 'ai',
    official_source: true,
    release_watch_signal: 'official_release',
    release_watch_company: 'openai',
    url: 'https://aws.amazon.com/blogs/machine-learning/openai-gpt-available-on-bedrock/',
  }), false);
});

test('keeps video commentary and partner case studies out of direct latest news', () => {
  assert.equal(isVideoOnlyNewsItem({
    content_type: 'video',
    channel_type: 'socialVideo',
    url: 'https://www.youtube.com/watch?v=example',
  }), true);

  assert.equal(isPartnerMarketingNewsItem({
    title: 'ScienceSoft\'s HIPAA-compliant AI voice scheduler built on AWS',
    source: 'AWS Machine Learning feed',
  }), true);

  assert.equal(isPlatformAvailabilityNewsItem({
    title: 'OpenAI GPT is now generally available on Amazon Bedrock',
    source: 'AWS Machine Learning feed',
  }), true);
});

test('keeps direct regional news to distinct events instead of repeated conflict angles', () => {
  const selected = selectDistinctDirectEvents([
    { id: 'trade', title: 'Iran threatens to block trade routes', reason: 'Urgent regional update.' },
    { id: 'shipping-repeat', title: 'Tehran targeting shipping after US strikes on Iran', reason: 'Urgent regional update.' },
    { id: 'strikes', title: 'Trump threatens to bomb bridges unless Iran resumes talks', reason: 'Urgent regional update.' },
    { id: 'missiles', title: 'Air defences shoot down missiles fired from Iran', reason: 'Urgent regional update.' },
    { id: 'gaza', title: 'Two injured in the Gaza Strip', reason: 'Urgent regional update.' },
  ], { maxRegionalItems: 3 });

  assert.deepEqual(selected.map((item) => item.id), ['trade', 'strikes', 'missiles']);
});
