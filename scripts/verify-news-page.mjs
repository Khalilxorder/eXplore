import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

function readProjectFile(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function assertMarker(source, marker, message) {
  const found = marker instanceof RegExp ? marker.test(source) : source.includes(marker);
  if (!found) {
    throw new Error(message);
  }
}

const home = readProjectFile('src/app/components/HomeScreen.js');
const page = readProjectFile('src/app/page.js');
const preferences = readProjectFile('src/app/components/PreferencesScreen.js');
const scientist = readProjectFile('src/app/components/ScientistToolScreen.js');
const snapshot = readProjectFile('src/app/data/offlineFeedSnapshot.js');
const css = readProjectFile('src/app/globals.css');
const buildMetaPath = path.join(projectRoot, 'out', '__explore_build.json');
const sourceOnly = process.argv.includes('--source-only');

const expectedTabs = [
  ['home', 'News'],
  ['videos', 'Videos'],
  ['culture', 'Culture'],
  ['opportunities', 'Jobs'],
  ['scientist-tool', 'Scientist'],
  ['nobel-prizes', 'Nobel'],
  ['digest', 'Digest'],
  ['written-news', 'Written'],
  ['music-stats', 'Music'],
];

if (/EXPLORE_SECTION_ITEMS[\s\S]*label:\s*'Rules'/.test(page)) {
  throw new Error('Rules must not be a top-level Explore category tab; keep it in User/Profile only.');
}

if (/EXPLORE_SECTION_ITEMS[\s\S]*label:\s*'Messages'/.test(page)) {
  throw new Error('Messages must not be a top-level Explore category tab; keep it in app shell navigation only.');
}

if (/EXPLORE_SECTION_ITEMS[\s\S]*label:\s*'Mail'/.test(page)) {
  throw new Error('Mail must not be a top-level Explore category tab; keep it in User/Profile tools only.');
}

if (/EXPLORE_SECTION_ITEMS[\s\S]*label:\s*'XP'/.test(page)) {
  throw new Error('Xperience must not be a top-level Explore category tab; keep it in User/Profile only.');
}

if (/EXPLORE_SECTION_ITEMS[\s\S]*label:\s*'Shared'/.test(page)) {
  throw new Error('Shared Experience must not be a top-level Explore category tab; keep it in User/Profile only.');
}

assertMarker(page, /const showExploreTopTabs[\s\S]*screen === 'home'[\s\S]*screen === 'music-stats';/, 'Explore category tabs must be explicitly scoped to content screens.');
const showExploreTopTabsDeclaration = page.match(/const showExploreTopTabs[\s\S]*?;/)?.[0] || '';
if (/screen === 'messages'/.test(showExploreTopTabsDeclaration)) {
  throw new Error('Messages must not render the exploration category row.');
}
if (/screen === 'mail'/.test(showExploreTopTabsDeclaration)) {
  throw new Error('Mail must not render the exploration category row.');
}
if (/screen === 'experience'|screen === 'shared-experience'/.test(showExploreTopTabsDeclaration)) {
  throw new Error('Xperience and Shared Experience must not render the exploration category row.');
}

assertMarker(preferences, 'title="News Rules"', 'News Rules must remain reachable from the User/Profile section.');
assertMarker(preferences, 'View &amp; edit rules', 'User/Profile must keep the News Rules edit action.');
assertMarker(preferences, "onNavigate?.('experience')", 'Xperience must remain reachable from the User/Profile section.');
assertMarker(preferences, "onNavigate?.('shared-experience')", 'Shared Experience must remain reachable from the User/Profile section.');

for (const [screen, label] of expectedTabs) {
  assertMarker(
    page,
    new RegExp(`screen:\\s*'${screen}'[\\s\\S]*?label:\\s*'${label}'`),
    `Missing top category tab ${label} (${screen}).`,
  );
}

assertMarker(home, 'function normalizeEmergencySnapshotItems()', 'Latest news must build a nonblank emergency snapshot.');
assertMarker(home, 'emergencySnapshot: true', 'Emergency snapshot items must be marked explicitly.');
assertMarker(home, 'const MAX_VISIBLE_NEWS_AGE_HOURS = 72;', 'Latest news must use one explicit 72-hour visibility limit.');
assertMarker(home, 'isRecentEnough(item.date, MAX_VISIBLE_NEWS_AGE_HOURS)', 'Every rendered latest-news item must meet the 72-hour visibility limit.');
if (/if\s*\(item\?\.emergencySnapshot\)\s*\{\s*return true;/u.test(home)) {
  throw new Error('Emergency snapshots must not bypass the latest-news freshness limit.');
}
if (/isRecentEnough\(item\.date,\s*24\s*\*\s*(?:5|7|10)\)/u.test(home)) {
  throw new Error('Latest news must not keep category-specific items beyond the shared 72-hour limit.');
}
assertMarker(home, 'const [loading, setLoading] = useState(false);', 'Latest news must not boot into a blank skeleton-only state.');
assertMarker(home, 'initialSnapshotItems', 'Latest news must seed the first screen with fallback items.');
assertMarker(home, /applyEmergencySnapshot[\s\S]*?const snapshotItems = filterLatestNewsItems\(normalizeEmergencySnapshotItems\(\)\)/, 'Emergency snapshot must use normalized fallback items.');
assertMarker(home, 'feedRequestFlightRef', 'Latest news refreshes must use a single in-flight request.');
assertMarker(home, 'queuedFeedRequestRef', 'Latest news refreshes must coalesce one queued request.');
assertMarker(home, 'latestFeedRequestIdRef', 'Latest news refreshes must reject stale request completions.');
assertMarker(home, /refreshOrigin:\s*'pull'[\s\S]*?forceRefresh:\s*true|forceRefresh:\s*true[\s\S]*?refreshOrigin:\s*'pull'/, 'Pull-to-refresh must force the backend recalculation path.');
assertMarker(home, 'data-refresh-source={refreshIndicator.source', 'Refresh indicator must expose its current source.');
assertMarker(home, 'data-refresh-status={refreshIndicator.status}', 'Refresh indicator must expose its current status.');
const refreshButtons = (home.match(/<button\b[\s\S]*?<\/button>/g) || [])
  .filter((button) => /\brefresh\b/i.test(button));
if (refreshButtons.length) {
  throw new Error('Latest news must use pull-to-refresh without a permanent refresh button.');
}
assertMarker(home, 'data-event-only-card="true"', 'Latest news must render event-only cards.');
assertMarker(home, 'data-event-visual-cue="true"', 'Latest news cards must keep visual cues/images.');
assertMarker(home, 'event-rank-metrics', 'Latest news cards must keep ranking evidence metrics.');
assertMarker(home, 'EVENT_PRIORITY_LEVELS.map', 'Latest news cards must keep Watch/Important/Direct priority controls.');
assertMarker(home, 'pickEventVisualUrl(item)', 'Latest news cards must restore item images or favicons.');
assertMarker(home, 'shortenExplanation(rationale.whyShown', 'Latest news cards must show why an item was ranked.');
assertMarker(home, 'CLAUDE_FABLE_MYTHOS_PATTERN', 'Latest news must explicitly rank Claude Fable/Mythos signals.');
assertMarker(home, /if\s*\(CLAUDE_FABLE_MYTHOS_PATTERN\.test\(text\)\)\s*rank\s*\+=\s*280;/, 'Claude Fable/Mythos must receive a top AI-release ranking boost.');
assertMarker(snapshot, 'offline-official-claude-fable-mythos-5', 'Offline snapshot must include Claude Fable/Mythos as a high-priority Anthropic signal.');

assertMarker(scientist, 'openExternalUrl(SCIENTIST_TOOL_URL)', 'Scientist Tool must open directly.');
if (/<iframe/i.test(scientist)) {
  throw new Error('Scientist Tool must not embed the blocked site in an iframe.');
}

assertMarker(css, 'Desktop simplification: plain workspace', 'Desktop simplification CSS must remain present.');
assertMarker(css, /\.main-content::before\s*{\s*display:\s*none\s*!important;/, 'Desktop main content must not use the decorative mobile frame.');
assertMarker(css, /\.inbox-shell \.explore-section-nav\s*{\s*display:\s*none\s*!important;/, 'Messages must hide the exploration category row.');
assertMarker(css, /\.ai-chat-toggle-btn\s*{[\s\S]*right:\s*28px\s*!important;/, 'Desktop Ask AI button must stay out of the center of the feed.');

const snapshotItemCount = (snapshot.match(/id:\s*'offline-/g) || []).length;
if (snapshotItemCount < 6) {
  throw new Error(`Offline feed snapshot is too thin: ${snapshotItemCount} items.`);
}

if (!existsSync(buildMetaPath) && !sourceOnly) {
  throw new Error('Build metadata is missing. Run npm run build before npm run test:news-page.');
}

const buildMeta = existsSync(buildMetaPath)
  ? JSON.parse(readFileSync(buildMetaPath, 'utf8'))
  : null;
const report = {
  passed: true,
  sourceOnly,
  checked: {
    tabs: expectedTabs.length,
    snapshotItems: snapshotItemCount,
    buildId: buildMeta?.buildId || null,
    eventCards: true,
    images: true,
    metrics: true,
    pullRefreshOnly: true,
    sequencedRefresh: true,
    priorityLevels: true,
    scientistDirectOpen: true,
  },
};

console.log(JSON.stringify(report, null, 2));
