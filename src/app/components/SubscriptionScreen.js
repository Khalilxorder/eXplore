'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import {
  fetchSubscription,
  fetchSubscriptionTiers,
  upgradeSubscription,
} from '../lib/api';

const TIER_COLORS = {
  Free: 'var(--text-tertiary)',
  'eXplore+': 'var(--accent)',
  'eXplore Family': 'var(--premium)',
};

const TIER_BADGES = {
  Free: 'FREE',
  'eXplore+': 'PLUS',
  'eXplore Family': 'FAMILY',
};

function getTierKey(tierName) {
  if (tierName === 'Free') {
    return 'free';
  }

  return tierName.toLowerCase().includes('family') ? 'family' : 'plus';
}

export default function SubscriptionScreen({ onBack }) {
  const [tiers, setTiers] = useState([]);
  const [currentSub, setCurrentSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(null);
  const [billing, setBilling] = useState('yearly');
  const [message, setMessage] = useState('');
  const [billingReady, setBillingReady] = useState(false);
  const [billingMessage, setBillingMessage] = useState('');

  useEffect(() => {
    Promise.all([
      fetchSubscriptionTiers(),
      fetchSubscription(),
    ])
      .then(([tiersData, subData]) => {
        setTiers(tiersData.tiers || []);
        setCurrentSub(subData || null);
        setBillingReady(Boolean(tiersData?.billing_live || subData?.billing_live));
        setBillingMessage(
          tiersData?.billing_message
          || subData?.billing_message
          || 'Checkout is not connected yet. Paid plan prices are visible, but this screen will not simulate a real upgrade.'
        );
        if (!subData?.tier_name) {
          setMessage('Sign in to manage subscription state. Public plan prices are still visible.');
        }
        setLoading(false);
      })
      .catch(() => {
        setMessage('Subscription details could not be loaded right now.');
        setLoading(false);
      });
  }, []);

  const handleUpgrade = async (tierName) => {
    const tierKey = getTierKey(tierName);
    setUpgrading(tierKey);

    try {
      const data = await upgradeSubscription(tierKey, billing);

      if (data.success) {
        setCurrentSub(data.subscription);
        setMessage(
          billingReady
            ? `Done: switched to ${data.subscription.tier_name}.`
            : `Done: ${data.subscription.tier_name} is active for this build. External checkout is still not wired.`
        );
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch {
      setMessage('Error: could not connect to the server.');
    }

    setUpgrading(null);
    setTimeout(() => setMessage(''), 4000);
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        Loading plans...
      </div>
    );
  }

  const currentTierName = currentSub?.tier_name || 'Free';

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base)', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          className="btn-icon btn-ghost"
          onClick={onBack}
          aria-label="Back"
          style={{ flexShrink: 0 }}
        >
          <ArrowLeftIcon size={22} />
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            eXplore Plans
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
            Current: <strong style={{ color: TIER_COLORS[currentTierName] }}>{currentTierName}</strong>
          </p>
        </div>
      </div>

      {!billingReady && (
        <div
          style={{
            marginBottom: 16,
            padding: '14px 16px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface-elevated)',
            color: 'var(--text-secondary)',
          }}
        >
          <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: 6 }}>
            Payment coming soon
          </strong>
          <span style={{ fontSize: 13, lineHeight: 1.5 }}>
            Paid plans are visible so you can see what’s included. Online checkout will be enabled at launch.
            You can still switch plans here to preview the full product flow.
          </span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 20,
          overflow: 'hidden',
        }}
      >
        {['monthly', 'yearly'].map((cycle) => (
          <button
            key={cycle}
            onClick={() => setBilling(cycle)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              transition: 'all 0.2s',
              background: billing === cycle ? 'var(--accent)' : 'transparent',
              color: billing === cycle ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {cycle === 'yearly' ? 'Yearly (Save ~37%)' : 'Monthly'}
          </button>
        ))}
      </div>

      {tiers.map((tier) => {
        const isCurrentTier = tier.name === currentTierName;
        const color = TIER_COLORS[tier.name] || 'var(--accent)';
        const tierKey = getTierKey(tier.name);
        const price = billing === 'yearly' ? tier.price_yearly : tier.price_monthly;
        const perMonth = billing === 'yearly' && tier.price_monthly > 0
          ? (tier.price_yearly / 12).toFixed(2)
          : null;

        return (
          <div
            key={tier.id}
            style={{
              border: `2px solid ${isCurrentTier ? color : 'var(--border)'}`,
              borderRadius: 12,
              padding: '20px',
              marginBottom: 12,
              background: isCurrentTier ? `${color}10` : 'var(--surface)',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color,
                      border: `1px solid ${color}`,
                      borderRadius: 999,
                      padding: '3px 8px',
                      fontWeight: 700,
                    }}
                  >
                    {TIER_BADGES[tier.name] || tier.name.toUpperCase()}
                  </span>
                  <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                    {tier.name}
                  </h2>
                  {isCurrentTier && (
                    <span
                      style={{
                        fontSize: 10,
                        background: color,
                        color: '#fff',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontWeight: 700,
                      }}
                    >
                      CURRENT
                    </span>
                  )}
                </div>
                {tier.max_family_members > 1 && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    Up to {tier.max_family_members} family members
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color }}>
                  {price === 0 ? 'Free' : `$${price}`}
                </div>
                {price > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {billing === 'yearly' ? `$${perMonth}/mo billed annually` : '/month'}
                  </div>
                )}
                {billing === 'yearly' && tier.savings_yearly > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--premium)', fontWeight: 700 }}>
                    Save ${tier.savings_yearly}/yr
                  </div>
                )}
              </div>
            </div>

            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
              {tier.features.map((feature, index) => (
                <li
                  key={index}
                  style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    padding: '3px 0',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span style={{ color }}>{'*'}</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            {!isCurrentTier && (
              <button
                onClick={() => handleUpgrade(tier.name)}
                disabled={upgrading === tierKey}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 14,
                  background: color,
                  color: '#fff',
                  opacity: upgrading ? 0.7 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {upgrading === tierKey
                  ? 'Switching...'
                  : !billingReady
                    ? tier.price_monthly === 0
                      ? 'Switch to Free'
                      : `Choose ${tier.name}`
                    : tier.price_monthly === 0
                    ? 'Switch to Free'
                    : `Upgrade to ${tier.name}`}
              </button>
            )}
          </div>
        );
      })}

      {message && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            textAlign: 'center',
            fontSize: 14,
            background: message.startsWith('Done:') ? 'var(--success-light)' : 'var(--error-light)',
            color: message.startsWith('Done:') ? 'var(--success)' : 'var(--error)',
            border: `1px solid ${message.startsWith('Done:') ? 'var(--success)' : 'var(--error)'}`,
            marginTop: 8,
          }}
        >
          {message}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 16 }}>
        All plans come with a 30-day satisfaction guarantee. Cancel anytime.
      </p>
    </div>
  );
}
