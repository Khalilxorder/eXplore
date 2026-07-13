import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const root = process.cwd();
const priorityRadarPath = resolve(root, 'src/app/components/PriorityRadarScreen.js');
const apiPath = resolve(root, 'src/app/lib/api.js');
const routesPath = resolve(root, 'backend/src/routes/alerts.js');
const servicePath = resolve(root, 'backend/src/services/eventSourceMapService.js');

const priorityRadarSource = readFileSync(priorityRadarPath, 'utf8');
const apiSource = readFileSync(apiPath, 'utf8');
const routesSource = readFileSync(routesPath, 'utf8');
const { getEventSourceMap, getEventSourceMapSummary } = require(servicePath);

assert.match(apiSource, /export\s+async\s+function\s+fetchEventSourceMap\s*\(/, 'api.js must export fetchEventSourceMap');
assert.match(apiSource, /\/api\/v1\/alerts\/source-map/, 'fetchEventSourceMap must call the source-map endpoint');
assert.match(routesSource, /fastify\.get\('\/source-map'/, 'alerts route must expose /source-map');

assert.match(priorityRadarSource, /fetchEventSourceMap/, 'Priority Radar must fetch the event source map');
assert.match(priorityRadarSource, /Watched sources/, 'Priority Radar must visibly label the watched-source box');
assert.match(priorityRadarSource, /Event source map lanes/, 'Priority Radar must expose the lane row to accessibility tooling');
assert.match(priorityRadarSource, /overflowX:\s*'auto'/, 'watched-source lanes must be horizontally scrollable');
assert.match(priorityRadarSource, /overflowY:\s*'auto'/, 'source lists inside lanes must be scrollable');
assert.match(priorityRadarSource, /sourceMapSummary\.sourceCount/, 'watched-source box must show source counts');
assert.match(priorityRadarSource, /sourceMapSummary\.laneCount/, 'watched-source box must show lane counts');
assert.doesNotMatch(priorityRadarSource, /slice\(0,\s*4\)/, 'watched-source box must not hide configured references');

const sourceMap = getEventSourceMap();
const summary = getEventSourceMapSummary();
const laneLabels = sourceMap.lanes.map((lane) => lane.label);

assert.equal(summary.laneCount, 5, 'event source map should keep the five required lanes');
assert.ok(summary.sourceCount >= 38, 'event source map should include the configured reference base');
assert.ok(summary.aiAdvantageSourceCount >= 20, 'AI Advantage must keep at least 20 sources');
for (const label of ['War', 'AI Advantage', 'Markets', 'Art/Meaning', 'Personal Opportunities']) {
  assert.ok(laneLabels.includes(label), `missing lane: ${label}`);
}

console.log(JSON.stringify({
  passed: true,
  laneCount: summary.laneCount,
  sourceCount: summary.sourceCount,
  aiAdvantageSourceCount: summary.aiAdvantageSourceCount,
}, null, 2));
