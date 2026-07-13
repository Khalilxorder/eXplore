'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchCultureZeitgeist } from '../lib/api';
import { openExternalUrl } from '../lib/external';
import { ArrowLeftIcon } from './Icons';

/* ── Filter chips ──────────────────────────────────────────── */
const FILTERS = [
  { key: 'all',      label: 'All',      emoji: '🌐' },
  { key: 'trending', label: 'Trending', emoji: '🔥' },
  { key: 'arts',     label: 'Arts',     emoji: '🎭' },
  { key: 'science',  label: 'Science',  emoji: '🔬' },
  { key: 'society',  label: 'Society',  emoji: '🏛️' },
  { key: 'tech',     label: 'Tech',     emoji: '💻' },
];

/* ── Momentum bar ──────────────────────────────────────────── */
function MomentumBar({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const color = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className="culture-momentum-bar-wrap">
      <div className="culture-momentum-track">
        <div className="culture-momentum-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="culture-momentum-val">{pct}%</span>
    </div>
  );
}

/* ── Theme card ────────────────────────────────────────────── */
const PALETTE = [
  { bg: 'linear-gradient(135deg, rgba(96,165,250,0.10) 0%, rgba(6,182,212,0.06) 100%)', border: 'rgba(96,165,250,0.18)', accent: 'hsl(200, 80%, 35%)' },
  { bg: 'linear-gradient(135deg, rgba(244,162,97,0.10) 0%, rgba(251,191,36,0.06) 100%)', border: 'rgba(251,191,36,0.18)', accent: 'hsl(38, 80%, 35%)' },
  { bg: 'linear-gradient(135deg, rgba(52,211,153,0.10) 0%, rgba(16,185,129,0.06) 100%)', border: 'rgba(52,211,153,0.18)', accent: 'hsl(158, 60%, 30%)' },
  { bg: 'linear-gradient(135deg, rgba(167,139,250,0.10) 0%, rgba(139,92,246,0.06) 100%)', border: 'rgba(167,139,250,0.18)', accent: 'hsl(265, 55%, 40%)' },
  { bg: 'linear-gradient(135deg, rgba(248,113,113,0.10) 0%, rgba(239,68,68,0.06) 100%)', border: 'rgba(239,68,68,0.18)', accent: 'hsl(0, 65%, 42%)' },
];

function ThemeCard({ theme, index, onOpen }) {
  const palette = PALETTE[index % PALETTE.length];
  const categoryMatch = FILTERS.find((f) => f.key !== 'all' && String(theme.category || '').toLowerCase().includes(f.key));
  const categoryLabel = categoryMatch ? `${categoryMatch.emoji} ${categoryMatch.label}` : theme.category || '';

  const cardStyle = {
    '--card-bg': palette.bg,
    '--card-border': palette.border,
    '--card-border-hover': palette.accent,
    '--card-accent': palette.accent,
    '--badge-bg': palette.border,
    '--badge-color': palette.accent,
  };

  return (
    <button
      type="button"
      className="culture-card"
      style={cardStyle}
      onClick={() => onOpen(theme)}
    >
      {/* Header row */}
      <div className="culture-card-header">
        <h3 className="culture-card-title">{theme.title}</h3>
        <div className="culture-card-badges">
          {categoryLabel && (
            <span className="culture-badge culture-badge--category">
              {categoryLabel}
            </span>
          )}
          {theme.timeline && (
            <span className="culture-badge culture-badge--timeline">
              {theme.timeline}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {theme.description && (
        <p className="culture-card-desc">
          {theme.description}
        </p>
      )}

      {/* Momentum */}
      {theme.percentage != null && (
        <div className="culture-momentum">
          <p className="culture-momentum-label">Share of voice</p>
          <MomentumBar value={theme.percentage} />
        </div>
      )}

      {/* Key signals */}
      {Array.isArray(theme.signals) && theme.signals.length > 0 && (
        <div className="culture-signals">
          {theme.signals.slice(0, 4).map((sig) => (
            <span key={sig} className="culture-signal-tag">
              {sig}
            </span>
          ))}
        </div>
      )}

      {/* Link */}
      {theme.url && (
        <span className="culture-card-link">
          Read more →
        </span>
      )}
    </button>
  );
}

/* ── Theme detail modal ────────────────────────────────────── */
function ThemeModal({ theme, onClose }) {
  if (!theme) return null;
  return (
    <div className="culture-modal-backdrop" onClick={onClose}>
      <div className="culture-modal" onClick={(e) => e.stopPropagation()}>
        <div className="culture-modal-header">
          <h2 className="culture-modal-title">{theme.title}</h2>
          <button type="button" className="culture-modal-close" onClick={onClose}>✕</button>
        </div>
        {theme.description && (
          <p className="culture-modal-desc">{theme.description}</p>
        )}
        {theme.full_description && (
          <p className="culture-modal-full-desc">{theme.full_description}</p>
        )}
        {theme.percentage != null && (
          <div className="culture-momentum">
            <p className="culture-momentum-label">Share of voice</p>
            <MomentumBar value={theme.percentage} />
          </div>
        )}
        {Array.isArray(theme.signals) && theme.signals.length > 0 && (
          <div>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginBottom: 8 }}>Key signals</p>
            <div className="culture-signals">
              {theme.signals.map((sig) => (
                <span key={sig} className="culture-signal-tag">{sig}</span>
              ))}
            </div>
          </div>
        )}
        {theme.url && (
          <button
            type="button"
            className="culture-modal-btn"
            onClick={() => openExternalUrl(theme.url)}
          >
            Read full story →
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Skeletons ─────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div className="balanced-grid">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 140, borderRadius: 'var(--radius-lg)' }} />
      ))}
    </div>
  );
}

/* ── Main screen ───────────────────────────────────────────── */
export default function CultureScreen({ onBack }) {
  const [loading, setLoading]         = useState(true);
  const [data, setData]               = useState(null);
  const [error, setError]             = useState(false);
  const [filter, setFilter]           = useState('all');
  const [openTheme, setOpenTheme]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetchCultureZeitgeist();
      setData(response || {});
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const themes = Array.isArray(data?.themes) ? data.themes : [];
  const summary = data?.summary || '';

  const filtered = filter === 'all'
    ? themes
    : themes.filter((t) => String(t.category || '').toLowerCase().includes(filter) || String(t.title || '').toLowerCase().includes(filter));

  return (
    <>
      {openTheme && <ThemeModal theme={openTheme} onClose={() => setOpenTheme(null)} />}

      <div className="page-enter culture-screen">

        {/* Hero header */}
        <div className="culture-hero">
          <div className="container">
            <div className="culture-hero-inner">
              <button
                type="button"
                className="btn-icon btn-ghost"
                onClick={onBack}
                aria-label="Back"
                style={{ flexShrink: 0 }}
              >
                <ArrowLeftIcon size={22} />
              </button>
              <span className="culture-hero-emoji">🎭</span>
              <div className="culture-hero-title-container">
                <h1 className="culture-hero-title">Culture Zeitgeist</h1>
                <p className="culture-hero-subtitle">
                  AI-synthesized societal mood · Arts · Science · Society · Tech
                </p>
              </div>
            </div>

            {summary ? (
              <div className="culture-summary-card">
                <span className="culture-summary-icon">✨</span>
                <p className="culture-summary-text">{summary}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Filter chips */}
        <div className="container">
          <div className="culture-filter-row">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`culture-filter-chip ${filter === f.key ? 'culture-filter-chip--active' : ''}`}
              >
                <span>{f.emoji}</span>
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="container balanced-grid">
          {loading && <Skeleton />}

          {!loading && error && (
            <div className="premium-empty-card" style={{ gridColumn: '1 / -1' }}>
              <span className="premium-empty-card-icon">📡</span>
              <h3 className="premium-empty-card-title">Culture feed unavailable</h3>
              <p className="premium-empty-card-desc" style={{ marginBottom: '8px' }}>
                The zeitgeist analysis is temporarily offline. Try again in a moment.
              </p>
              <button type="button" onClick={load} className="culture-modal-btn">
                Retry
              </button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="premium-empty-card" style={{ gridColumn: '1 / -1' }}>
              <span className="premium-empty-card-icon">🔭</span>
              <h3 className="premium-empty-card-title">No themes in this category</h3>
              <p className="premium-empty-card-desc">Try switching to All or a different filter.</p>
            </div>
          )}

          {!loading && !error && filtered.map((theme, idx) => (
            <ThemeCard
              key={theme.title || idx}
              theme={theme}
              index={idx}
              onOpen={setOpenTheme}
            />
          ))}
        </div>
      </div>
    </>
  );
}
