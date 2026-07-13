'use client';

import {
  MIDDLE_EAST_SUCCESS,
  MIDDLE_EAST_SUCCESS_METRICS,
  MIDDLE_EAST_SUCCESS_SOURCES,
} from '../data/middleEastSuccess';

function formatValue(value, format) {
  const number = Number(value) || 0;
  if (format === 'usd') {
    return `$${Math.round(number).toLocaleString('en-US')}`;
  }
  if (format === 'index') {
    return number.toFixed(3);
  }
  if (format === 'years') {
    return `${number.toFixed(1)} yrs`;
  }
  return String(number);
}

export default function MiddleEastSuccessGraph({ highlightCountryKey = '' }) {
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)', marginTop: 'var(--space-base)' }}>
      <div>
        <span className="page-kicker">Current state - sourced graph</span>
        <h3 className="section-title" style={{ marginTop: '6px' }}>How these countries are doing</h3>
        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '6px' }}>
          Most-recent reputable figures (2024). Each bar is scaled to the highest value in its row.
        </p>
      </div>

      {MIDDLE_EAST_SUCCESS_METRICS.map((metric) => {
        const max = Math.max(...MIDDLE_EAST_SUCCESS.map((entry) => Number(entry[metric.key]) || 0)) || 1;

        return (
          <div key={metric.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>{metric.label}</strong>
            {MIDDLE_EAST_SUCCESS.map((entry) => {
              const value = Number(entry[metric.key]) || 0;
              const pct = Math.max(3, Math.round((value / max) * 100));
              const active = Boolean(highlightCountryKey) && entry.leaderKey === highlightCountryKey;

              return (
                <div key={entry.country} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '128px', font: 'var(--font-caption)', color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400 }}>
                    {entry.country}
                  </span>
                  <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '16px',
                        background: active ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 50%, var(--surface))',
                      }}
                    />
                  </div>
                  <span style={{ width: '92px', textAlign: 'right', font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                    {formatValue(value, metric.format)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}

      <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
        Sources: {MIDDLE_EAST_SUCCESS_SOURCES}
      </p>
    </section>
  );
}


