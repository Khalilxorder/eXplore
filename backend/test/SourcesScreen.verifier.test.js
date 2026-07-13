const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('SourcesScreen Static Verification', () => {
  const filePath = path.join(__dirname, '..', '..', 'src', 'app', 'components', 'SourcesScreen.js');
  const content = fs.readFileSync(filePath, 'utf8');

  // Verify API calls are imported and invoked
  assert.ok(content.includes('fetchSourcePacks'), 'SourcesScreen.js should import/reference fetchSourcePacks');
  assert.ok(content.includes('addSourcePack'), 'SourcesScreen.js should import/reference addSourcePack');
  assert.ok(content.includes('updateSourcePack'), 'SourcesScreen.js should import/reference updateSourcePack');

  // Verify the UI rendering elements
  assert.ok(content.includes('Lane:'), 'SourcesScreen.js should display the lane badge');
  assert.ok(content.includes('pack.lane'), 'SourcesScreen.js should bind pack.lane');
  assert.ok(content.includes('Sources:'), 'SourcesScreen.js should display the source count');
  assert.ok(content.includes('source_pack_count'), 'SourcesScreen.js should bind discovery source_pack_count');
  assert.ok(content.includes('generated_sources'), 'SourcesScreen.js should reference generated_sources');
  assert.ok(content.includes('watch_questions'), 'SourcesScreen.js should reference watch_questions');
  assert.ok(content.includes('spider_policy'), 'SourcesScreen.js should render source-pack spider policy');
  assert.ok(content.includes('interpretation_lenses'), 'SourcesScreen.js should render source-pack interpretation lenses');
  assert.ok(content.includes('gap_awareness'), 'SourcesScreen.js should render source-pack gap awareness');
  assert.ok(content.includes('final_theory_feedback'), 'SourcesScreen.js should render source-pack Final Theory feedback');
  assert.ok(content.includes('handleRateSourcePack'), 'SourcesScreen.js should let users rate source packs');
});
