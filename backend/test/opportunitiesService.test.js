const test = require('node:test');
const assert = require('node:assert/strict');

const opportunitiesService = require('../opportunities/opportunitiesService');

const {
  buildCoverageReport,
  isScholarshipListingCandidate,
  matchesScholarshipQuery,
  withScholarshipSnapshotFreshness,
} = opportunitiesService.__test__;

test('scholarship listing gate rejects advice pages and success stories', () => {
  assert.equal(isScholarshipListingCandidate({
    title: 'Official portal: DAAD',
    description: 'Official source monitor entry.',
    opportunity_type: 'official_portal',
  }), false);

  assert.equal(isScholarshipListingCandidate({
    title: '10 Best AI Tools for Academic Writing in 2025',
    description: 'Academic writing tips and tool recommendations.',
    is_rolling: true,
  }), false);

  assert.equal(isScholarshipListingCandidate({
    title: 'Brilliant Lady graduates US university, wins full scholarship',
    description: 'A graduate celebrates her achievement.',
  }), false);

  assert.equal(isScholarshipListingCandidate({
    title: 'Alex Trebek Postdoctoral Fellowship - AI and Environment 2022',
    description: 'An old fellowship article with stale source metadata.',
    is_rolling: true,
  }), false);
});

test('scholarship listing gate keeps application-ready opportunities', () => {
  assert.equal(isScholarshipListingCandidate({
    title: 'MBZUAI Research Internship 2026 in UAE (Fully Funded)',
    description: 'Applications are now open for this research internship.',
    deadline: '2026-06-26T00:00:00',
  }), true);

  assert.equal(isScholarshipListingCandidate({
    title: 'Erasmus Mundus Global MINDS Scholarship 2026-28',
    description: 'A funded scholarship programme for international students.',
  }), true);
});

test('scholarship coverage exposes stale snapshot metadata', () => {
  const coverage = withScholarshipSnapshotFreshness({
    summary: '2/18 priority sources present.',
  }, {
    last_scraped_at: '2026-05-19T19:50:35.169705',
  });

  assert.equal(coverage.snapshot_stale, true);
  assert.equal(coverage.snapshot_last_scraped_at, '2026-05-19T19:50:35.169705');
  assert.match(coverage.summary, /snapshot is stale/i);
});

test('scholarship query matching treats AI as a word and expands useful synonyms', () => {
  assert.equal(matchesScholarshipQuery({
    title: 'Auburn University Scholarship 2026',
    description: 'A fully funded award for international applicants.',
  }, 'AI'), false);

  assert.equal(matchesScholarshipQuery({
    title: 'Erasmus Mundus Joint Master in AI Scholarship 2026',
    description: 'Applications are open.',
  }, 'AI'), true);

  assert.equal(matchesScholarshipQuery({
    title: 'Research Fellowship',
    description: 'A funded artificial intelligence research placement.',
  }, 'AI'), true);
});

test('coverage report distinguishes portal-only scholarship evidence from full coverage', () => {
  const report = buildCoverageReport([
    {
      id: 'daad',
      label: 'DAAD',
      domains: ['daad.de'],
      tier: 'official',
      url: 'https://daad.de/',
    },
  ], [
    {
      name: 'daad.de',
      count: 1,
      portal_count: 1,
      listing_count: 0,
    },
  ]);

  assert.equal(report.present_count, 1);
  assert.equal(report.covered_count, 0);
  assert.deepEqual(report.portal_only, ['daad']);
  assert.equal(report.sources[0].status, 'portal_only');
  assert.match(report.summary, /portal-only/);
});
