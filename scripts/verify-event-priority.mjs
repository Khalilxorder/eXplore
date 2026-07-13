import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'src', 'app', 'lib', 'eventOnlyIntelligence.js');
const homeScreenPath = path.join(projectRoot, 'src', 'app', 'components', 'HomeScreen.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const homeScreen = fs.readFileSync(homeScreenPath, 'utf8');

const runnableSource = source
  .replace(/\bexport\s+const\s+/g, 'const ')
  .replace(/\bexport\s+function\s+/g, 'function ');

const storage = new Map();
const context = {
  console,
  window: {
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  },
};

const api = vm.runInNewContext(`${runnableSource}
({
  EVENT_PRIORITY_LEVELS,
  buildEventOnlyIntelligence,
  getEventOnlyPriorityScore,
  getEventPriorityStorageKey,
  inferPriorityRadarCompanyFromEvent,
  loadEventPriorityMap,
  saveEventPriorityLevel,
});
`, context, { filename: sourcePath });

assert.equal(
  JSON.stringify(api.EVENT_PRIORITY_LEVELS.map((level) => level.key)),
  JSON.stringify(['watch', 'important', 'direct']),
  'event priority must expose exactly Watch, Important, and Direct in order',
);

const anthropicItem = {
  id: 'event-1',
  title: 'Anthropic files confirmed direct listing documents',
  summary: 'Claude maker Anthropic gives investors a new access path.',
  source: 'Anthropic News',
  url: 'https://www.anthropic.com/news/direct-listing',
};
const sourceMap = {
  lanes: [
    {
      id: 'ai_advantage',
      label: 'AI Advantage',
      priority: 2,
      sources: [
        {
          id: 'anthropic-official',
          label: 'Anthropic News',
          priority: 'critical',
          url: 'https://www.anthropic.com/news',
          sourceType: 'official',
        },
      ],
    },
  ],
};

const storageKey = api.getEventPriorityStorageKey(anthropicItem);
assert.match(storageKey, /^event:/, 'event priority storage keys must be stable event keys');

const initial = api.buildEventOnlyIntelligence(anthropicItem, {}, sourceMap);
assert.equal(initial.sourceMapMatch.source.id, 'anthropic-official');
assert.equal(initial.meaning.split(/\s+/).length, 3, 'event meaning must stay three words');

const watchMap = api.saveEventPriorityLevel(anthropicItem, 'watch', {});
const importantMap = api.saveEventPriorityLevel(anthropicItem, 'important', watchMap);
const directMap = api.saveEventPriorityLevel(anthropicItem, 'direct', importantMap);
assert.equal(api.loadEventPriorityMap()[storageKey], 'direct');

const watchScore = api.getEventOnlyPriorityScore(anthropicItem, watchMap, sourceMap);
const importantScore = api.getEventOnlyPriorityScore(anthropicItem, importantMap, sourceMap);
const directScore = api.getEventOnlyPriorityScore(anthropicItem, directMap, sourceMap);
assert.ok(watchScore < importantScore, 'Important must outrank Watch');
assert.ok(importantScore < directScore, 'Direct must outrank Important');

const company = api.inferPriorityRadarCompanyFromEvent(
  anthropicItem,
  api.buildEventOnlyIntelligence(anthropicItem, directMap, sourceMap),
);
assert.equal(company.companyId, 'anthropic');
assert.equal(company.directSourceId, 'anthropic');
assert.equal(company.supportsDirectNews, true);

const customSourceItem = {
  id: 'event-2',
  title: 'Product Hunt adds a new AI workflow tool with launch pricing',
  summary: 'A tool directory source produces a useful watched-reference event.',
  source: 'Product Hunt AI',
  url: 'https://www.producthunt.com/posts/ai-workflow-tool',
};
const customSourceMap = {
  lanes: [
    {
      id: 'ai_advantage',
      label: 'AI Advantage',
      priority: 2,
      sources: [
        {
          id: 'product-hunt-ai',
          label: 'Product Hunt AI',
          priority: 'high',
          url: 'https://www.producthunt.com/topics/artificial-intelligence',
          sourceType: 'directory',
        },
      ],
    },
  ],
};
const customEvent = api.buildEventOnlyIntelligence(customSourceItem, {}, customSourceMap);
const customTarget = api.inferPriorityRadarCompanyFromEvent(customSourceItem, customEvent);
assert.equal(customTarget.companyId, '');
assert.equal(customTarget.directSourceId, 'product_hunt_ai');
assert.equal(customTarget.supportsDirectNews, true);

assert.match(homeScreen, /onPointerDown=\{\(event\) => handlePriorityPressStart\(event, item\)\}/);
assert.match(homeScreen, /onContextMenu=\{\(event\) => handlePriorityContextMenu\(event, item\)\}/);
assert.match(homeScreen, /handlePriorityLevelSelect\(event, item, level\.key\)/);
assert.match(homeScreen, /syncDirectPriorityToRadar\(item\)/);
assert.match(homeScreen, /directSourceId = sourceTarget\?\.directSourceId/);

console.log('event priority verifier passed');
