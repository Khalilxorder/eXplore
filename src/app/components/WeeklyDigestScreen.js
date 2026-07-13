'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchWeeklyDigest } from '../lib/api';
import { openExternalUrl } from '../lib/external';

/* ── Format helpers ──────────────────────────────────────────── */
function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(value));
  } catch { return String(value); }
}

/* ── Digest section card ─────────────────────────────────────── */
const SECTION_PALETTES = [
  { border: 'rgba(96,165,250,0.20)', glow: 'rgba(96,165,250,0.07)', label: 'var(--accent)' },
  { border: 'rgba(52,211,153,0.20)', glow: 'rgba(52,211,153,0.07)', label: 'hsl(158,60%,52%)' },
  { border: 'rgba(244,162,97,0.20)', glow: 'rgba(244,162,97,0.07)', label: 'hsl(38,80%,65%)' },
  { border: 'rgba(167,139,250,0.20)', glow: 'rgba(167,139,250,0.07)', label: 'hsl(265,65%,72%)' },
  { border: 'rgba(248,113,113,0.20)', glow: 'rgba(248,113,113,0.07)', label: 'hsl(0,70%,68%)' },
];

function DigestSection({ section, index }) {
  const palette = SECTION_PALETTES[index % SECTION_PALETTES.length];
  const items = Array.isArray(section.items) ? section.items : [];
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <div style={{
      borderRadius: 'var(--radius-lg)',
      border: `1px solid ${palette.border}`,
      background: `linear-gradient(135deg, ${palette.glow} 0%, var(--surface) 100%)`,
      overflow: 'hidden',
      transition: 'box-shadow 150ms',
    }}>
      {/* Section header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 12, padding: '18px 16px', background: 'none', textAlign: 'left',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {section.category && (
            <span style={{
              font: 'var(--font-micro)', color: palette.label, fontWeight: 700,
              letterSpacing: '0.08em', display: 'block', marginBottom: 4,
            }}>
              {String(section.category).toUpperCase()}
            </span>
          )}
          <h2 style={{ font: 'var(--font-h3)', margin: 0, color: 'var(--text-primary)' }}>
            {section.title || section.heading || 'Section'}
          </h2>
          {section.subtitle && !expanded && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              {section.subtitle}
            </p>
          )}
        </div>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 18, flexShrink: 0, transition: 'transform 200ms', transform: expanded ? 'rotate(180deg)' : 'none' }}>
          ⌄
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {section.summary && (
            <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
              {section.summary}
            </p>
          )}

          {section.narrative && (
            <div style={{
              padding: '14px', borderRadius: 'var(--radius-md)',
              background: 'var(--surface-elevated)', borderLeft: `3px solid ${palette.label}`,
            }}>
              <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', lineHeight: 1.7, margin: 0 }}>
                {section.narrative}
              </p>
            </div>
          )}

          {/* Bullet items */}
          {items.length > 0 && (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 0, listStyle: 'none' }}>
              {items.map((item, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: palette.label, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>·</span>
                  <div style={{ flex: 1 }}>
                    {typeof item === 'string' ? (
                      <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{item}</p>
                    ) : (
                      <>
                        {item.title && <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)', display: 'block' }}>{item.title}</strong>}
                        {item.summary && <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '2px 0 0', lineHeight: 1.5 }}>{item.summary}</p>}
                        {item.url && (
                          <button type="button" onClick={() => openExternalUrl(item.url)}
                            style={{ font: 'var(--font-caption)', color: palette.label, background: 'none', marginTop: 4, padding: 0 }}>
                            Read more →
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {section.url && (
            <button type="button" onClick={() => openExternalUrl(section.url)}
              style={{
                alignSelf: 'flex-start', padding: '9px 18px',
                background: palette.glow, border: `1px solid ${palette.border}`,
                color: palette.label, borderRadius: 'var(--radius-full)', font: 'var(--font-button)',
              }}>
              Full coverage →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="skeleton" style={{ height: 80, borderRadius: 'var(--radius-lg)' }} />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 120, borderRadius: 'var(--radius-lg)' }} />
      ))}
    </div>
  );
}

/* ── Main screen ───────────────────────────────────────────────── */
export default function WeeklyDigestScreen({ onBack }) {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchWeeklyDigest();
      setData(result || {});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const headline = data?.headline || data?.title || 'Weekly Intelligence Digest';
  const subtitle = data?.subtitle || data?.summary || '';
  const publishedAt = data?.published_at || data?.publishedAt || '';
  const periodLabel = data?.period_label || data?.periodLabel || '';

  return (
    <div className="page-enter" style={{ paddingBottom: 'var(--space-2xl)' }}>

      {/* Hero */}
      <div style={{
        padding: '28px 16px 20px',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, var(--bg)) 0%, transparent 100%)',
        borderBottom: '1px solid var(--border)',
        marginBottom: 'var(--space-base)',
      }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <span style={{
            font: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.08em',
            padding: '4px 10px', borderRadius: 'var(--radius-full)',
            background: 'var(--accent-light)', color: 'var(--accent)',
          }}>
            WEEKLY DIGEST
          </span>
          {periodLabel && (
            <span style={{
              font: 'var(--font-micro)', fontWeight: 600, letterSpacing: '0.06em',
              padding: '4px 10px', borderRadius: 'var(--radius-full)',
              background: 'var(--surface-elevated)', color: 'var(--text-tertiary)',
            }}>
              {periodLabel}
            </span>
          )}
        </div>

        <h1 style={{ font: 'var(--font-h2)', margin: '0 0 8px', lineHeight: 1.25 }}>{headline}</h1>

        {subtitle && (
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0 0 12px' }}>
            {subtitle}
          </p>
        )}

        {publishedAt && (
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', margin: 0 }}>
            {formatDate(publishedAt)}
          </p>
        )}
      </div>

      {/* Content area */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading && <Skeleton />}

        {!loading && error && (
          <div style={{ textAlign: 'center', padding: '52px 0', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
            <strong style={{ font: 'var(--font-h3)', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              Digest not available yet
            </strong>
            <p style={{ font: 'var(--font-body)', marginBottom: 20, lineHeight: 1.6 }}>
              The weekly digest is compiled every Sunday. Check back soon, or try refreshing.
            </p>
            <button type="button" onClick={load}
              style={{ padding: '10px 22px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-full)', font: 'var(--font-button)' }}>
              Refresh
            </button>
          </div>
        )}

        {!loading && !error && sections.length === 0 && (
          <div style={{ textAlign: 'center', padding: '52px 0', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <strong style={{ font: 'var(--font-h3)', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              No sections in this digest
            </strong>
            <p style={{ font: 'var(--font-body)' }}>
              The live service is generating this week&apos;s digest. Check back later.
            </p>
          </div>
        )}

        {!loading && !error && sections.map((section, idx) => (
          <DigestSection key={section.id || section.title || idx} section={section} index={idx} />
        ))}
      </div>
    </div>
  );
}
