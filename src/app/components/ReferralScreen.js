'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { fetchReferralCode, redeemReferralCode } from '../lib/api';

function StatusBadge({ status, children }) {
  const tones = {
    live: { color: 'var(--success)', border: 'var(--success-light)', background: 'var(--success-light)' },
    partial: { color: 'var(--warning)', border: 'var(--warning-light)', background: 'var(--warning-light)' },
    empty: { color: 'var(--text-tertiary)', border: 'var(--border)', background: 'var(--surface-elevated)' },
  };
  const tone = tones[status] || tones.empty;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: tone.color,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        borderRadius: 999,
        padding: '4px 10px',
      }}
    >
      {children}
    </span>
  );
}

function Card({ children, style = {} }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 14,
        background: 'var(--surface)',
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function ReferralScreen({ onBack }) {
  const [referral, setReferral] = useState(null);
  const [loading, setLoading] = useState(true);
  const [redeemCode, setRedeemCode] = useState('');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fetchReferralCode();
      if (cancelled) {
        return;
      }

      setReferral(data || null);
      if (!data) {
        setMessage('Please sign in to view your referral stats and share links.');
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function showMessage(nextMessage) {
    setMessage(nextMessage);
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => setMessage(''), 4500);
  }

  async function handleCopy() {
    if (!referral?.share_link || !navigator?.clipboard) {
      showMessage('Share link is not ready yet.');
      return;
    }

    await navigator.clipboard.writeText(referral.share_link);
    setCopied(true);
    window.clearTimeout(handleCopy.timer);
    handleCopy.timer = window.setTimeout(() => setCopied(false), 1800);
  }

  async function handleRedeem() {
    if (!redeemCode.trim()) {
      showMessage('Enter a referral code before redeeming.');
      return;
    }

    const result = await redeemReferralCode(redeemCode.trim().toUpperCase());
    if (!result || result.error) {
      showMessage(result?.error || 'Referral code could not be redeemed right now.');
      return;
    }

    showMessage(result.message || 'Referral code redeemed.');
    setRedeemCode('');
    const next = await fetchReferralCode();
    setReferral(next || null);
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        Loading referral settings...
      </div>
    );
  }

  const totalConversions = referral?.total_conversions || 0;
  const freeMonthsEarned = referral?.free_months_earned || 0;
  const progress = totalConversions % 3;
  const shareLinkReady = Boolean(referral?.share_link && referral?.share_link_ready !== false);
  const status = referral?.code && shareLinkReady ? 'live' : 'partial';

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base)', maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          className="btn-icon btn-ghost"
          onClick={onBack}
          aria-label="Back"
          style={{ flexShrink: 0 }}
        >
          <ArrowLeftIcon size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Referrals
            </h1>
            <StatusBadge status={status}>{status === 'live' ? 'Live' : 'Partial / setup needed'}</StatusBadge>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            Referral rewards only appear when this signed-in account has a live code and recorded conversions.
            {!shareLinkReady ? ' The public join link is not configured yet, so only the code itself is ready.' : ''}
          </p>
        </div>
      </div>

      <Card style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
          Current reward state
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
          {referral?.reward || 'Every 3 successful referrals earns 1 free month.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 16 }}>
          {[
            { label: 'Successful referrals', value: totalConversions },
            { label: 'Free months earned', value: freeMonthsEarned },
            { label: 'Toward next reward', value: `${progress}/3` },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)' }}>{item.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>
          Your referral link
        </h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            marginBottom: 10,
          }}
        >
          <code style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
            {referral?.share_link || 'Link unavailable until a real app URL is configured.'}
          </code>
          <button
            onClick={handleCopy}
            disabled={!referral?.share_link}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: copied ? 'var(--text-primary)' : 'transparent',
              color: copied ? 'var(--bg)' : 'var(--text-primary)',
              cursor: referral?.share_link ? 'pointer' : 'not-allowed',
              fontWeight: 700,
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Code: <strong>{referral?.code || 'Unavailable'}</strong>
        </div>
        {!shareLinkReady && referral?.code && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Share the code directly until a public join URL is configured.
          </div>
        )}
      </Card>

      <Card>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>
          Redeem a referral code
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
          If someone shared a referral code with you, enter it here to redeem.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={redeemCode}
            onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
            placeholder="EXP-XXXX-XXXXXX"
            style={{
              flex: 1,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-elevated)',
              color: 'var(--text-primary)',
              fontSize: 14,
            }}
          />
          <button
            onClick={handleRedeem}
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--text-primary)',
              color: 'var(--bg)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Redeem
          </button>
        </div>
      </Card>

      {message ? (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface-elevated)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
