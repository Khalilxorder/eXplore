function normalizeTrustValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric > 1 && numeric <= 5) {
    return Math.max(0, Math.min(1, numeric / 5));
  }

  if (numeric > 5 && numeric <= 100) {
    return Math.max(0, Math.min(1, numeric / 100));
  }

  return Math.max(0, Math.min(1, numeric));
}

function getTrustTone(score) {
  if (score >= 0.9) {
    return {
      label: 'Highly trusted',
      background: 'rgba(6, 118, 71, 0.12)',
      color: '#067647',
      border: 'rgba(6, 118, 71, 0.18)',
    };
  }

  if (score >= 0.75) {
    return {
      label: 'Trusted source',
      background: 'rgba(30, 90, 168, 0.10)',
      color: 'var(--accent)',
      border: 'rgba(30, 90, 168, 0.18)',
    };
  }

  return {
    label: 'Established source',
    background: 'rgba(71, 85, 105, 0.10)',
    color: 'var(--text-secondary)',
    border: 'rgba(71, 85, 105, 0.18)',
  };
}

export function getSourceTrustValue(item) {
  const candidates = [
    item?.sourceTrust,
    item?.scores?.sourceTrust,
    item?.trust_score,
    item?.sourceTrustTier,
    item?.source_trust_tier,
    item?.sourceTrustScore,
    item?.scores?.trustScore,
  ];

  for (const candidate of candidates) {
    const trustValue = normalizeTrustValue(candidate);
    if (trustValue !== null) {
      return trustValue;
    }
  }

  return null;
}

export function getSourceTrustBadge(item) {
  if (item?.sourceTrustProvided === false) {
    return null;
  }

  const score = getSourceTrustValue(item);
  if (score === null) {
    return null;
  }

  const isWritten = String(item?.channelType || '').toLowerCase() === 'written';
  if (!isWritten && score < 0.6) {
    return null;
  }

  const tone = getTrustTone(score);
  return {
    label: tone.label,
    score,
    title: `Source trust ${Math.round(score * 100)}/100`,
    style: {
      background: tone.background,
      color: tone.color,
      border: `1px solid ${tone.border}`,
    },
  };
}
