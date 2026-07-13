'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const {
  getScholarshipSourceRegistry,
  getJobSourceRegistry,
} = require('./sourceRegistry');

const OPPORTUNITIES_DIR = __dirname;
const SCHOLARSHIPS_DB_PATH = path.join(OPPORTUNITIES_DIR, 'scholarships.db');
const USER_PROFILE_PATH = path.join(OPPORTUNITIES_DIR, 'user_profile.json');
const JOB_OUTPUT_DIR = path.join(OPPORTUNITIES_DIR, 'output');
const JOB_RANKED_DIR = path.join(OPPORTUNITIES_DIR, 'ranked');

let scholarshipsDb = null;
let scholarshipsDbMtime = 0;
let activeJobSweepProcess = null;

function getIsoMtime(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch (_) {
    return null;
  }
}

function getProfileLensSummary(profile = getUserProfile()) {
  if (!profile || typeof profile !== 'object') {
    return {
      mission: 'Goal-connected opportunities',
      priorities: ['SPHERE-preserving', 'Budapest or remote', 'Research and creative alignment'],
      keyword_count: 0,
    };
  }

  const keywords = Array.isArray(profile.vision?.keywords) ? profile.vision.keywords : [];
  const preferences = profile.employment_preferences || {};
  const blacklist = profile.filter_blacklist || {};

  return {
    person_location: profile.personal?.location || '',
    education: profile.personal?.education || '',
    mission: profile.vision?.project || 'SPHERE',
    lens: profile.vision?.description || '',
    ideal_work: profile.vision?.ideal_job || '',
    priorities: [
      preferences.flexible_hours_required ? 'Flexible hours required' : null,
      preferences.remote_ok ? 'Remote-friendly' : null,
      profile.personal?.location ? `${profile.personal.location} reachable` : null,
      profile.vision?.project ? `${profile.vision.project} preserving` : null,
      'Psychology, AI, research, creative, writing, and English fit',
    ].filter(Boolean),
    preferred_types: Array.isArray(preferences.types) ? preferences.types : [],
    minimum_salary: {
      monthly_huf: preferences.min_salary_huf_monthly || null,
      hourly_huf: preferences.min_salary_huf_hourly || null,
    },
    top_keywords: keywords.slice(0, 14),
    keyword_count: keywords.length,
    filter_counts: {
      titles: Array.isArray(blacklist.titles) ? blacklist.titles.length : 0,
      companies: Array.isArray(blacklist.companies) ? blacklist.companies.length : 0,
      description_keywords: Array.isArray(blacklist.keywords_in_description) ? blacklist.keywords_in_description.length : 0,
    },
  };
}

function resolvePythonExecutable() {
  const candidates = [
    process.env.EXPLORE_PYTHON_PATH,
    process.env.PYTHON,
    process.env.PYTHON_EXE,
    path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

function normalizeRankGenerated(value) {
  if (!value || typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) {
    return `${value.replace(' ', 'T')}:00`;
  }
  return value;
}

function compactCounts(counts, limit = 10) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function normalizeNeedle(value = '') {
  return String(value || '').trim().toLowerCase();
}

// Compare registry ids and DB ingestion_source_ids ignoring punctuation drift,
// e.g. 'international_scholarships' (registry) vs 'internationalscholarships' (DB).
function normalizeId(value = '') {
  return normalizeNeedle(value).replace(/[^a-z0-9]/g, '');
}

function sourceIsPresent(source, observedNames = []) {
  const needles = [
    source.id,
    source.label,
    ...(Array.isArray(source.domains) ? source.domains : []),
  ].map(normalizeNeedle).filter(Boolean);

  return observedNames.some((observed) => {
    const normalizedObserved = normalizeNeedle(observed);
    return needles.some((needle) => normalizedObserved.includes(needle) || needle.includes(normalizedObserved));
  });
}

function buildCoverageReport(registry = [], observedCounts = [], options = {}) {
  const observedNames = observedCounts.map((entry) => entry.name || entry.source).filter(Boolean);
  const evidenceRows = Array.isArray(options.sourceEvidence) ? options.sourceEvidence : [];
  const staleAfterMs = Number(options.staleAfterMs || 0);
  const sources = registry.map((source) => {
    const observed = observedCounts.find((entry) => {
      const sourceId = normalizeId(entry.source_id || '');
      if (sourceId) {
        return sourceId === normalizeId(source.id);
      }
      return sourceIsPresent(source, [entry.name || entry.source]);
    });
    const present = Boolean(observed);
    const evidence = evidenceRows.find((entry) => {
      const sourceId = normalizeId(entry.source_id || '');
      if (sourceId) {
        return sourceId === normalizeId(source.id);
      }
      return sourceIsPresent(source, [entry.source || entry.name]);
    });
    const modifiedAt = evidence?.modified_at || null;
    const modifiedMs = Date.parse(String(modifiedAt || ''));
    const portalCount = Number(observed?.portal_count || 0);
    const listingCount = Number(observed?.listing_count || 0);
    const coverageKind = observed?.coverage_kind
      || (portalCount > 0 && listingCount === 0 ? 'portal_only' : 'listing');
    const stale = Boolean(
      present
      && staleAfterMs > 0
      && Number.isFinite(modifiedMs)
      && Date.now() - modifiedMs > staleAfterMs
    );
    const status = !present ? 'missing' : stale ? 'stale' : coverageKind === 'portal_only' ? 'portal_only' : 'covered';
    return {
      ...source,
      status,
      observed_count: Number(observed?.count || 0),
      listing_count: listingCount,
      portal_count: portalCount,
      coverage_kind: present ? coverageKind : null,
      modified_at: modifiedAt,
      stale,
    };
  });
  const covered = sources.filter((source) => source.status === 'covered');
  const present = sources.filter((source) => source.status !== 'missing');
  const stale = sources.filter((source) => source.status === 'stale');
  const portalOnly = sources.filter((source) => source.status === 'portal_only');
  const missing = sources.filter((source) => source.status === 'missing');
  const missingCritical = missing.filter((source) => source.tier === 'official' || source.tier === 'missing_high_value');

  return {
    checked_at: new Date().toISOString(),
    expected_count: sources.length,
    covered_count: covered.length,
    present_count: present.length,
    stale_count: stale.length,
    missing_count: missing.length,
    missing_critical_count: missingCritical.length,
    sources,
    covered: covered.map((source) => source.id),
    stale: stale.map((source) => source.id),
    portal_only: portalOnly.map((source) => source.id),
    missing: missing.map((source) => source.id),
    missing_critical: missingCritical.map((source) => source.id),
    summary: missingCritical.length
      ? `${present.length}/${sources.length} priority sources present; ${stale.length} stale; ${portalOnly.length} portal-only; ${missingCritical.length} critical sources still need direct adapters.`
      : `${present.length}/${sources.length} priority sources present; ${stale.length} stale; ${portalOnly.length} portal-only.`,
  };
}

function getJobOutputEvidence() {
  const evidence = {
    all_jobs_modified_at: null,
    source_files: [],
    source_counts: [],
    last_posted_at: null,
  };

  const allJobsPath = path.join(JOB_OUTPUT_DIR, 'ALL_jobs.json');
  evidence.all_jobs_modified_at = getIsoMtime(allJobsPath);

  try {
    if (fs.existsSync(JOB_OUTPUT_DIR)) {
      evidence.source_files = fs.readdirSync(JOB_OUTPUT_DIR)
        .filter((name) => name.endsWith('_jobs.json') && name !== 'ALL_jobs.json')
        .map((name) => ({
          source: name.replace(/_jobs\.json$/, ''),
          file: `output/${name}`,
          modified_at: getIsoMtime(path.join(JOB_OUTPUT_DIR, name)),
        }))
        .sort((a, b) => String(b.modified_at || '').localeCompare(String(a.modified_at || '')));
    }
  } catch (err) {
    console.error(`[error] Failed to inspect job output evidence: ${err.message}`);
  }

  try {
    if (fs.existsSync(allJobsPath)) {
      const jobs = JSON.parse(fs.readFileSync(allJobsPath, 'utf8'));
      if (Array.isArray(jobs)) {
        const sourceCounts = {};
        for (const job of jobs) {
          const source = job.source || 'unknown';
          sourceCounts[source] = (sourceCounts[source] || 0) + 1;
          if (job.date_posted && (!evidence.last_posted_at || job.date_posted > evidence.last_posted_at)) {
            evidence.last_posted_at = job.date_posted;
          }
        }
        evidence.source_counts = compactCounts(sourceCounts, Number.POSITIVE_INFINITY);
      }
    }
  } catch (err) {
    console.error(`[error] Failed to summarize ALL_jobs.json: ${err.message}`);
  }

  return evidence;
}

function getJobSourceCoverage(outputEvidence = getJobOutputEvidence()) {
  const sourceCounts = Array.isArray(outputEvidence.source_counts)
    ? outputEvidence.source_counts.map((entry) => ({ name: entry.name || entry.source, count: entry.count }))
    : [];
  return buildCoverageReport(getJobSourceRegistry(), sourceCounts, {
    sourceEvidence: outputEvidence.source_files,
    staleAfterMs: 3 * 24 * 60 * 60 * 1000,
  });
}

function getScholarshipSourceCoverage(sourceCounts = []) {
  return buildCoverageReport(getScholarshipSourceRegistry(), sourceCounts);
}

function withScholarshipSnapshotFreshness(coverage, freshness = {}) {
  const lastScrapedAt = freshness?.last_scraped_at || null;
  const snapshotStale = lastScrapedAt
    ? Date.now() - Date.parse(lastScrapedAt) > 3 * 24 * 60 * 60 * 1000
    : true;

  return {
    ...coverage,
    snapshot_stale: snapshotStale,
    snapshot_last_scraped_at: lastScrapedAt,
    summary: `${coverage.summary}${snapshotStale ? ' Scholarship snapshot is stale.' : ''}`,
  };
}

function getOpportunitySourceCoverage() {
  const scholarshipStats = getScholarshipStats();
  const scholarshipCoverage = scholarshipStats?.source_coverage
    || withScholarshipSnapshotFreshness(getScholarshipSourceCoverage());
  return {
    checked_at: new Date().toISOString(),
    jobs: getJobSourceCoverage(),
    scholarships: scholarshipCoverage,
  };
}

function scoreBreakdownLabels(breakdown = {}) {
  const labels = [];
  const keys = Object.keys(breakdown || {});
  const hasKey = (fragment) => keys.some((key) => key.includes(fragment));

  if (hasKey('vision')) labels.push('Vision keyword fit');
  if (hasKey('skills')) labels.push('Skill match');
  if (hasKey('remote')) labels.push('Remote-friendly');
  if (hasKey('budapest')) labels.push('Budapest fit');
  if (hasKey('english')) labels.push('English usable');
  if (hasKey('fresh')) labels.push('Fresh posting');
  if (hasKey('part_time')) labels.push('Flexible time');
  if (hasKey('salary')) labels.push('Salary floor');

  return labels;
}

function normalizeJobComparable(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\u00c0-\u024f]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function canonicalJobKey(job = {}) {
  const url = normalizeJobComparable(job.url || '');
  if (url) return `url:${url.replace(/\?.*$/, '')}`;

  const source = normalizeJobComparable(job.source || '');
  const jobId = normalizeJobComparable(job.job_id || job.id || '');
  if (source && jobId) return `id:${source}:${jobId}`;

  const title = normalizeJobComparable(job.title || '');
  const company = normalizeJobComparable(job.company || '');
  const city = normalizeJobComparable(firstPresent(job.city, job.location, job.location_full, job.country));
  return `text:${title}|${company}|${city || source}`;
}

function inferJobLocation(job = {}) {
  return firstPresent(
    job.location,
    job.location_full,
    job.city,
    job.country,
    job.region,
    job.source_location
  );
}

function inferJobLocationGroup(job = {}) {
  const text = normalizeJobComparable([
    job.remote,
    job.location,
    job.location_full,
    job.city,
    job.country,
    job.title,
    job.description,
  ].join(' '));

  if (/\b(remote|worldwide|anywhere|home office|work from home|fully remote)\b/.test(text)) {
    return 'remote';
  }

  if (/\b(hu|hungary|hungarian|budapest|debrecen|szeged|pecs|pécs|gyor|győr|miskolc|veszprem|veszprém)\b/.test(text)) {
    return 'hungary';
  }

  if (/\b(united states|usa|uk|united kingdom|germany|austria|netherlands|france|spain|poland|romania|slovakia|czech|switzerland|canada|worldwide)\b/.test(text)) {
    return 'outside';
  }

  return 'unknown';
}

function inferJobTypeGroup(job = {}) {
  const text = normalizeJobComparable([
    job.title,
    job.category,
    job.tags,
    job.description,
    job.employment_type,
    job.type,
  ].join(' '));

  if (/\b(intern|internship|trainee|student|graduate program)\b/.test(text)) return 'internship';
  if (/\b(psychology|clinical|therapy|therapist|mental health|counselor|counsellor|psychiatry)\b/.test(text)) return 'psychology';
  if (/\b(research|laboratory|lab|phd|postdoc|scientist|academic|university)\b/.test(text)) return 'research';
  if (/\b(ai|machine learning|ml|llm|data scientist|data engineer|python|software|developer|engineer|frontend|backend|full stack|cloud|devops)\b/.test(text)) return 'ai_software';
  if (/\b(analyst|business|operations|marketing|sales|seo|finance|consultant|product manager|project manager)\b/.test(text)) return 'data_business';
  if (/\b(writer|design|designer|creative|music|video|content|editor|artist)\b/.test(text)) return 'creative';
  return 'other';
}

function dedupeJobList(jobs = []) {
  const seen = new Set();
  const unique = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const key = canonicalJobKey(job);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(job);
  }
  return unique;
}

function enrichJob(job, category, sourceEvidenceByName = {}) {
  const source = job.source || 'unknown';
  const location = inferJobLocation(job);
  const locationGroup = inferJobLocationGroup(job);
  const typeGroup = inferJobTypeGroup(job);
  const labels = [
    category === 'cat3' ? 'SPHERE vision fit' : null,
    category === 'cat1' ? 'Apply-now fit' : null,
    category === 'cat2' ? 'Long-term option' : null,
    locationGroup === 'hungary' ? 'Hungary' : null,
    locationGroup === 'remote' ? 'Remote' : null,
    ...scoreBreakdownLabels(job._score_breakdown),
  ].filter(Boolean);

  return {
    ...job,
    location: location || job.location || '',
    location_group: locationGroup,
    job_type_group: typeGroup,
    canonical_key: canonicalJobKey(job),
    _goal_fit: {
      labels: [...new Set(labels)].slice(0, 7),
      summary: labels.length
        ? `Ranked through the profile lens for ${labels.slice(0, 3).join(', ')}.`
        : 'Ranked through the saved opportunity profile.',
    },
    _freshness: {
      posted_at: job.date_posted || null,
      valid_through: job.valid_through || null,
      source_last_seen_at: sourceEvidenceByName[source]?.modified_at || null,
      evidence: sourceEvidenceByName[source]?.file || null,
    },
  };
}

// Initialize scholarships database connection
function getScholarshipsDb() {
  if (!fs.existsSync(SCHOLARSHIPS_DB_PATH)) {
    console.warn(`[warn] Scholarships database not found at: ${SCHOLARSHIPS_DB_PATH}`);
    return null;
  }

  let currentMtime = 0;
  try {
    currentMtime = fs.statSync(SCHOLARSHIPS_DB_PATH).mtimeMs;
  } catch (_) {}

  if (scholarshipsDb && scholarshipsDbMtime === currentMtime) {
    return scholarshipsDb;
  }

  if (scholarshipsDb) {
    try {
      scholarshipsDb.close();
    } catch (_) {}
    scholarshipsDb = null;
  }

  try {
    scholarshipsDb = new Database(SCHOLARSHIPS_DB_PATH, { readonly: true });
    scholarshipsDbMtime = currentMtime;
    return scholarshipsDb;
  } catch (err) {
    console.error(`[error] Failed to open scholarships database: ${err.message}`);
    return null;
  }
}

/**
 * Get job statistics and categories.
 */
function getJobs() {
  const categories = {
    cat1_fast: path.join(JOB_RANKED_DIR, 'cat1_fast.json'),
    cat2_longterm: path.join(JOB_RANKED_DIR, 'cat2_longterm.json'),
    cat3_vision: path.join(JOB_RANKED_DIR, 'cat3_vision.json'),
    top10: path.join(JOB_RANKED_DIR, 'top10.json'),
  };
  const outputEvidence = getJobOutputEvidence();
  const sourceEvidenceByName = Object.fromEntries(
    outputEvidence.source_files.map((item) => [item.source, item])
  );

  const result = {
    meta: {
      _generated: new Date().toISOString(),
      _total: 0,
      _kept: 0,
      _cat1: 0,
      _cat2: 0,
      _cat3: 0,
    },
    top10: [],
    cat1: [],
    cat2: [],
    cat3: [],
  };

  try {
    if (fs.existsSync(categories.top10)) {
      const data = JSON.parse(fs.readFileSync(categories.top10, 'utf8'));
      const { jobs, top10, ...meta } = data;
      result.meta = { ...result.meta, ...meta };
      result.top10 = dedupeJobList(jobs || top10 || [])
        .map((job) => enrichJob(job, job._category || 'top10', sourceEvidenceByName));
    }
    if (fs.existsSync(categories.cat1_fast)) {
      const data = JSON.parse(fs.readFileSync(categories.cat1_fast, 'utf8'));
      result.cat1 = dedupeJobList(data.jobs || [])
        .map((job) => enrichJob(job, 'cat1', sourceEvidenceByName));
    }
    if (fs.existsSync(categories.cat2_longterm)) {
      const data = JSON.parse(fs.readFileSync(categories.cat2_longterm, 'utf8'));
      result.cat2 = dedupeJobList(data.jobs || [])
        .map((job) => enrichJob(job, 'cat2', sourceEvidenceByName));
    }
    if (fs.existsSync(categories.cat3_vision)) {
      const data = JSON.parse(fs.readFileSync(categories.cat3_vision, 'utf8'));
      result.cat3 = dedupeJobList(data.jobs || [])
        .map((job) => enrichJob(job, 'cat3', sourceEvidenceByName));
    }
  } catch (err) {
    console.error(`[error] Failed to read job rank JSON files: ${err.message}`);
  }

  result.meta = {
    ...result.meta,
    _generated_iso: normalizeRankGenerated(result.meta._generated),
    category_counts: {
      cat1_fast: result.meta._cat1 || result.cat1.length,
      cat2_longterm: result.meta._cat2 || result.cat2.length,
      cat3_vision: result.meta._cat3 || result.cat3.length,
      top10: result.top10.length,
    },
      source_counts: outputEvidence.source_counts,
      source_coverage: getJobSourceCoverage(outputEvidence),
      freshness: {
        ranked_generated_at: normalizeRankGenerated(result.meta._generated),
        ranked_file_modified_at: getIsoMtime(categories.top10),
        all_jobs_modified_at: outputEvidence.all_jobs_modified_at,
      last_posted_at: outputEvidence.last_posted_at,
      source_files: outputEvidence.source_files,
    },
    profile_lens: getProfileLensSummary(),
  };

  return result;
}

/**
 * Trigger a background job scraping and ranking run.
 */
function triggerJobSweep(testMode = false) {
  if (activeJobSweepProcess) {
    return { status: 'running', message: 'A sweep is already actively running.' };
  }

  const pythonScript = path.join(OPPORTUNITIES_DIR, 'run_all.py');
  const rankScript = path.join(OPPORTUNITIES_DIR, 'rank.py');
  const pythonExecutable = resolvePythonExecutable();

  const runAllArgs = testMode ? ['--test'] : [];
  
  console.log(`[sweep] Starting Job scrape process: ${pythonExecutable} ${pythonScript} ${runAllArgs.join(' ')}`);
  
  activeJobSweepProcess = spawn(pythonExecutable, [pythonScript, ...runAllArgs], {
    cwd: OPPORTUNITIES_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let outputLog = '';
  let errorLog = '';

  activeJobSweepProcess.stdout.on('data', (data) => {
    outputLog += data.toString();
  });

  activeJobSweepProcess.stderr.on('data', (data) => {
    errorLog += data.toString();
  });

  activeJobSweepProcess.on('error', (error) => {
    console.error(`[sweep-error] Could not start scraper process: ${error.message}`);
    activeJobSweepProcess = null;
  });

  activeJobSweepProcess.on('close', (code) => {
    console.log(`[sweep] Scrapers complete with code ${code}. Starting ranking...`);
    
    if (code !== 0) {
      console.error(`[sweep-error] Scraper step failed: ${errorLog}`);
      activeJobSweepProcess = null;
      return;
    }

    // Now run rank.py
    const rankProcess = spawn(pythonExecutable, [rankScript], {
      cwd: OPPORTUNITIES_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    rankProcess.on('close', (rankCode) => {
      console.log(`[sweep] Ranking complete with code ${rankCode}.`);
      activeJobSweepProcess = null;
    });
  });

  return { status: 'started', message: 'Background job sweep and scoring initialized.' };
}

/**
 * Load User Profile Preference
 */
function getUserProfile() {
  try {
    if (fs.existsSync(USER_PROFILE_PATH)) {
      return JSON.parse(fs.readFileSync(USER_PROFILE_PATH, 'utf8'));
    }
  } catch (err) {
    console.error(`[error] Failed to read user profile: ${err.message}`);
  }
  return null;
}

/**
 * Save User Profile Preference
 */
function saveUserProfile(profileData) {
  try {
    fs.writeFileSync(USER_PROFILE_PATH, JSON.stringify(profileData, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error(`[error] Failed to write user profile: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Get scholarship statistics.
 */
function getScholarshipStats() {
  const db = getScholarshipsDb();
  if (!db) return { error: 'Database unconfigured' };

  try {
    const total = db.prepare('SELECT COUNT(*) AS count FROM scholarships').get().count;
    const funded = db.prepare('SELECT COUNT(*) AS count FROM scholarships WHERE is_fully_funded = 1').get().count;
    const active = db.prepare(`
      SELECT COUNT(*) AS count
      FROM scholarships
      WHERE is_active = 1
        AND is_expired = 0
        AND (deadline IS NULL OR deadline = '' OR date(deadline) >= date('now'))
    `).get().count;
    const expired = db.prepare('SELECT COUNT(*) AS count FROM scholarships WHERE is_expired = 1').get().count;
    const layer1 = db.prepare('SELECT COUNT(*) AS count FROM scholarships WHERE ingestion_layer = 1').get().count;
    const layer2 = db.prepare('SELECT COUNT(*) AS count FROM scholarships WHERE ingestion_layer = 2').get().count;
    const layer3 = db.prepare('SELECT COUNT(*) AS count FROM scholarships WHERE ingestion_layer = 3').get().count;
    const freshness = db.prepare(`
      SELECT
        MAX(scraped_at) AS last_scraped_at,
        MAX(updated_at) AS last_updated_at,
        MAX(published_at) AS last_published_at
      FROM scholarships
    `).get();
    const sourceCounts = db.prepare(`
      SELECT
        NULLIF(ingestion_source_id, '') AS source_id,
        COALESCE(NULLIF(ingestion_source_id, ''), NULLIF(source_site, ''), 'unknown') AS name,
        COUNT(*) AS count,
        SUM(CASE WHEN opportunity_type = 'official_portal' THEN 1 ELSE 0 END) AS portal_count,
        SUM(CASE WHEN opportunity_type IS NULL OR opportunity_type != 'official_portal' THEN 1 ELSE 0 END) AS listing_count
      FROM scholarships
      GROUP BY source_id, name
      ORDER BY count DESC
    `).all();
    const activeSourceCounts = db.prepare(`
      SELECT
        NULLIF(ingestion_source_id, '') AS source_id,
        COALESCE(NULLIF(ingestion_source_id, ''), NULLIF(source_site, ''), 'unknown') AS name,
        COUNT(*) AS count,
        SUM(CASE WHEN opportunity_type = 'official_portal' THEN 1 ELSE 0 END) AS portal_count,
        SUM(CASE WHEN opportunity_type IS NULL OR opportunity_type != 'official_portal' THEN 1 ELSE 0 END) AS listing_count
      FROM scholarships
      WHERE is_active = 1
        AND is_expired = 0
        AND (deadline IS NULL OR deadline = '' OR date(deadline) >= date('now'))
      GROUP BY source_id, name
      ORDER BY count DESC
    `).all();
    const categoryCounts = db.prepare(`
      SELECT COALESCE(NULLIF(opportunity_type, ''), 'unknown') AS name, COUNT(*) AS count
      FROM scholarships
      GROUP BY name
      ORDER BY count DESC
      LIMIT 12
    `).all();
    const lastUpdated = freshness?.last_scraped_at ? freshness.last_scraped_at.slice(0, 10) : '';

    return {
      total,
      fully_funded: funded,
      active,
      expired,
      layer1,
      layer2,
      layer3,
      last_updated: lastUpdated,
      source_counts: compactCounts(Object.fromEntries(sourceCounts.map((entry) => [entry.name, entry.count])), 12),
      active_source_counts: compactCounts(Object.fromEntries(activeSourceCounts.map((entry) => [entry.name, entry.count])), 12),
      source_coverage: withScholarshipSnapshotFreshness(getScholarshipSourceCoverage(sourceCounts), freshness),
      active_source_coverage: withScholarshipSnapshotFreshness(getScholarshipSourceCoverage(activeSourceCounts), freshness),
      category_counts: categoryCounts,
      freshness: {
        last_scraped_at: freshness?.last_scraped_at || null,
        last_updated_at: freshness?.last_updated_at || null,
        last_published_at: freshness?.last_published_at || null,
        database_modified_at: getIsoMtime(SCHOLARSHIPS_DB_PATH),
        snapshot_stale: freshness?.last_scraped_at
          ? Date.now() - Date.parse(freshness.last_scraped_at) > 3 * 24 * 60 * 60 * 1000
          : true,
      },
      profile_lens: getProfileLensSummary(),
    };
  } catch (err) {
    console.error(`[error] Scholarship stats failed: ${err.message}`);
    return { error: err.message };
  }
}

function textIncludesAny(text, terms) {
  const haystack = String(text || '').toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function parseDateMs(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function textBlob(values = []) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .join(' ');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Region/country search aliases so "USA" also matches "United States", and
// "Europe" matches the major European host countries. Used to keep the region
// filter precise (structured fields + title only, never free-text description,
// which produced false positives like Colombia/Malaysia for a "USA" search).
const REGION_ALIASES = {
  usa: ['usa', 'united states', 'u.s.', 'america', 'american'],
  us: ['usa', 'united states', 'u.s.', 'america'],
  'united states': ['united states', 'usa', 'u.s.', 'america'],
  uk: ['united kingdom', 'uk', 'britain', 'british', 'england', 'scotland', 'wales'],
  'united kingdom': ['united kingdom', 'uk', 'britain', 'british', 'england'],
  europe: ['europe', 'european', 'erasmus', 'germany', 'france', 'italy', 'spain',
    'netherlands', 'sweden', 'norway', 'denmark', 'finland', 'belgium', 'austria',
    'switzerland', 'ireland', 'portugal', 'poland', 'hungary', 'czech', 'greece'],
  eu: ['europe', 'european', 'erasmus'],
};

function regionLikeTerms(region) {
  const key = normalizeNeedle(region);
  if (!key) return [];
  return [...new Set(REGION_ALIASES[key] || [key])];
}

function matchesScholarshipQuery(row, query) {
  const terms = String(query || '')
    .toLowerCase()
    .match(/[a-z0-9+#.-]+/g) || [];
  if (terms.length === 0) return true;

  const haystack = textBlob([
    row.title,
    row.description,
    row.tags,
    row.opportunity_type,
    row.host_countries,
    row.field_of_study,
  ]).toLowerCase();

  return terms.every((term) => {
    const aliases = term === 'ai'
      ? ['ai', 'artificial intelligence', 'machine learning']
      : [term];

    return aliases.some((alias) => {
      if (alias.length <= 3) {
        return new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i').test(haystack);
      }
      return haystack.includes(alias);
    });
  });
}

const SCHOLARSHIP_LISTING_SIGNAL = /\b(scholarship|fellowship|internship|residency|grant|programme?|bursary|studentship|exchange|mobility|research placement)\b/i;
const SCHOLARSHIP_CONTENT_NOISE_PATTERNS = [
  /\b\d+\s+(?:best|proven|easy|top|global)\b/i,
  /\b\d+\s+(?:application\s+|easy\s+|proven\s+|simple\s+|quick\s+)?tips\b/i,
  /\bapplication tips\b/i,
  /\bafter\s+(?:he|she|they|student|graduate)\b/i,
  /\b(?:student|graduate|alumnus|alumna)\s+(?:story|journey|wins?|earns?|receives?|awarded)\b/i,
  /\b(?:announces?|celebrates?|congratulates?)\b.{0,80}\b(?:winner|recipient|awardee|graduate)\b/i,
  /\bis work experience (?:important|necessary)\b/i,
  /\bways?\s+to\s+(?:make|earn|save|improve|write)\b/i,
  /\btools?\s+for\s+academic\s+writing\b/i,
  /\bcurrently\s+open\b/i,
  /\bhow\b.{0,100}\b(?:won|earned|secured|received|got)\b/i,
  /\b(?:won|wins?|earned|secured|received|got|bags?)\b.{0,100}\b(?:scholarship|award|grant|degree|university)\b/i,
  /\bwho\b.{0,100}\b(?:graduat|bags?|wins?|earns?|returns?|becomes?|celebrates?)\b/i,
  /\b(?:graduat|bags?|earns?)\b.{0,100}\b(?:degree|university|honou?rs?|first-class|achievement|award)\b/i,
  /\bcelebrates?\s+achievements?\b/i,
  /\b(?:lecturer|professor|teacher|instructor)\b/i,
];

function isScholarshipListingCandidate(d = {}) {
  if (String(d.opportunity_type || '').toLowerCase() === 'official_portal') {
    return false;
  }

  const title = String(d.title || '').trim();
  const description = String(d.description || '').trim();
  const text = `${title} ${description}`;
  // Require a real listing signal in the title (applies to all sources). This
  // intentionally drops thin official-portal nav junk (language switchers,
  // "Apply", "Home"); genuine official-program listings carry signal words
  // ("Fulbright Scholarship", "DAAD Scholarship", "Commonwealth Fellowship")
  // and still pass, then get the official-source ranking boost downstream.
  if (!title || !SCHOLARSHIP_LISTING_SIGNAL.test(title)) {
    return false;
  }

  if (SCHOLARSHIP_CONTENT_NOISE_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }

  const years = [...title.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  for (const match of title.matchAll(/\b20\d{2}\s*[/-]\s*(\d{2})\b/g)) {
    years.push(2000 + Number(match[1]));
  }
  const latestNamedYear = years.length ? Math.max(...years) : null;
  if (latestNamedYear && latestNamedYear < new Date().getFullYear()) {
    return false;
  }

  return true;
}

function canonicalScholarshipKey(item = {}) {
  const provider = normalizeNeedle(item.provider || item.source_site || item.host_organization || '');
  const country = normalizeNeedle(textBlob([item.host_countries, item.country]));
  const title = normalizeNeedle(item.title || '')
    .replace(/\b20\d{2}(?:\s*[/-]\s*\d{2})?\b/g, ' ')
    .replace(/\b(fully funded|partial funding|scholarships?|fellowships?|grants?|awards?|program(me)?|deadline|apply now|open)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const urlHost = (() => {
    try {
      return new URL(String(item.apply_url || item.source_url || item.url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return '';
    }
  })();

  return [title, provider || urlHost, country].filter(Boolean).join('|');
}

function dedupeScholarships(items = []) {
  const seen = new Set();
  const unique = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = canonicalScholarshipKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function findSourceRegistryMatch(d = {}) {
  const sourceText = textBlob([d.source_site, d.provider, d.source_url, d.apply_url, d.ingestion_source_id]).toLowerCase();
  return getScholarshipSourceRegistry().find((source) => {
    const values = [source.id, source.label, ...(Array.isArray(source.domains) ? source.domains : [])]
      .map(normalizeNeedle)
      .filter(Boolean);
    return values.some((value) => sourceText.includes(value));
  }) || null;
}

function scoreScholarshipProfileFit(d) {
  const labels = [];
  const fieldText = [
    d.title,
    d.description,
    Array.isArray(d.fields_of_study) ? d.fields_of_study.join(' ') : d.fields_of_study,
    Array.isArray(d.tags) ? d.tags.join(' ') : d.tags,
    d.opportunity_type,
  ].join(' ');
  const levelText = textBlob([d.levels, d.title, d.description]);
  const eligibilityText = textBlob([
    d.title,
    d.description,
    d.eligible_countries,
    d.eligible_regions,
    d.tags,
  ]);
  const sourceMatch = findSourceRegistryMatch(d);
  let score = 0;
  let goalSignalScore = 0;
  let eligibilityPenalty = false;

  const add = (condition, points, label) => {
    if (!condition) return;
    score += points;
    labels.push(label);
  };
  const addGoal = (condition, points, label) => {
    if (!condition) return;
    goalSignalScore += points;
    add(true, points, label);
  };

  add(Boolean(d.is_fully_funded), 18, 'Funding fit');
  add(!d.is_expired && d.is_active !== false, 20, 'Active apply queue');
  add(Boolean(d.is_rolling), 8, 'Rolling deadline');
  add(!d.deadline || parseDateMs(d.deadline) >= Date.now(), 10, 'Deadline viable');
  add(Boolean(d.is_verified), 5, 'Verified listing');
  const isOfficialSource = sourceMatch?.tier === 'official';
  add(isOfficialSource, 24, 'Official source');
  add(sourceMatch?.tier === 'aggregator', 5, 'Priority aggregator');
  addGoal(textIncludesAny(fieldText, ['psychology', 'cognitive', 'mental health', 'social science', 'behavioral', 'neuroscience']), 18, 'Psychology fit');
  addGoal(textIncludesAny(fieldText, ['ai', 'artificial intelligence', 'data science', 'machine learning', 'technology', 'automation', 'human-computer', 'computational']), 18, 'AI/data fit');
  addGoal(textIncludesAny(fieldText, ['research', 'fellowship', 'post-baccalaureate', 'phd', 'doctoral', 'lab', 'university']), 16, 'Research path');
  addGoal(textIncludesAny(fieldText, ['creative', 'arts', 'music', 'media', 'writing', 'journalism', 'communication', 'film']), 11, 'Creative path');
  addGoal(textIncludesAny(levelText, ['bachelor', 'undergraduate', 'master', 'graduate', 'msc', 'ma', 'research', 'phd', 'doctoral']), 10, 'Education-level fit');

  const countryText = [
    Array.isArray(d.host_countries) ? d.host_countries.join(' ') : d.host_countries,
    Array.isArray(d.eligible_regions) ? d.eligible_regions.join(' ') : d.eligible_regions,
    Array.isArray(d.eligible_countries) ? d.eligible_countries.join(' ') : d.eligible_countries,
  ].join(' ');
  add(
    textIncludesAny(countryText, [
      'global',
      'europe',
      'european',
      'hungary',
      'germany',
      'italy',
      'france',
      'united kingdom',
      'uk',
      'netherlands',
      'sweden',
      'norway',
      'united states',
      'usa',
      'canada',
      'international',
    ]),
    12,
    'Location flexible',
  );

  if (/\b(women|female|girls)\b/i.test(eligibilityText)) {
    score -= 35;
    eligibilityPenalty = true;
    labels.push('Eligibility review');
  }

  if (/\b(high school|secondary school|school students|under\s*18|national science competition)\b/i.test(eligibilityText)) {
    score -= 35;
    eligibilityPenalty = true;
    labels.push('Level review');
  }

  if (/\b(nigerian|ghanaian|kenyan|pakistani|indian|malaysian|indonesian|citizens only|nationals only)\b/i.test(eligibilityText)) {
    score -= 25;
    eligibilityPenalty = true;
    labels.push('Country eligibility review');
  }

  // Official Europe/USA sources are the user's stated priority, so they are
  // exempt from the thin-content and eligibility-review score caps.
  if (goalSignalScore === 0 && !isOfficialSource) {
    score = Math.min(score, 55);
  }

  if (eligibilityPenalty && !isOfficialSource) {
    score = Math.min(score, 45);
  }

  if (!labels.length) labels.push('Profile lens candidate');
  const uniqueLabels = [...new Set(labels)].slice(0, 7);
  const normalizedScore = Math.max(0, Math.min(100, score));

  return {
    score: normalizedScore,
    band: normalizedScore >= 70 ? 'strong' : normalizedScore >= 45 ? 'possible' : 'review',
    labels: uniqueLabels,
    tier: sourceMatch?.tier || null,
    is_official: isOfficialSource,
    summary: `Matched against the profile lens for ${uniqueLabels.slice(0, 3).join(', ')}.`,
  };
}

function scholarshipGoalFit(d) {
  return scoreScholarshipProfileFit(d);
}

function enrichScholarship(d) {
  if (!d) return null;
  const country = Array.isArray(d.host_countries) && d.host_countries.length
    ? d.host_countries.join(', ')
    : '';
  const profileFit = scholarshipGoalFit(d);

  return {
    ...d,
    url: d.apply_url || d.source_url || null,
    country,
    host_organization: d.provider || d.source_site || null,
    profile_match_score: profileFit.score,
    profile_match: profileFit,
    _goal_fit: profileFit,
    _freshness: {
      scraped_at: d.scraped_at || null,
      updated_at: d.updated_at || null,
      published_at: d.published_at || null,
      deadline: d.deadline || null,
      evidence: d.source_site || d.ingestion_source_id || null,
    },
  };
}

function compareScholarshipsByProfileFit(left, right) {
  const leftScore = Number(left?.profile_match_score || 0);
  const rightScore = Number(right?.profile_match_score || 0);
  if (rightScore !== leftScore) return rightScore - leftScore;

  const leftOfficial = left?._goal_fit?.is_official ? 1 : 0;
  const rightOfficial = right?._goal_fit?.is_official ? 1 : 0;
  if (rightOfficial !== leftOfficial) return rightOfficial - leftOfficial;

  const leftFunded = left?.is_fully_funded ? 1 : 0;
  const rightFunded = right?.is_fully_funded ? 1 : 0;
  if (rightFunded !== leftFunded) return rightFunded - leftFunded;

  const leftActive = !left?.is_expired && left?.is_active !== false ? 1 : 0;
  const rightActive = !right?.is_expired && right?.is_active !== false ? 1 : 0;
  if (rightActive !== leftActive) return rightActive - leftActive;

  const leftDeadline = parseDateMs(left?.deadline);
  const rightDeadline = parseDateMs(right?.deadline);
  if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;

  return String(left?.title || '').localeCompare(String(right?.title || ''));
}

/**
 * Parse scholarship row to clean JSON objects.
 */
function rowToDict(row) {
  if (!row) return null;
  const d = { ...row };
  
  for (const field of ['levels', 'fields_of_study', 'host_countries', 'eligible_countries', 'eligible_regions', 'tags']) {
    if (d[field] && typeof d[field] === 'string') {
      try {
        d[field] = JSON.parse(d[field]);
      } catch (err) {
        d[field] = [];
      }
    }
  }

  for (const field of ['is_fully_funded', 'is_expired', 'is_active', 'is_rolling', 'is_verified']) {
    if (field in d) {
      d[field] = Boolean(d[field]);
    }
  }

  return enrichScholarship(d);
}

/**
 * Search scholarships database.
 */
function searchScholarships(params = {}) {
  const db = getScholarshipsDb();
  if (!db) return [];

  const q = (params.q || '').trim();
  const level = (params.level || '').trim().toLowerCase();
  const region = (params.region || '').trim().toLowerCase();
  const funded = String(params.funded).toLowerCase() === 'true' || params.funded === '1';
  const includeExpired = String(params.include_expired).toLowerCase() === 'true' || params.include_expired === '1';
  const limit = Math.min(parseInt(params.limit) || 50, 200);
  const offset = parseInt(params.offset) || 0;
  const candidateLimit = 20000;

  const conditions = [];
  const args = [];

  if (!includeExpired) {
    conditions.push('(is_expired = 0 OR is_expired IS NULL)');
    conditions.push("(deadline IS NULL OR deadline = '' OR date(deadline) >= date('now'))");
  }

  if (funded) {
    conditions.push('is_fully_funded = 1');
  }

  if (level) {
    conditions.push('levels LIKE ?');
    args.push(`%"${level}"%`);
  }

  if (region) {
    const terms = regionLikeTerms(region);
    const clauses = terms.map(() =>
      '(eligible_regions LIKE ? OR host_countries LIKE ? OR eligible_countries LIKE ? OR tags LIKE ? OR title LIKE ?)'
    );
    for (const term of terms) {
      args.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
    }
    conditions.push(`(${clauses.join(' OR ')})`);
  }

  try {
    let rows = [];
    if (q) {
      const ftsWhere = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
      try {
        // Attempt full-text search first
        const ftsSql = `
          SELECT s.* FROM scholarships s
          JOIN scholarships_fts fts ON s.rowid = fts.rowid
          WHERE scholarships_fts MATCH ?
          AND ${ftsWhere}
          ORDER BY rank
          LIMIT ? OFFSET 0
        `;
        rows = db.prepare(ftsSql).all(q, ...args, candidateLimit);
      } catch (ftsErr) {
        rows = [];
      }

      if (rows.length === 0) {
        // Fallback to LIKE queries when FTS is unavailable or its shadow index is empty.
        const likeCond = '(title LIKE ? OR description LIKE ? OR tags LIKE ?)';
        const likeArgs = [`%${q}%`, `%${q}%`, `%${q}%`];
        const allConditions = [...conditions, likeCond];
        const where = allConditions.join(' AND ');
        const sql = `SELECT * FROM scholarships WHERE ${where} ORDER BY deadline ASC LIMIT ? OFFSET 0`;
        rows = db.prepare(sql).all(...args, ...likeArgs, candidateLimit);
      }
    } else {
      const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
      const sql = `
        SELECT * FROM scholarships
        WHERE ${where}
        ORDER BY
          CASE WHEN is_fully_funded = 1 THEN 0 ELSE 1 END,
          CASE WHEN deadline IS NULL OR deadline = '' THEN 1 ELSE 0 END,
          deadline ASC
        LIMIT ? OFFSET 0
      `;
      rows = db.prepare(sql).all(...args, candidateLimit);
    }

    const rankedScholarships = rows
      .filter((row) => matchesScholarshipQuery(row, q))
      .filter(isScholarshipListingCandidate)
      .map(rowToDict)
      .filter(Boolean)
      .sort(compareScholarshipsByProfileFit);

    return dedupeScholarships(rankedScholarships).slice(offset, offset + limit);
  } catch (err) {
    console.error(`[error] Scholarships search failed: ${err.message}`);
    return [];
  }
}

/**
 * Get scholarship by ID.
 */
function getScholarshipById(id) {
  const db = getScholarshipsDb();
  if (!db) return null;

  try {
    const row = db.prepare('SELECT * FROM scholarships WHERE id = ?').get(id);
    return row ? rowToDict(row) : null;
  } catch (err) {
    console.error(`[error] Failed to fetch scholarship ${id}: ${err.message}`);
    return null;
  }
}

module.exports = {
  getJobs,
  triggerJobSweep,
  getUserProfile,
  saveUserProfile,
  getScholarshipStats,
  searchScholarships,
  getScholarshipById,
  getOpportunitySourceCoverage,
  __test__: {
    buildCoverageReport,
    isScholarshipListingCandidate,
    matchesScholarshipQuery,
    withScholarshipSnapshotFreshness,
  },
};
