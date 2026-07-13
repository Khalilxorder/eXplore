import { readFileSync } from 'node:fs';

const dataSource = readFileSync('src/app/data/videoLibrary.js', 'utf8');
const screenSource = readFileSync('src/app/components/VideoLibraryScreen.js', 'utf8');

const requiredDataMarkers = [
  'VIDEO_LIBRARY_RESOURCE_TYPE_OPTIONS',
  'normalizeVideoLibraryResources',
  'buildVideoLibraryGapReport',
  'parseYouTubeFootprintPreview',
  'buildWatchHistoryRecommendationBrief',
  'trashVideos',
  'partitionVideosByQuality',
  'https://www.vision2030.gov.sa/en/overview',
  'https://ctc.westpoint.edu/harmony-program/',
  'https://www.wilsoncenter.org/blog-post/reintroducing-saddam-hussein-regime-collection-conflict-records-research-center',
  'https://openai.com/index/planning-for-agi-and-beyond/',
  'https://www.anthropic.com/news/core-views-on-ai-safety?cam=claude',
  'https://deepmind.google/science/alphafold/',
  'https://x.ai/about',
];

const requiredScreenMarkers = [
  'Coverage',
  'References',
  'Hidden noise',
  'figureSources',
  'Taste map',
  'Sync taste',
  'importHierarchyFootprint',
  'getVideoLibraryResourceTypeLabel',
  'buildVideoLibraryGapReport',
];

const missingDataMarkers = requiredDataMarkers.filter((marker) => !dataSource.includes(marker));
const missingScreenMarkers = requiredScreenMarkers.filter((marker) => !screenSource.includes(marker));
const resourceBlockCount = (dataSource.match(/\n\s+resources:\s+\[/g) || []).length;
const sourceUrlCount = (dataSource.match(/url:\s+'https?:\/\//g) || []).length;

const passed = !missingDataMarkers.length
  && !missingScreenMarkers.length
  && resourceBlockCount >= 8
  && sourceUrlCount >= 50;

const result = {
  passed,
  resourceBlockCount,
  sourceUrlCount,
  missingDataMarkers,
  missingScreenMarkers,
};

console.log(JSON.stringify(result, null, 2));

if (!passed) {
  process.exit(1);
}
