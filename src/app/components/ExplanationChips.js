'use client';

/**
 * Shared explanation grammar chips (product plan Parts 3–4, 15).
 * Renders short, evidence-linked labels without chain-of-thought.
 */
export default function ExplanationChips({
  explanation = null,
  rationale = null,
  compact = false,
  showText = true,
}) {
  if (!explanation && !rationale) {
    return null;
  }

  const chips = Array.isArray(explanation?.chips) && explanation.chips.length
    ? explanation.chips
    : buildFallbackChips(explanation, rationale);

  const whyShown = explanation?.why_shown || rationale?.whyShown || '';
  const whyNow = explanation?.why_now || rationale?.whyNow || '';
  const whyTrusted = explanation?.why_trusted || rationale?.whyTrusted || '';
  const confidence = explanation?.confidence;
  const actionLabel = explanation?.action?.label || null;

  return (
    <div
      className="explanation-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '6px' : '8px',
        padding: compact ? '8px 10px' : 'var(--space-base, 12px)',
        borderRadius: 'var(--radius-md, 10px)',
        background: 'var(--surface-elevated, var(--surface))',
        border: '1px solid var(--border-soft, var(--border))',
      }}
    >
      {showText && whyShown ? (
        <p style={{ margin: 0, font: 'var(--font-body)', lineHeight: 1.45 }}>{whyShown}</p>
      ) : null}
      {showText && whyTrusted ? (
        <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
          <strong>Why trusted:</strong> {whyTrusted}
        </p>
      ) : null}
      {showText && whyNow ? (
        <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
          <strong>Why now:</strong> {whyNow}
        </p>
      ) : null}
      {typeof confidence === 'number' ? (
        <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
          <strong>Confidence:</strong> {Math.round(confidence * 100)}%
          {actionLabel ? <> · <strong>Next:</strong> {actionLabel}</> : null}
        </p>
      ) : null}
      {chips.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} aria-label="Explanation chips">
          {chips.map((chip) => (
            <span
              key={chip.id || chip.label}
              className="chip"
              data-kind={chip.kind || 'info'}
              style={{
                font: 'var(--font-caption)',
                padding: '2px 8px',
                borderRadius: '999px',
                border: '1px solid var(--border-soft, var(--border))',
                background: chip.kind === 'trust'
                  ? 'var(--success-light, rgba(52,199,89,0.12))'
                  : chip.kind === 'story_layer'
                    ? 'rgba(167, 139, 250, 0.12)'
                    : chip.kind === 'action'
                      ? 'var(--error-light, rgba(255,59,48,0.10))'
                      : 'var(--surface)',
                color: chip.kind === 'story_layer' ? '#a78bfa' : 'var(--text-secondary)',
              }}
            >
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildFallbackChips(explanation, rationale) {
  const chips = [];
  if (explanation?.story_layer?.label) {
    chips.push({ id: 'story', label: explanation.story_layer.label, kind: 'story_layer' });
  }
  if (explanation?.goals?.[0]?.text) {
    chips.push({ id: 'goal', label: 'Current Goal', kind: 'goal' });
  }
  if (explanation?.source?.role === 'official' || /official|high-trust/i.test(String(explanation?.source?.trust_label || rationale?.whyTrusted || ''))) {
    chips.push({ id: 'trust', label: explanation?.source?.role === 'official' ? 'Official Source' : 'Trusted Source', kind: 'trust' });
  }
  if (explanation?.freshness?.label && /fresh|recent/i.test(explanation.freshness.label)) {
    chips.push({ id: 'fresh', label: 'Fresh', kind: 'freshness' });
  }
  if (typeof explanation?.confidence === 'number' && explanation.confidence >= 0.7) {
    chips.push({ id: 'conf', label: 'High Confidence', kind: 'confidence' });
  } else if (typeof explanation?.confidence === 'number' && explanation.confidence < 0.45) {
    chips.push({ id: 'verify', label: 'Needs Verification', kind: 'confidence' });
  }
  for (const topic of (explanation?.topics || []).slice(0, 2)) {
    chips.push({ id: `t-${topic.name}`, label: topic.name, kind: 'topic' });
  }
  return chips;
}
