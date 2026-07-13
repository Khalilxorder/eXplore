'use client';
import { useCallback, useEffect, useState } from 'react';
import { createCollection, fetchCollections } from '../lib/api';

/* ── Empty state illustration ──────────────────────────────── */
function CollectionsEmpty({ onNew }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px 40px' }}>
      <div style={{
        width: 72, height: 72, borderRadius: 'var(--radius-sm)',
        background: 'var(--accent-light)', border: '2px solid var(--accent-medium)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 30, margin: '0 auto 20px',
      }}>
        📚
      </div>
      <h2 style={{ font: 'var(--font-h2)', marginBottom: 8, color: 'var(--text-primary)' }}>
        No collections yet
      </h2>
      <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24, maxWidth: 280, margin: '0 auto 24px' }}>
        Collections let you group saved content into topics, projects, or reading lists.
      </p>
      <button
        type="button"
        onClick={onNew}
        style={{
          padding: '12px 24px', background: 'var(--accent)', color: '#fff',
          borderRadius: 'var(--radius-sm)', font: 'var(--font-button)', fontWeight: 700,
          boxShadow: '0 0 20px rgba(96,165,250,0.20)',
        }}
      >
        Create your first collection
      </button>
    </div>
  );
}

/* ── Create modal ──────────────────────────────────────────── */
function CreateModal({ onClose, onCreate }) {
  const [name, setName]           = useState('');
  const [description, setDesc]    = useState('');
  const [isPublic, setPublic]     = useState(false);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Name is required.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await createCollection(trimmedName, description.trim(), isPublic);
      if (result) {
        onCreate(result);
        onClose();
      } else {
        setError('Could not create collection. Try again.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 540, background: 'var(--surface-elevated)',
          borderTop: '1px solid var(--border)', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
          padding: '24px 20px 36px',
          display: 'flex', flexDirection: 'column', gap: 16,
          animation: 'slideUp 220ms var(--ease-out)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ font: 'var(--font-h2)', margin: 0 }}>New collection</h2>
          <button type="button" onClick={onClose} style={{ color: 'var(--text-tertiary)', fontSize: 20, background: 'none', padding: '4px 8px' }}>✕</button>
        </div>

        <input
          type="text"
          className="text-surface"
          placeholder="Collection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoFocus
        />

        <textarea
          className="text-surface"
          rows={3}
          placeholder="Optional description"
          value={description}
          onChange={(e) => setDesc(e.target.value)}
          maxLength={300}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', font: 'var(--font-body)', color: 'var(--text-secondary)' }}>
          <div
            role="checkbox"
            aria-checked={isPublic}
            tabIndex={0}
            onClick={() => setPublic((v) => !v)}
            onKeyDown={(e) => e.key === 'Enter' && setPublic((v) => !v)}
            style={{
              width: 20, height: 20, borderRadius: 4,
              border: isPublic ? '2px solid var(--accent)' : '2px solid var(--border)',
              background: isPublic ? 'var(--accent)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 150ms', flexShrink: 0,
            }}
          >
            {isPublic && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>✓</span>}
          </div>
          Make this collection public
        </label>

        {error && (
          <p style={{ font: 'var(--font-caption)', color: 'var(--error)', margin: 0 }}>{error}</p>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={busy || !name.trim()}
          style={{
            padding: '13px 0', background: busy || !name.trim() ? 'var(--surface-elevated)' : 'var(--accent)',
            color: busy || !name.trim() ? 'var(--text-tertiary)' : '#fff',
            borderRadius: 'var(--radius-full)', font: 'var(--font-button)', fontWeight: 700,
            transition: 'background 150ms',
          }}
        >
          {busy ? 'Creating…' : 'Create collection'}
        </button>
      </div>
    </div>
  );
}

/* ── Collection card ───────────────────────────────────────── */
const CARD_PALETTES = [
  { icon: '📘', accent: 'hsl(220,80%,72%)' },
  { icon: '📗', accent: 'hsl(158,60%,56%)' },
  { icon: '📙', accent: 'hsl(38,80%,65%)' },
  { icon: '📕', accent: 'hsl(0,70%,68%)' },
  { icon: '📓', accent: 'hsl(265,65%,72%)' },
];

function CollectionCard({ collection, index }) {
  const palette = CARD_PALETTES[index % CARD_PALETTES.length];
  const itemCount = Number(collection.item_count || collection.itemCount || 0);

  return (
    <div
      style={{
        padding: '18px 16px', borderRadius: 'var(--radius-lg)',
        background: 'var(--surface)', border: '1px solid var(--border)',
        display: 'flex', gap: 14, alignItems: 'flex-start',
        transition: 'border-color 150ms, transform 150ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = palette.accent; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.transform = ''; }}
    >
      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 'var(--radius-md)', flexShrink: 0,
        background: `color-mix(in srgb, ${palette.accent} 12%, var(--surface-elevated))`,
        border: `1px solid color-mix(in srgb, ${palette.accent} 24%, var(--border))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
      }}>
        {palette.icon}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <strong style={{ font: 'var(--font-h3)', color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
            {collection.name}
          </strong>
          {collection.is_public && (
            <span style={{ font: 'var(--font-micro)', padding: '3px 8px', borderRadius: 'var(--radius-full)', background: 'var(--accent-light)', color: 'var(--accent)', flexShrink: 0 }}>
              Public
            </span>
          )}
        </div>
        {collection.description && (
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
            {collection.description}
          </p>
        )}
        <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
      </div>
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 88, borderRadius: 'var(--radius-lg)' }} />
      ))}
    </div>
  );
}

/* ── Main screen ───────────────────────────────────────────── */
export default function CollectionsScreen({ onBack }) {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(false);
  const [showCreate, setShowCreate]   = useState(false);
  const [search, setSearch]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchCollections();
      setCollections(Array.isArray(result?.collections || result) ? (result?.collections ?? result) : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreated = (newCol) => {
    setCollections((prev) => [newCol, ...prev]);
  };

  const filtered = search.trim()
    ? collections.filter((c) => String(c.name || '').toLowerCase().includes(search.toLowerCase()))
    : collections;

  return (
    <>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />}

      <div className="page-enter" style={{ paddingBottom: 'var(--space-2xl)' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 16px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <h1 style={{ font: 'var(--font-h2)', margin: 0 }}>Collections</h1>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', margin: 0 }}>
              {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            style={{
              padding: '9px 18px', background: 'var(--accent)', color: '#fff',
              borderRadius: 'var(--radius-full)', font: 'var(--font-button)', fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 400 }}>+</span> New
          </button>
        </div>

        {/* Search */}
        {collections.length > 3 && (
          <div style={{ padding: '12px 16px' }}>
            <input
              type="text"
              className="text-surface"
              placeholder="Search collections…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {/* Content */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading && <Skeleton />}

          {!loading && error && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📡</div>
              <strong style={{ font: 'var(--font-h3)', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                Could not load collections
              </strong>
              <button type="button" onClick={load} style={{ padding: '10px 20px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-full)', font: 'var(--font-button)' }}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && collections.length === 0 && (
            <CollectionsEmpty onNew={() => setShowCreate(true)} />
          )}

          {!loading && !error && collections.length > 0 && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-tertiary)' }}>
              <p style={{ font: 'var(--font-body)' }}>No collections match &ldquo;{search}&rdquo;</p>
            </div>
          )}

          {!loading && !error && filtered.map((col, idx) => (
            <CollectionCard key={col.id || idx} collection={col} index={idx} />
          ))}
        </div>
      </div>
    </>
  );
}
