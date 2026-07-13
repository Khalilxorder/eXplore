'use client';
// eXplore — OpportunitiesScreen.js


import { useState, useEffect, useCallback, useRef } from 'react';
import { ambientSonifier } from '../lib/ambientSound';
import { apiFetch, fetchHierarchyState, generateLabsResearch } from '../lib/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatScore(val) {
  if (val === undefined || val === null) return '–';
  if (typeof val === 'number') return `${Math.round(val)}`;
  return String(val);
}

function parseScoreBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return [];
  return Object.entries(breakdown)
    .map(([key, val]) => ({
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: String(val),
    }))
    .filter((e) => e.value && e.value !== '0' && e.value !== '+0');
}

function formatDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function firstAvailable(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') || '';
}

function salaryLabel(item) {
  if (item.salary) return item.salary;
  const min = item.salary_min ? Number(item.salary_min).toLocaleString() : '';
  const max = item.salary_max ? Number(item.salary_max).toLocaleString() : '';
  if (min && max) return `${min}-${max} ${item.salary_currency || ''}`.trim();
  if (min) return `${min}+ ${item.salary_currency || ''}`.trim();
  return '';
}

function sourceCountsText(counts, limit = 4) {
  if (!Array.isArray(counts) || counts.length === 0) return '';
  return counts
    .slice(0, limit)
    .map((item) => `${item.name || item.source}: ${Number(item.count || 0).toLocaleString()}`)
    .join(' | ');
}

function MissingPrioritySourceLinks({ coverage, limit = 24 }) {
  const sources = Array.isArray(coverage?.sources)
    ? coverage.sources.filter((source) =>
        source.status === 'missing'
        && source.url
      ).slice(0, limit)
    : [];

  if (!sources.length) return null;

  return (
    <div className="opp-why-chips">
      {sources.map((source) => (
        <a
          key={source.id}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="opp-why-chip opp-why-chip--fit"
        >
          Open {source.label}
        </a>
      ))}
    </div>
  );
}

function categoryLabel(cat) {
  if (cat === 'cat3') return { label: 'Vision fit', color: '#a78bfa' };
  if (cat === 'cat1') return { label: 'Apply soon', color: 'var(--success)' };
  if (cat === 'cat2') return { label: 'Long-term', color: 'var(--accent)' };
  return { label: 'Ranked', color: 'var(--accent)' };
}

const JOB_LOCATION_FILTERS = [
  { id: 'all', label: 'All places' },
  { id: 'hungary', label: 'Hungary' },
  { id: 'remote', label: 'Remote' },
  { id: 'outside', label: 'Outside Hungary' },
  { id: 'unknown', label: 'Unknown' },
];

const JOB_TYPE_FILTERS = [
  { id: 'all', label: 'All types' },
  { id: 'ai_software', label: 'AI / Software' },
  { id: 'research', label: 'Research / Lab' },
  { id: 'psychology', label: 'Psychology / Clinical' },
  { id: 'internship', label: 'Internships' },
  { id: 'data_business', label: 'Data / Business' },
  { id: 'creative', label: 'Creative' },
  { id: 'other', label: 'Other' },
];

const TRACKED_OPPORTUNITIES = [
  {
    id: 'king-abdullah-schools-2026-2027',
    title: 'مدارس الملك عبدالله الثاني للتميز 2026/2027',
    organization: 'وزارة التربية والتعليم الأردنية',
    status: 'بانتظار الإعلان الرسمي',
    description: 'يتابع eXplore إعلان التقديم أو الترشح الرسمي، ورابط الطلب، وآخر موعد، والشروط، والفئات المشمولة، وموعد الاختبار.',
    sourceUrl: 'https://www.moe.gov.jo/ar/news',
    historicalUrl: 'https://onlinelearning.moe.gov.jo/app/Qst25/exc_index.php',
  },
];

function TrackedOpportunityCard({ opportunity }) {
  return (
    <article className="opp-card" dir="rtl" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div className="opp-card-header">
        <div className="opp-card-title-row">
          <span className="opp-cat-badge" style={{ color: 'var(--accent)' }}>متابعة رسمية</span>
          <span className="opp-meta-tag">{opportunity.status}</span>
        </div>
        <div className="opp-job-title">{opportunity.title}</div>
        <div className="opp-job-meta">
          <span className="opp-meta-tag">{opportunity.organization}</span>
          <span className="opp-meta-tag">الأردن</span>
          <span className="opp-meta-tag">قبول مدرسي</span>
        </div>
      </div>
      <div className="opp-card-body">
        <p className="opp-desc">{opportunity.description}</p>
        <p className="opp-evidence-line">لن يعرض eXplore رابط تقديم حتى تؤكده جهة رسمية للعام 2026/2027.</p>
        <div className="opp-why-chips">
          <span className="opp-why-chip opp-why-chip--fit">التقديم</span>
          <span className="opp-why-chip opp-why-chip--fit">آخر موعد</span>
          <span className="opp-why-chip opp-why-chip--fit">الشروط</span>
          <span className="opp-why-chip opp-why-chip--fit">موعد الاختبار</span>
        </div>
        <div className="opp-why-chips">
          <a href={opportunity.sourceUrl} target="_blank" rel="noopener noreferrer" className="opp-apply-btn">المصدر الرسمي</a>
          <a href={opportunity.historicalUrl} target="_blank" rel="noopener noreferrer" className="opp-why-chip">رابط تاريخي فقط</a>
        </div>
      </div>
    </article>
  );
}

function getJobViewKey(job = {}, fallback = '') {
  return String(job.canonical_key || job.url || job.id || job.job_id || `${job.title || ''}|${job.company || ''}|${fallback}`);
}

function getAllRankedJobs(jobsData = {}) {
  const seen = new Set();
  const merged = [
    ...(jobsData.top10 || []).map((job) => ({ ...job, _rank_bucket: job._rank_bucket || job.category || 'top10' })),
    ...(jobsData.cat3 || []).map((job) => ({ ...job, _rank_bucket: 'cat3' })),
    ...(jobsData.cat1 || []).map((job) => ({ ...job, _rank_bucket: 'cat1' })),
    ...(jobsData.cat2 || []).map((job) => ({ ...job, _rank_bucket: 'cat2' })),
  ];

  return merged
    .filter((job, index) => {
      const key = getJobViewKey(job, index).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((job) => {
      let typeGroup = job.job_type_group || 'other';
      if (typeGroup === 'other') {
        const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
        if (/\b(ai|ml|machine learning|software|developer|engineer|frontend|backend|fullstack|programming|code)\b/i.test(text)) {
          typeGroup = 'ai_software';
        } else if (/\b(research|scientist|lab|postdoc|phd|professor|academic)\b/i.test(text)) {
          typeGroup = 'research';
        } else if (/\b(psychology|clinical|therapist|counselor|mental health)\b/i.test(text)) {
          typeGroup = 'psychology';
        } else if (/\b(intern|internship|co-op|apprentice)\b/i.test(text)) {
          typeGroup = 'internship';
        } else if (/\b(data|analyst|business|finance|marketing|product|manager)\b/i.test(text)) {
          typeGroup = 'data_business';
        } else if (/\b(creative|designer|art|writer|video|content|audio)\b/i.test(text)) {
          typeGroup = 'creative';
        }
      }
      return {
        ...job,
        job_type_group: typeGroup
      };
    })
    .sort((left, right) => Number(right._score || right.score || 0) - Number(left._score || left.score || 0));
}

export const SCHOLARSHIP_CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'fully_funded', label: 'Fully Funded' },
  { id: 'stem', label: 'STEM / Technology' },
  { id: 'creative_humanities', label: 'Creative / Humanities' },
  { id: 'general', label: 'General / Other' }
];

export function categorizeScholarship(s) {
  const title = String(s.title || '').toLowerCase();
  const desc = String(s.description || '').toLowerCase();
  const fields = Array.isArray(s.fields_of_study) ? s.fields_of_study.map(f => String(f).toLowerCase()) : [];
  
  if (s.is_fully_funded || title.includes('fully funded') || desc.includes('fully-funded')) {
    return 'fully_funded';
  }
  if (title.includes('ai') || title.includes('computer') || title.includes('science') || title.includes('technology') || title.includes('stem') || title.includes('engineering') || fields.some(f => f.includes('computer') || f.includes('science') || f.includes('engineering') || f.includes('technology'))) {
    return 'stem';
  }
  if (title.includes('art') || title.includes('music') || title.includes('creative') || title.includes('humanities') || title.includes('design') || fields.some(f => f.includes('art') || f.includes('music') || f.includes('humanities') || f.includes('design'))) {
    return 'creative_humanities';
  }
  return 'general';
}

function JobCard({ job, category, isSaved, onToggleSave }) {
  const [expanded, setExpanded] = useState(false);
  const breakdown = parseScoreBreakdown(job._score_breakdown);
  const catMeta = categoryLabel(category || job._rank_bucket || job.job_type_group || 'ranked');
  const score = job._total_score ?? job.score ?? job._score;
  const fitLabels = job._goal_fit?.labels || [];
  const postedAt = formatDate(job._freshness?.posted_at || job.date_posted);
  const sourceSeenAt = formatDate(job._freshness?.source_last_seen_at);
  const location = firstAvailable(job.location, job.location_full, job.city);
  const type = firstAvailable(job.type, job.employment_type);
  const salary = salaryLabel(job);

  return (
    <div className="opp-card" style={{ borderLeft: `3px solid ${catMeta.color}` }}>
      <div className="opp-card-header" onClick={() => setExpanded((v) => !v)}>
        <div className="opp-card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className="opp-cat-badge" style={{ color: catMeta.color }}>
              {catMeta.label}
            </span>
            {score !== undefined && (
              <span className="opp-score-badge">
                Match&nbsp;<strong>{formatScore(score)}</strong>
              </span>
            )}
          </div>
          <button
            type="button"
            className={`opp-bookmark-btn ${isSaved ? 'opp-bookmark-btn--saved' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
            }}
            title={isSaved ? "Unsave opportunity" : "Save opportunity"}
          >
            ★
          </button>
        </div>
        <div className="opp-job-title">{job.title || 'Untitled Role'}</div>
        <div className="opp-job-meta">
          {job.company && <span className="opp-meta-tag">{job.company}</span>}
          {location && <span className="opp-meta-tag">Place: {location}</span>}
          {job.location_group && (
            <span className="opp-meta-tag">
              {JOB_LOCATION_FILTERS.find((item) => item.id === job.location_group)?.label || job.location_group}
            </span>
          )}
          {job.job_type_group && (
            <span className="opp-meta-tag">
              {JOB_TYPE_FILTERS.find((item) => item.id === job.job_type_group)?.label || job.job_type_group}
            </span>
          )}
          {type && <span className="opp-meta-tag">{type}</span>}
          {salary && <span className="opp-meta-tag salary">Pay: {salary}</span>}
          {postedAt && <span className="opp-meta-tag">Posted: {postedAt}</span>}
          {sourceSeenAt && <span className="opp-meta-tag">Seen: {sourceSeenAt}</span>}
        </div>
      </div>

      {expanded && (
        <div className="opp-card-body">
          {fitLabels.length > 0 && (
            <div className="opp-why-shown">
              <div className="opp-why-label">Goal fit</div>
              <div className="opp-why-chips">
                {fitLabels.map((label, i) => (
                  <span key={i} className="opp-why-chip opp-why-chip--fit">{label}</span>
                ))}
              </div>
            </div>
          )}
          {(job._goal_fit?.summary || job._freshness?.evidence) && (
            <p className="opp-evidence-line">
              {job._goal_fit?.summary}
              {job._freshness?.evidence ? ` Evidence: ${job._freshness.evidence}.` : ''}
            </p>
          )}
          {breakdown.length > 0 && (
            <div className="opp-why-shown">
              <div className="opp-why-label">Why shown</div>
              <div className="opp-why-chips">
                {breakdown.map((b, i) => (
                  <span key={i} className="opp-why-chip">
                    {b.label}
                    {b.value !== 'true' && b.value !== '1' && (
                      <strong>&nbsp;{b.value}</strong>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {job.description && (
            <p className="opp-desc">{job.description.slice(0, 280)}{job.description.length > 280 ? '…' : ''}</p>
          )}
          {job.url && (
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="opp-apply-btn">
              Apply →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ScholarshipCard({ s, isSaved, onToggleSave }) {
  const [expanded, setExpanded] = useState(false);
  const levels = Array.isArray(s.levels) ? s.levels.join(', ') : (s.levels || '');
  const deadline = s.deadline ? s.deadline.slice(0, 10) : null;
  const isExpired = s.is_expired;
  const fitLabels = s._goal_fit?.labels || [];
  const scrapedAt = formatDate(s._freshness?.scraped_at || s.scraped_at);
  const publishedAt = formatDate(s._freshness?.published_at || s.published_at);
  const source = firstAvailable(s.source_site, s.provider, s._freshness?.evidence);

  return (
    <div className={`opp-card ${isExpired ? 'opp-card--expired' : ''}`}>
      <div className="opp-card-header" onClick={() => setExpanded((v) => !v)}>
        <div className="opp-card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {s.is_fully_funded && <span className="opp-ff-badge">🎯 Fully Funded</span>}
            {isExpired && <span className="opp-expired-badge">Expired</span>}
            {deadline && !isExpired && (
              <span className="opp-deadline-badge">📅 {deadline}</span>
            )}
          </div>
          <button
            type="button"
            className={`opp-bookmark-btn ${isSaved ? 'opp-bookmark-btn--saved' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
            }}
            title={isSaved ? "Unsave opportunity" : "Save opportunity"}
          >
            ★
          </button>
        </div>
        <div className="opp-job-title">{s.title || 'Unnamed Scholarship'}</div>
        <div className="opp-job-meta">
          {s.host_organization && <span className="opp-meta-tag">{s.host_organization}</span>}
          {levels && <span className="opp-meta-tag">{levels}</span>}
          {source && <span className="opp-meta-tag">Source: {source}</span>}
          {s.opportunity_type && <span className="opp-meta-tag">{s.opportunity_type}</span>}
          {publishedAt && <span className="opp-meta-tag">Published: {publishedAt}</span>}
          {scrapedAt && <span className="opp-meta-tag">Scraped: {scrapedAt}</span>}
          {s.country && <span className="opp-meta-tag">🌍 {s.country}</span>}
          {s._computed_category && (
            <span className="opp-meta-tag" style={{
              background: s._computed_category === 'fully_funded' ? 'rgba(16, 185, 129, 0.15)' : s._computed_category === 'stem' ? 'rgba(59, 130, 246, 0.15)' : s._computed_category === 'creative_humanities' ? 'rgba(236, 72, 153, 0.15)' : 'rgba(107, 114, 128, 0.15)',
              color: s._computed_category === 'fully_funded' ? 'var(--success, #10b981)' : s._computed_category === 'stem' ? 'var(--info, #3b82f6)' : s._computed_category === 'creative_humanities' ? 'var(--accent-pink, #ec4899)' : 'var(--text-secondary, #6b7280)',
              fontWeight: '600'
            }}>
              {SCHOLARSHIP_CATEGORIES.find(c => c.id === s._computed_category)?.label || s._computed_category}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="opp-card-body">
          {fitLabels.length > 0 && (
            <div className="opp-why-shown">
              <div className="opp-why-label">Goal fit</div>
              <div className="opp-why-chips">
                {fitLabels.map((label, i) => (
                  <span key={i} className="opp-why-chip opp-why-chip--fit">{label}</span>
                ))}
              </div>
            </div>
          )}
          {(s._goal_fit?.summary || source) && (
            <p className="opp-evidence-line">
              {s._goal_fit?.summary}
              {source ? ` Evidence source: ${source}.` : ''}
            </p>
          )}
          {s.description && (
            <p className="opp-desc">{s.description.slice(0, 320)}{s.description.length > 320 ? '…' : ''}</p>
          )}
          {Array.isArray(s.fields_of_study) && s.fields_of_study.length > 0 && (
            <div className="opp-why-shown">
              <div className="opp-why-label">Fields of Study</div>
              <div className="opp-why-chips">
                {s.fields_of_study.slice(0, 8).map((f, i) => (
                  <span key={i} className="opp-why-chip">{f}</span>
                ))}
              </div>
            </div>
          )}
          {s.url && (
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="opp-apply-btn">
              View Scholarship →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function OpportunitiesScreen() {
  const [tab, setTab] = useState('tracked');
  const [jobLocationFilter, setJobLocationFilter] = useState('all');
  const [jobTypeFilter, setJobTypeFilter] = useState('all');

  // Jobs state
  const [jobsData, setJobsData] = useState(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState(null);
  const [sweepStatus, setSweepStatus] = useState(null);
  const [sweeping, setSweeping] = useState(false);

  // Scholarships state
  const [scholarships, setScholarships] = useState([]);
  const [schStats, setSchStats] = useState(null);
  const [schLoading, setSchLoading] = useState(false);
  const [schError, setSchError] = useState(null);
  const [schQuery, setSchQuery] = useState('');
  const [schLevel, setSchLevel] = useState('');
  const [schRegion, setSchRegion] = useState('');
  const [schFunded, setSchFunded] = useState(false);
  const [schCategory, setSchCategory] = useState('all');
  const schQueryTimeout = useRef(null);

  // Saved opportunities state
  const [savedOpps, setSavedOpps] = useState([]);

  // Labs state
  const [labsData, setLabsData] = useState(null);
  const [labsLoading, setLabsLoading] = useState(false);
  const [labsError, setLabsError] = useState(null);
  const [labsUpdating, setLabsUpdating] = useState(false);

  // SPHERE audio state
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioPreset, setAudioPreset] = useState('sphere-prime');
  const [audioVolume, setAudioVolume] = useState(0.05);

  // Voice flow state
  const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [listening, setListening] = useState(false);

  const startListening = () => {
    if (!SpeechRecognition) return;
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setListening(true);
      };

      recognition.onresult = (event) => {
        const speechToText = event.results[0][0].transcript;
        console.log('Speech recognized:', speechToText);

        // Phrase mapping:
        if (/find me work/i.test(speechToText)) {
          setTab('jobs');
        } else if (/find me scholarship/i.test(speechToText)) {
          setTab('scholarships');
        } else if (/what should i apply for/i.test(speechToText)) {
          setTab('jobs');
          setJobLocationFilter('hungary');
          setJobTypeFilter('ai_software');
        }
      };

      recognition.onerror = (e) => {
        console.error('Speech recognition error', e);
        setListening(false);
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognition.start();
    } catch (e) {
      console.error(e);
      setListening(false);
    }
  };

  // ─── Jobs ───────────────────────────────────────────────────────────
  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const data = await apiFetch('/api/v1/opportunities/jobs');
      if (!data) throw new Error('Service unavailable');
      setJobsData(data);
    } catch (err) {
      setJobsError(err.message);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const triggerSweep = useCallback(async () => {
    setSweeping(true);
    setSweepStatus(null);
    try {
      const data = await apiFetch('/api/v1/opportunities/jobs/sweep', {
        method: 'POST',
        body: JSON.stringify({ testMode: false }),
      });
      setSweepStatus(data || { status: 'error', message: 'Service unavailable' });
    } catch (err) {
      setSweepStatus({ status: 'error', message: err.message });
    } finally {
      setSweeping(false);
    }
  }, []);

  // ─── Scholarships ────────────────────────────────────────────────────
  const loadScholarshipStats = useCallback(async () => {
    try {
      const data = await apiFetch('/api/v1/opportunities/scholarships/stats');
      if (data) setSchStats(data);
    } catch (_) {}
  }, []);

  const loadScholarships = useCallback(async () => {
    setSchLoading(true);
    setSchError(null);
    try {
      const params = new URLSearchParams();
      if (schQuery) params.set('q', schQuery);
      if (schLevel) params.set('level', schLevel);
      if (schRegion) params.set('region', schRegion);
      if (schFunded) params.set('funded', '1');
      params.set('limit', '40');
      const data = await apiFetch(`/api/v1/opportunities/scholarships?${params}`);
      if (!data) throw new Error('Service unavailable');
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data.value)
          ? data.value
          : Array.isArray(data.items)
            ? data.items
            : [];
            
      const seen = new Set();
      const dedupedItems = items.filter((s, index) => {
        const key = String(s.id || s.url || `${s.title || ''}|${s.host_organization || ''}|${index}`).trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setScholarships(dedupedItems);
    } catch (err) {
      setSchError(err.message);
    } finally {
      setSchLoading(false);
    }
  }, [schQuery, schLevel, schRegion, schFunded]);

  // ─── Saved Opportunities ────────────────────────────────────────────
  const loadSavedOpps = useCallback(async () => {
    try {
      const data = await apiFetch('/api/v1/opportunities/saved');
      if (data.success && Array.isArray(data.items)) {
        setSavedOpps(data.items);
      }
    } catch (_) {}
  }, []);

  const loadLabsPortfolio = useCallback(async () => {
    setLabsLoading(true);
    setLabsError(null);
    try {
      const res = await fetchHierarchyState();
      if (res && res.success && res.hierarchy) {
        setLabsData(res.hierarchy.labsResearch || null);
      } else {
        throw new Error('Failed to retrieve user hierarchy');
      }
    } catch (err) {
      setLabsError(err.message);
    } finally {
      setLabsLoading(false);
    }
  }, []);

  const handleGenerateLabs = async () => {
    setLabsUpdating(true);
    setLabsError(null);
    try {
      const res = await generateLabsResearch();
      if (res && res.success) {
        setLabsData(res.labsResearch);
      } else {
        throw new Error(res?.error || 'Failed to map research laboratories.');
      }
    } catch (err) {
      setLabsError(err.message);
    } finally {
      setLabsUpdating(false);
    }
  };

  const toggleSaveOpportunity = async (opp) => {
    const isSaved = savedOpps.some(
      (item) => item.opportunity_id === opp.opportunity_id && item.opportunity_type === opp.opportunity_type
    );

    const previousSaved = [...savedOpps];

    // Optimistically update local state for instant UI response
    if (isSaved) {
      setSavedOpps((prev) =>
        prev.filter(
          (item) => !(item.opportunity_id === opp.opportunity_id && item.opportunity_type === opp.opportunity_type)
        )
      );
    } else {
      const tempId = `temp-${Date.now()}`;
      setSavedOpps((prev) => [...prev, { id: tempId, ...opp }]);
    }

    try {
      if (isSaved) {
        const data = await apiFetch('/api/v1/opportunities/unsave', {
          method: 'POST',
          body: JSON.stringify({
            opportunity_id: opp.opportunity_id,
            opportunity_type: opp.opportunity_type,
          }),
        });
        if (!data?.success) throw new Error('Unsave request failed');
      } else {
        const data = await apiFetch('/api/v1/opportunities/save', {
          method: 'POST',
          body: JSON.stringify(opp),
        });
        if (data?.success) {
            // Replace optimistic temp id with database response
            setSavedOpps((prev) =>
              prev.map((item) =>
                item.opportunity_id === opp.opportunity_id && item.opportunity_type === opp.opportunity_type
                  ? { id: data.id, ...opp }
                  : item
              )
            );
        } else {
          throw new Error('Save response success was false');
        }
      }
    } catch (err) {
      console.error('Error toggling save opportunity, rolling back:', err);
      // Rollback to previous state on error
      setSavedOpps(previousSaved);
    }
  };

  // ─── Audio Controls ──────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    if (!ambientSonifier) return;
    if (audioPlaying) {
      ambientSonifier.stop();
      setAudioPlaying(false);
    } else {
      ambientSonifier.start(audioPreset);
      setAudioPlaying(true);
    }
  }, [audioPlaying, audioPreset]);

  const handlePresetChange = useCallback((preset) => {
    setAudioPreset(preset);
    if (audioPlaying && ambientSonifier) {
      ambientSonifier.updateState(preset);
    }
  }, [audioPlaying]);

  const handleVolumeChange = useCallback((v) => {
    const vol = Number(v);
    setAudioVolume(vol);
    if (ambientSonifier) ambientSonifier.setVolume(vol);
  }, []);

  // ─── Effects ─────────────────────────────────────────────────────────
  useEffect(() => {
    loadJobs();
    loadScholarshipStats();
    loadSavedOpps();
    loadLabsPortfolio();
  }, [loadJobs, loadScholarshipStats, loadSavedOpps, loadLabsPortfolio]);

  const triggerScholarshipsLoad = useCallback((immediate = false) => {
    if (schQueryTimeout.current) clearTimeout(schQueryTimeout.current);
    if (immediate) {
      loadScholarships();
    } else {
      schQueryTimeout.current = setTimeout(loadScholarships, 350);
    }
  }, [loadScholarships]);

  useEffect(() => {
    if (tab === 'scholarships') {
      triggerScholarshipsLoad(false);
    }
    return () => { if (schQueryTimeout.current) clearTimeout(schQueryTimeout.current); };
  }, [tab, schQuery, schRegion, triggerScholarshipsLoad]);

  useEffect(() => {
    if (tab === 'scholarships') {
      triggerScholarshipsLoad(true);
    }
  }, [tab, schLevel, schFunded, triggerScholarshipsLoad]);

  // ─── Render ──────────────────────────────────────────────────────────
  const jobList = jobsData
    ? getAllRankedJobs(jobsData).filter((job) => {
        const locationMatch = jobLocationFilter === 'all' || String(job.location_group || 'unknown') === jobLocationFilter;
        const typeMatch = jobTypeFilter === 'all' || String(job.job_type_group || 'other') === jobTypeFilter;
        return locationMatch && typeMatch;
      })
    : [];
  const jobsMeta = jobsData?.meta || {};
  const jobFreshness = jobsMeta.freshness || {};
  const jobLens = jobsMeta.profile_lens || {};
  const jobCoverage = jobsMeta.source_coverage || {};
  const schFreshness = schStats?.freshness || {};
  const schLens = schStats?.profile_lens || {};
  const schCoverage = schStats?.active_source_coverage || schStats?.source_coverage || {};

  const filteredScholarships = scholarships
    .map(s => ({ ...s, _computed_category: categorizeScholarship(s) }))
    .filter(s => {
      if (schCategory === 'all') return true;
      return s._computed_category === schCategory;
    });

  return (
    <div className="opp-screen">
      {/* ── SPHERE Audio Bridge ─────────────────────── */}
      <div className="opp-audio-card">
        <div className="opp-audio-header">
          <div>
            <div className="opp-audio-title">◉ SPHERE Audio Bridge</div>
            <div className="opp-audio-sub">Ambient sonification for deep focus</div>
          </div>
          <button
            type="button"
            className={`opp-audio-toggle ${audioPlaying ? 'opp-audio-toggle--on' : ''}`}
            onClick={toggleAudio}
          >
            {audioPlaying ? '■ Stop' : '▶ Play'}
          </button>
        </div>

        <div className="opp-audio-controls">
          <div className="opp-audio-presets">
            {['sphere-prime', 'clear-sky', 'high-tension'].map((p) => (
              <button
                key={p}
                type="button"
                className={`opp-preset-chip ${audioPreset === p ? 'opp-preset-chip--active' : ''}`}
                onClick={() => handlePresetChange(p)}
              >
                {p === 'sphere-prime' ? '🌌 Prime' : p === 'clear-sky' ? '☀️ Clear' : '⚡ Tension'}
              </button>
            ))}
          </div>
          <div className="opp-audio-volume">
            <span className="opp-vol-label">Vol</span>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.005}
              value={audioVolume}
              onChange={(e) => handleVolumeChange(e.target.value)}
              className="opp-vol-slider"
            />
            <span className="opp-vol-value">{Math.round((audioVolume / 0.2) * 100)}%</span>
          </div>
        </div>
      </div>

      {/* ── Main Tab Switcher ───────────────────────── */}
      <div className="opp-tab-row" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '8px' }}>
        <button
          type="button"
          className={`opp-tab ${tab === 'tracked' ? 'opp-tab--active' : ''}`}
          onClick={() => setTab('tracked')}
        >
          Tracked
        </button>
        <button
          type="button"
          className={`opp-tab ${tab === 'jobs' ? 'opp-tab--active' : ''}`}
          onClick={() => setTab('jobs')}
        >
          💼 Jobs
        </button>
        <button
          type="button"
          className={`opp-tab ${tab === 'scholarships' ? 'opp-tab--active' : ''}`}
          onClick={() => setTab('scholarships')}
        >
          🎓 Scholarships
        </button>
        <button
          type="button"
          className={`opp-tab ${tab === 'labs' ? 'opp-tab--active' : ''}`}
          onClick={() => setTab('labs')}
        >
          🔬 Research Labs
        </button>

        {SpeechRecognition && (
          <button
            type="button"
            onClick={startListening}
            style={{
              marginLeft: 'auto',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: listening ? 'var(--error, #ef4444)' : 'var(--surface-elevated)',
              color: listening ? 'var(--text-primary, #ffffff)' : 'var(--text-secondary)',
              border: '1px solid var(--border-soft)',
              cursor: 'pointer',
              fontSize: '18px',
              boxShadow: 'var(--shadow-sm)',
            }}
            title={listening ? "Listening..." : "Voice search"}
          >
            {listening ? '🔴' : '🎤'}
          </button>
        )}
      </div>

      {/* ── JOBS TAB ─────────────────────────────────── */}
      {tab === 'tracked' && (
        <div className="opp-panel">
          <div className="opp-metadata-panel">
            <span><strong>Tracked by eXplore:</strong> official application announcements and deadlines.</span>
          </div>
          <div className="opp-list">
            {TRACKED_OPPORTUNITIES.map((opportunity) => (
              <TrackedOpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="opp-panel">
          {/* Sweep Control */}
          <div className="opp-sweep-row">
            <button
              type="button"
              className={`opp-sweep-btn ${sweeping ? 'opp-sweep-btn--running' : ''}`}
              onClick={triggerSweep}
              disabled={sweeping}
            >
              {sweeping ? '⏳ Sweeping…' : '🔄 Trigger New Sweep'}
            </button>
            {sweepStatus && (
              <span className={`opp-sweep-status ${sweepStatus.status === 'error' ? 'opp-sweep-status--err' : ''}`}>
                {sweepStatus.status}: {sweepStatus.message}
              </span>
            )}
          </div>

          {jobsData?.meta && (
            <div className="opp-stats-row">
              <span>Total: <strong>{jobsData.meta._total || 0}</strong></span>
              <span>Kept: <strong>{jobsData.meta._kept || 0}</strong></span>
              {jobsData.meta._generated && (
                <span>Updated: <strong>{jobsData.meta._generated.slice(0, 10)}</strong></span>
              )}
              {jobFreshness.last_posted_at && (
                <span>Newest post: <strong>{formatDate(jobFreshness.last_posted_at)}</strong></span>
              )}
              {jobFreshness.all_jobs_modified_at && (
                <span>Scrape file: <strong>{formatDate(jobFreshness.all_jobs_modified_at)}</strong></span>
              )}
            </div>
          )}

          {jobsMeta.profile_lens && (
            <div className="opp-metadata-panel">
              <span><strong>Lens:</strong> {jobLens.mission || 'SPHERE'} / {jobLens.person_location || 'Budapest or remote'}</span>
              {Array.isArray(jobLens.priorities) && jobLens.priorities.length > 0 && (
                <span><strong>Goal route:</strong> {jobLens.priorities.slice(0, 3).join(' | ')}</span>
              )}
              {sourceCountsText(jobsMeta.source_counts) && (
                <span><strong>Sources:</strong> {sourceCountsText(jobsMeta.source_counts)}</span>
              )}
              {jobCoverage.summary && (
                <span><strong>Coverage:</strong> {jobCoverage.summary}</span>
              )}
              {Array.isArray(jobCoverage.missing_critical) && jobCoverage.missing_critical.length > 0 && (
                <span><strong>Missing priority:</strong> {jobCoverage.missing_critical.slice(0, 4).join(', ')}</span>
              )}
              {Array.isArray(jobCoverage.stale) && jobCoverage.stale.length > 0 && (
                <span><strong>Needs refresh:</strong> {jobCoverage.stale.slice(0, 6).join(', ')}</span>
              )}
              <MissingPrioritySourceLinks coverage={jobCoverage} limit={4} />
            </div>
          )}

          {/* Job filters */}
          <div className="opp-subtab-row">
            {JOB_LOCATION_FILTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`opp-subtab ${jobLocationFilter === c.id ? 'opp-subtab--active' : ''}`}
                onClick={() => setJobLocationFilter(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="opp-subtab-row">
            {JOB_TYPE_FILTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`opp-subtab ${jobTypeFilter === c.id ? 'opp-subtab--active' : ''}`}
                onClick={() => setJobTypeFilter(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {jobsLoading && <div className="opp-loading">Loading jobs…</div>}
          {jobsError && (
            <div className="opp-error">
              <span>Jobs unavailable.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadJobs}>
                Retry
              </button>
            </div>
          )}
          {!jobsLoading && !jobsError && jobList.length === 0 && (
            <div className="opp-empty">
              No jobs in this category yet.
              <br />
              Trigger a sweep to fetch new listings.
            </div>
          )}
          {jobList.map((job, i) => {
            const oppId = job.id || job.url || String(i);
            const isSaved = savedOpps.some(
              (item) => item.opportunity_id === oppId && item.opportunity_type === 'job'
            );
            return (
              <JobCard
                key={job.id || job.url || i}
                job={job}
                category={job._rank_bucket || 'ranked'}
                isSaved={isSaved}
                onToggleSave={() =>
                  toggleSaveOpportunity({
                    opportunity_id: oppId,
                    opportunity_type: 'job',
                    title: job.title || 'Untitled Role',
                    company_or_org: job.company || null,
                    location_or_country: job.location || null,
                    details: job,
                  })
                }
              />
            );
          })}
        </div>
      )}

      {/* ── SCHOLARSHIPS TAB ────────────────────────── */}
      {tab === 'scholarships' && (
        <div className="opp-panel">
          {/* Stats header */}
          {schStats && !schStats.error && (
            <div className="opp-stats-row opp-stats-row--sch">
              <span>Total: <strong>{(schStats.total || 0).toLocaleString()}</strong></span>
              <span>Active: <strong>{(schStats.active || 0).toLocaleString()}</strong></span>
              <span>Fully Funded: <strong>{(schStats.fully_funded || 0).toLocaleString()}</strong></span>
              {schStats.last_updated && (
                <span>Updated: <strong>{schStats.last_updated}</strong></span>
              )}
              <span>Expired: <strong>{(schStats.expired || 0).toLocaleString()}</strong></span>
              {schFreshness.last_scraped_at && (
                <span>Scraped: <strong>{formatDate(schFreshness.last_scraped_at)}</strong></span>
              )}
              {schFreshness.database_modified_at && (
                <span>DB file: <strong>{formatDate(schFreshness.database_modified_at)}</strong></span>
              )}
              {schFreshness.snapshot_stale && (
                <span><strong>Snapshot needs refresh</strong></span>
              )}
            </div>
          )}

          {schStats && !schStats.error && (
            <div className="opp-metadata-panel">
              <span><strong>Lens:</strong> {schLens.mission || 'SPHERE'} / funding, research, psychology, AI, creative paths</span>
              {sourceCountsText(schStats.active_source_counts) && (
                <span><strong>Active sources:</strong> {sourceCountsText(schStats.active_source_counts)}</span>
              )}
              {schCoverage.summary && (
                <span><strong>Coverage:</strong> {schCoverage.summary}</span>
              )}
              {Array.isArray(schCoverage.missing_critical) && schCoverage.missing_critical.length > 0 && (
                <span><strong>Missing priority:</strong> {schCoverage.missing_critical.slice(0, 4).join(', ')}</span>
              )}
              <MissingPrioritySourceLinks coverage={schCoverage} />
              {sourceCountsText(schStats.category_counts, 5) && (
                <span><strong>Categories:</strong> {sourceCountsText(schStats.category_counts, 5)}</span>
              )}
            </div>
          )}

          {/* Search & Filters */}
          <div className="opp-sch-filters">
            <input
              type="text"
              className="opp-search-input"
              placeholder="Search scholarships…"
              value={schQuery}
              onChange={(e) => setSchQuery(e.target.value)}
            />
            <div className="opp-filter-row">
              <select
                className="opp-select"
                value={schLevel}
                onChange={(e) => setSchLevel(e.target.value)}
              >
                <option value="">All Levels</option>
                <option value="phd">PhD</option>
                <option value="masters">Masters</option>
                <option value="undergraduate">Undergraduate</option>
                <option value="postdoctoral">Postdoctoral</option>
              </select>
              <select
                className="opp-select"
                value={schCategory}
                onChange={(e) => setSchCategory(e.target.value)}
              >
                {SCHOLARSHIP_CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
              <input
                type="text"
                className="opp-search-input opp-region-input"
                placeholder="Region / Country…"
                value={schRegion}
                onChange={(e) => setSchRegion(e.target.value)}
              />
              <label className="opp-funded-toggle">
                <input
                  type="checkbox"
                  checked={schFunded}
                  onChange={(e) => setSchFunded(e.target.checked)}
                />
                <span>Fully Funded only</span>
              </label>
            </div>
          </div>

          {schLoading && <div className="opp-loading">Searching database…</div>}
          {schError && (
            <div className="opp-error">
              <span>Scholarships unavailable.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadScholarships}>
                Retry
              </button>
            </div>
          )}
          {!schLoading && !schError && filteredScholarships.length === 0 && (
            <div className="opp-empty">
              No scholarships found.
              <br />
              Try adjusting your filters or search query.
            </div>
          )}
          {filteredScholarships.map((s, i) => {
            const oppId = String(s.id || i);
            const isSaved = savedOpps.some(
              (item) => item.opportunity_id === oppId && item.opportunity_type === 'scholarship'
            );
            return (
              <ScholarshipCard
                key={s.id || i}
                s={s}
                isSaved={isSaved}
                onToggleSave={() =>
                  toggleSaveOpportunity({
                    opportunity_id: oppId,
                    opportunity_type: 'scholarship',
                    title: s.title || 'Unnamed Scholarship',
                    company_or_org: s.host_organization || null,
                    location_or_country: s.country || null,
                    details: s,
                  })
                }
              />
            );
          })}
        </div>
      )}

      {/* ── RESEARCH LABS TAB ────────────────────────── */}
      {tab === 'labs' && (
        <div className="opp-panel">
          
          {/* Status / CTA Card */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', padding: 'var(--space-medium)', background: 'linear-gradient(135deg, rgba(167, 139, 250, 0.05), var(--surface))', border: '1px solid var(--border-soft)', borderRadius: '12px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ font: 'var(--font-body)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>🔬 Dynamic Research Mapping</h3>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '4px', marginBottom: 0 }}>
                  Analyze prestigious labs in Hungary and the USA mapped directly to your active life goals and trajectory values.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleGenerateLabs}
                disabled={labsUpdating || labsLoading}
                style={{
                  background: 'linear-gradient(135deg, hsl(270, 75%, 55%), hsl(230, 80%, 50%), hsl(190, 80%, 45%))',
                  border: 'none',
                  color: '#fff',
                  fontWeight: '700',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s ease',
                }}
              >
                {labsUpdating ? '⏳ Mapping Labs & Papers...' : (labsData ? '🔄 Refresh Labs Mapping' : '✨ Map Research Labs to My Goals')}
              </button>
            </div>
            
            {labsError && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--error)', fontWeight: 600, margin: 0 }}>
                ⚠ {labsError}
              </p>
            )}
          </div>

          {labsLoading && (
            <div className="opp-loading" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
              <div className="spinner" style={{ border: '2px solid var(--border)', borderTop: '2px solid #a78bfa', borderRadius: '50%', width: '24px', height: '24px', animation: 'spin 1s linear infinite', margin: '0 auto 10px' }} />
              Loading research portfolio...
            </div>
          )}

          {!labsLoading && !labsData && !labsError && (
            <div className="opp-empty" style={{ textAlign: 'center', padding: 'var(--space-2xl)', background: 'var(--surface-elevated)', borderRadius: '8px', border: '1px dashed var(--border-soft)' }}>
              🔬 No active research mapping found.
              <br />
              Click the button above to dynamically discover research labs mapped to your profile!
            </div>
          )}

          {labsData && !labsLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* Hungary section */}
              <div>
                <h3 className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', font: 'var(--font-body)', fontWeight: 700 }}>
                  <span>🇭🇺 Hungary Research Laboratories</span>
                  <span style={{ font: 'var(--font-micro)', textTransform: 'uppercase', color: 'hsl(270, 80%, 65%)', letterSpacing: '0.05em' }}>Top 5 Papers Matched to Goals</span>
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {labsData.hungary?.map((lab, i) => {
                    const oppId = lab.id || `hun-lab-${i}`;
                    const isSaved = savedOpps.some(
                      (item) => item.opportunity_id === oppId && item.opportunity_type === 'lab'
                    );
                    return (
                      <div 
                        key={oppId} 
                        className="opp-card" 
                        style={{ borderLeft: '3px solid hsl(270, 75%, 55%)', background: 'var(--chrome-bg)', borderRadius: '8px', border: '1px solid var(--border-soft)', borderLeftWidth: '3px', overflow: 'hidden' }}
                      >
                        <div className="opp-card-header" style={{ padding: '14px 16px' }}>
                          <div className="opp-card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="opp-cat-badge" style={{ color: 'hsl(270, 85%, 68%)', font: 'var(--font-caption)', fontWeight: 600 }}>
                              🇭🇺 {lab.institution || 'Hungary Institute'}
                            </span>
                            <button
                              type="button"
                              className={`opp-bookmark-btn ${isSaved ? 'opp-bookmark-btn--saved' : ''}`}
                              onClick={() =>
                                toggleSaveOpportunity({
                                  opportunity_id: oppId,
                                  opportunity_type: 'lab',
                                  title: lab.name || 'Hungary Research Lab',
                                  company_or_org: lab.institution || null,
                                  location_or_country: lab.location || 'Hungary',
                                  details: lab,
                                })
                              }
                              title={isSaved ? "Unsave lab" : "Save lab"}
                            >
                              ★
                            </button>
                          </div>
                          <div className="opp-job-title" style={{ fontSize: '15px', fontWeight: 700, margin: '6px 0', color: 'var(--text-primary)' }}>{lab.name}</div>
                          <div className="opp-job-meta" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                            <span className="opp-meta-tag">📍 {lab.location}</span>
                            <span className="opp-meta-tag">👤 Director: {lab.director}</span>
                          </div>
                          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '8px', borderLeft: '2px solid rgba(255,255,255,0.06)', paddingLeft: '8px', fontStyle: 'italic', margin: '8px 0 0' }}>
                            <strong>Relevance:</strong> {lab.relevance}
                          </p>
                        </div>
                        
                        {/* Top 5 papers grid */}
                        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ font: 'var(--font-micro)', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.04em', borderTop: '1px solid var(--border-soft)', paddingTop: '10px', marginBottom: '4px' }}>
                            Top 5 Papers & Trajectory Alignment
                          </div>
                          {lab.papers?.slice(0, 5).map((paper, pi) => (
                            <div key={pi} style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.03)', borderRadius: '6px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)', fontWeight: 600 }}>{paper.title}</strong>
                                <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                  {paper.journal} ({paper.year})
                                </span>
                              </div>
                              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '2px 0 6px' }}>{paper.summary}</p>
                              <div style={{ font: 'var(--font-caption)', color: 'hsl(145, 80%, 45%)', background: 'rgba(52, 211, 153, 0.05)', borderLeft: '2px solid hsl(145, 80%, 40%)', padding: '6px 8px', borderRadius: '0 4px 4px 0' }}>
                                <strong>Goal Connection:</strong> {paper.connectionToGoals}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* USA section */}
              <div>
                <h3 className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', font: 'var(--font-body)', fontWeight: 700 }}>
                  <span>🇺🇸 USA Research Centers</span>
                  <span style={{ font: 'var(--font-micro)', textTransform: 'uppercase', color: 'hsl(190, 80%, 45%)', letterSpacing: '0.05em' }}>Top Studies & Doctor Profiles</span>
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {labsData.usa?.map((lab, i) => {
                    const oppId = lab.id || `usa-lab-${i}`;
                    const isSaved = savedOpps.some(
                      (item) => item.opportunity_id === oppId && item.opportunity_type === 'lab'
                    );
                    return (
                      <div 
                        key={oppId} 
                        className="opp-card" 
                        style={{ borderLeft: '3px solid hsl(190, 80%, 45%)', background: 'var(--chrome-bg)', borderRadius: '8px', border: '1px solid var(--border-soft)', borderLeftWidth: '3px', overflow: 'hidden' }}
                      >
                        <div className="opp-card-header" style={{ padding: '14px 16px' }}>
                          <div className="opp-card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="opp-cat-badge" style={{ color: 'hsl(190, 85%, 50%)', font: 'var(--font-caption)', fontWeight: 600 }}>
                              🇺🇸 {lab.institution || 'USA University'}
                            </span>
                            <button
                              type="button"
                              className={`opp-bookmark-btn ${isSaved ? 'opp-bookmark-btn--saved' : ''}`}
                              onClick={() =>
                                toggleSaveOpportunity({
                                  opportunity_id: oppId,
                                  opportunity_type: 'lab',
                                  title: lab.name || 'USA Research Center',
                                  company_or_org: lab.institution || null,
                                  location_or_country: lab.location || 'USA',
                                  details: lab,
                                })
                              }
                              title={isSaved ? "Unsave lab" : "Save lab"}
                            >
                              ★
                            </button>
                          </div>
                          <div className="opp-job-title" style={{ fontSize: '15px', fontWeight: 700, margin: '6px 0', color: 'var(--text-primary)' }}>{lab.name}</div>
                          <div className="opp-job-meta" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                            <span className="opp-meta-tag">📍 {lab.location}</span>
                            <span className="opp-meta-tag">👤 Lead PI: {lab.director}</span>
                          </div>
                          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '8px', borderLeft: '2px solid rgba(255,255,255,0.06)', paddingLeft: '8px', fontStyle: 'italic', margin: '8px 0 0' }}>
                            <strong>Strategic Focus:</strong> {lab.relevance}
                          </p>
                        </div>
                        
                        {/* Top studies */}
                        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ font: 'var(--font-micro)', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.04em', borderTop: '1px solid var(--border-soft)', paddingTop: '10px', marginBottom: '4px' }}>
                            Active Core Studies
                          </div>
                          {lab.studies?.map((study, si) => (
                            <div key={si} style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.03)', borderRadius: '6px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)', fontWeight: 600 }}>{study.title}</strong>
                                <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                  PI: {study.leadDoctor}
                                </span>
                              </div>
                              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '2px 0 0' }}>{study.summary}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      <style>{`
        .opp-screen {
          background: transparent;
          min-height: 100vh;
          padding: 0 0 80px;
          font-family: 'Inter', 'Outfit', system-ui, sans-serif;
          color: var(--text-primary);
        }

        /* ── Audio Card ── */
        .opp-audio-card {
          background: var(--chrome-bg);
          border: 1px solid var(--border-soft);
          border-radius: 8px;
          margin: 14px 14px 10px;
          padding: 14px 16px;
        }
        .opp-audio-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }
        .opp-audio-title {
          font-family: 'Outfit', 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: #a78bfa;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .opp-audio-sub {
          font-size: 11px;
          color: var(--text-secondary);
          margin-top: 2px;
        }
        .opp-audio-toggle {
          background: rgba(109, 40, 217, 0.1);
          border: 1px solid rgba(109, 40, 217, 0.3);
          color: #a78bfa;
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-out);
        }
        .opp-audio-toggle:hover,
        .opp-audio-toggle--on {
          background: rgba(109, 40, 217, 0.22);
          border-color: rgba(109, 40, 217, 0.6);
        }
        .opp-audio-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .opp-audio-presets {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .opp-preset-chip {
          background: var(--surface-elevated);
          border: 1px solid var(--border-soft);
          color: var(--text-secondary);
          border-radius: 6px;
          padding: 5px 12px;
          font-size: 11px;
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-out);
        }
        .opp-preset-chip:hover {
          background: var(--surface-muted);
          color: var(--text-primary);
        }
        .opp-preset-chip--active {
          background: rgba(109, 40, 217, 0.12);
          border-color: rgba(109, 40, 217, 0.4);
          color: #a78bfa;
        }
        .opp-audio-volume {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .opp-vol-label { font-size: 11px; color: var(--text-secondary); min-width: 22px; }
        .opp-vol-slider {
          flex: 1;
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--border-soft);
          outline: none;
          cursor: pointer;
        }
        .opp-vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 2px;
          background: #a78bfa;
          cursor: pointer;
        }
        .opp-vol-value { font-size: 11px; color: var(--text-secondary); min-width: 28px; text-align: right; }

        /* ── Tabs ── */
        .opp-tab-row {
          display: flex;
          gap: 0;
          margin: 0 14px 10px;
          background: var(--surface-elevated);
          border-radius: 8px;
          padding: 4px;
          border: 1px solid var(--border-soft);
        }
        .opp-tab {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 9px 0;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-out);
        }
        .opp-tab:hover {
          color: var(--text-primary);
        }
        .opp-tab--active {
          background: var(--surface);
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
        }

        /* ── Panel ── */
        .opp-panel {
          padding: 0 14px;
        }

        /* ── Sweep ── */
        .opp-sweep-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .opp-sweep-btn {
          background: var(--success-light);
          border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
          color: var(--success);
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-out);
        }
        .opp-sweep-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--success) 18%, transparent); }
        .opp-sweep-btn--running, .opp-sweep-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .opp-sweep-status {
          font-size: 11px;
          color: var(--text-secondary);
        }
        .opp-sweep-status--err { color: var(--error); }

        /* ── Stats ── */
        .opp-stats-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 10px;
          font-size: 11.5px;
          color: var(--text-secondary);
          padding: 8px 12px;
          background: var(--surface-elevated);
          border-radius: 8px;
          border: 1px solid var(--border-soft);
        }
        .opp-stats-row strong { color: var(--text-primary); }
        .opp-stats-row--sch { margin-bottom: 12px; }
        .opp-metadata-panel {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-bottom: 12px;
          padding: 10px 12px;
          background: var(--surface);
          border: 1px solid var(--border-soft);
          border-radius: 8px;
          color: var(--text-secondary);
          font-size: 11.5px;
          line-height: 1.45;
        }
        .opp-metadata-panel strong {
          color: var(--text-primary);
        }

        /* ── Sub-tabs ── */
        .opp-subtab-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .opp-subtab {
          background: var(--surface-elevated);
          border: 1px solid var(--border-soft);
          color: var(--text-secondary);
          border-radius: 7px;
          padding: 6px 13px;
          font-size: 12px;
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-out);
        }
        .opp-subtab:hover {
          background: var(--surface-muted);
          color: var(--text-primary);
        }
        .opp-subtab--active {
          background: var(--surface);
          border-color: var(--border-strong);
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
        }

        /* ── Cards ── */
        .opp-card {
          background: var(--surface);
          border: 1px solid var(--border-soft);
          border-radius: 8px;
          margin-bottom: 8px;
          overflow: hidden;
          transition: border-color var(--duration-fast) var(--ease-out);
        }
        .opp-card:hover { border-color: var(--border-strong); }
        .opp-card--expired { opacity: 0.5; }
        .opp-card-header {
          padding: 12px 14px;
          cursor: pointer;
        }
        .opp-card-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .opp-cat-badge { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; }
        .opp-score-badge {
          font-size: 10px;
          color: var(--text-secondary);
          background: var(--surface-muted);
          border-radius: 4px;
          padding: 2px 8px;
        }
        .opp-score-badge strong { color: var(--text-primary); }
        .opp-ff-badge {
          font-size: 10.5px;
          color: var(--warning);
          background: var(--warning-light);
          border: 1px solid color-mix(in srgb, var(--warning) 20%, var(--border));
          border-radius: 4px;
          padding: 2px 8px;
        }
        .opp-expired-badge {
          font-size: 10px;
          color: var(--error);
          background: var(--error-light);
          border-radius: 4px;
          padding: 2px 8px;
        }
        .opp-deadline-badge {
          font-size: 10px;
          color: var(--text-secondary);
          background: var(--surface-muted);
          border-radius: 4px;
          padding: 2px 8px;
        }
        .opp-job-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 6px;
          line-height: 1.35;
          font-family: 'Outfit', 'Inter', sans-serif;
        }
        .opp-job-meta {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .opp-meta-tag {
          font-size: 11px;
          color: var(--text-secondary);
          background: var(--surface-muted);
          border-radius: 4px;
          padding: 2px 7px;
        }
        .opp-meta-tag.salary { color: var(--success); background: var(--success-light); }

        /* ── Card Body ── */
        .opp-card-body {
          padding: 0 14px 14px;
          border-top: 1px solid var(--border-soft);
        }
        .opp-why-shown { margin-top: 10px; }
        .opp-why-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
          margin-bottom: 6px;
        }
        .opp-why-chips { display: flex; gap: 5px; flex-wrap: wrap; }
        .opp-why-chip {
          font-size: 10.5px;
          color: var(--text-secondary);
          background: var(--surface-muted);
          border: 1px solid var(--border-soft);
          border-radius: 4px;
          padding: 3px 8px;
        }
        .opp-why-chip--fit {
          color: var(--accent);
          background: var(--accent-light);
          border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
        }
        .opp-evidence-line {
          margin: 8px 0 0;
          color: var(--text-secondary);
          font-size: 11.5px;
          line-height: 1.55;
        }
        .opp-desc {
          font-size: 12.5px;
          color: var(--text-secondary);
          line-height: 1.6;
          margin-top: 10px;
        }
        .opp-apply-btn {
          display: inline-block;
          margin-top: 12px;
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          text-decoration: none;
          border: 1px solid var(--border);
          border-radius: 7px;
          padding: 6px 14px;
          transition: all var(--duration-fast) var(--ease-out);
        }
        .opp-apply-btn:hover {
          background: var(--accent-light);
          border-color: var(--accent);
        }

        /* ── Scholarship Filters ── */
        .opp-sch-filters { margin-bottom: 12px; }
        .opp-search-input {
          width: 100%;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 9px;
          padding: 10px 14px;
          color: var(--text-primary);
          font-size: 13px;
          outline: none;
          margin-bottom: 8px;
          box-sizing: border-box;
          transition: border-color var(--duration-fast) var(--ease-out);
        }
        .opp-search-input:focus { border-color: var(--accent); }
        .opp-search-input::placeholder { color: var(--text-tertiary); }
        .opp-filter-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .opp-select {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 12px;
          color: var(--text-secondary);
          font-size: 12px;
          outline: none;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
        }
        .opp-region-input {
          flex: 1;
          min-width: 120px;
          margin-bottom: 0;
          padding: 8px 12px;
          font-size: 12px;
        }
        .opp-funded-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          cursor: pointer;
        }
        .opp-funded-toggle input { accent-color: var(--accent); }

        /* ── States ── */
        .opp-loading {
          text-align: center;
          padding: 32px 0;
          color: var(--text-tertiary);
          font-size: 13px;
        }
        .opp-bookmark-btn {
          background: transparent;
          border: none;
          color: var(--text-tertiary);
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: color var(--duration-normal) var(--ease-out),
                      background-color var(--duration-normal) var(--ease-out),
                      text-shadow var(--duration-normal) var(--ease-out),
                      transform var(--duration-fast) var(--ease-spring);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .opp-bookmark-btn:hover {
          color: var(--warning);
          background: var(--warning-light);
          transform: scale(1.15);
        }
        .opp-bookmark-btn:active {
          transform: scale(0.9);
        }
        .opp-bookmark-btn--saved {
          color: var(--warning);
          text-shadow: 0 0 8px rgba(255, 149, 0, 0.4);
        }
        .opp-error {
          background: var(--error-light);
          border: 1px solid color-mix(in srgb, var(--error) 20%, var(--border));
          border-radius: 9px;
          padding: 14px 16px;
          color: var(--error);
          font-size: 12.5px;
          line-height: 1.6;
          margin-bottom: 12px;
        }
        .opp-empty {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-tertiary);
          font-size: 13px;
          line-height: 1.7;
        }
      `}</style>
    </div>
  );
}
