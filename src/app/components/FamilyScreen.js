'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import {
  addFamilyGoal,
  createFamily,
  fetchFamily,
  fetchSubscription,
  inviteToFamily,
  toggleFamilySafeScreen,
} from '../lib/api';

const PAGE_WIDTH = { padding: 'var(--space-base)', maxWidth: 520, margin: '0 auto' };

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
        gap: 6,
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

export default function FamilyScreen({ onBack }) {
  const [family, setFamily] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [newFamilyName, setNewFamilyName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [goalText, setGoalText] = useState('');
  const [goalTopics, setGoalTopics] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [familyData, subscriptionData] = await Promise.all([
        fetchFamily(),
        fetchSubscription(),
      ]);

      if (cancelled) {
        return;
      }

      setFamily(familyData && !familyData.error ? familyData : null);
      setSubscription(subscriptionData || null);
      if (!familyData && !subscriptionData) {
        setMessage('Sign in to manage Family. This screen will stay empty until the account is authenticated.');
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

  async function reloadFamily() {
    const familyData = await fetchFamily();
    setFamily(familyData && !familyData.error ? familyData : null);
  }

  async function handleCreate() {
    if (!newFamilyName.trim()) {
      showMessage('Enter a family name before creating the group.');
      return;
    }

    setCreating(true);
    const created = await createFamily(newFamilyName.trim());
    setCreating(false);

    if (!created || created.error) {
      showMessage(created?.error || 'Family could not be created right now.');
      return;
    }

    await reloadFamily();
    setNewFamilyName('');
    showMessage('Family group created.');
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      showMessage('Enter an email address to send an invite.');
      return;
    }

    const invited = await inviteToFamily(inviteEmail.trim());
    if (!invited || invited.error) {
      showMessage(invited?.error || 'Invite could not be sent right now.');
      return;
    }

    setInviteEmail('');
    await reloadFamily();
    showMessage('Invite sent.');
  }

  async function handleAddGoal() {
    if (!goalText.trim()) {
      showMessage('Enter a goal before saving.');
      return;
    }

    const topicTags = goalTopics
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const result = await addFamilyGoal(goalText.trim(), topicTags);

    if (!result || result.error) {
      showMessage(result?.error || 'Family goal could not be added right now.');
      return;
    }

    setGoalText('');
    setGoalTopics('');
    await reloadFamily();
    showMessage('Family goal added.');
  }

  async function handleToggleSafeScreen() {
    if (!family) {
      return;
    }

    const result = await toggleFamilySafeScreen(!family.safe_screen);
    if (!result || result.error) {
      showMessage(result?.error || 'Safe-screen mode could not be updated.');
      return;
    }

    setFamily((current) => current ? { ...current, safe_screen: !current.safe_screen } : current);
    showMessage(`Safe-screen ${family.safe_screen ? 'disabled' : 'enabled'}.`);
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        Loading family settings...
      </div>
    );
  }

  const isFamilyTier = String(subscription?.tier || '').toLowerCase() === 'family'
    || String(subscription?.tier_name || '').toLowerCase().includes('family');
  const hasFamily = Boolean(family?.id);

  return (
    <div className="page-enter" style={PAGE_WIDTH}>
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
              Family
            </h1>
            <StatusBadge status={hasFamily ? 'live' : isFamilyTier ? 'partial' : 'empty'}>
              {hasFamily ? 'Live' : isFamilyTier ? 'Partial / setup needed' : 'No live data yet'}
            </StatusBadge>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            Shared settings, goals, and safe-screen controls for a real family plan account.
          </p>
        </div>
      </div>

      {!isFamilyTier && (
        <Card style={{ marginBottom: 16 }}>
          <StatusBadge status="partial">Setup needed</StatusBadge>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '12px 0 8px' }}>
            Family features are not active on this account
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            Upgrade to the Family tier, then return here to create a shared group. eXplore will not fake members,
            goals, or a family feed before the subscription is real.
          </p>
        </Card>
      )}

      {isFamilyTier && !hasFamily && (
        <Card style={{ marginBottom: 16 }}>
          <StatusBadge status="partial">Setup needed</StatusBadge>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '12px 0 8px' }}>
            Create the family group
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
            The Family plan is active, but this account does not have a group yet. Once you create it, invites,
            goals, and safe-screen controls will appear here.
          </p>
          <input
            value={newFamilyName}
            onChange={(event) => setNewFamilyName(event.target.value)}
            placeholder="Family name"
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-elevated)',
              color: 'var(--text-primary)',
              fontSize: 14,
              marginBottom: 12,
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 10,
              border: 'none',
              background: 'var(--premium)',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {creating ? 'Creating...' : 'Create family group'}
          </button>
        </Card>
      )}

      {isFamilyTier && hasFamily && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  {family.name}
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '6px 0 0' }}>
                  {(family.members?.length || 1)} member{(family.members?.length || 1) === 1 ? '' : 's'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <StatusBadge status={family.safe_screen ? 'live' : 'partial'}>
                  {family.safe_screen ? 'Safe-screen active' : 'Safe-screen off'}
                </StatusBadge>
                <button
                  onClick={handleToggleSafeScreen}
                  style={{
                    marginTop: 10,
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {family.safe_screen ? 'Turn off filter' : 'Turn on filter'}
                </button>
              </div>
            </div>
          </Card>

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {['overview', 'members', 'goals'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: activeTab === tab ? '1px solid var(--text-primary)' : '1px solid var(--border)',
                  background: activeTab === tab ? 'var(--text-primary)' : 'transparent',
                  color: activeTab === tab ? 'var(--bg)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  textTransform: 'capitalize',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Card>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                  Safe-screen mode
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                  {family.safe_screen
                    ? 'This family currently filters high-clickbait items before they show up in the shared view.'
                    : 'The shared view is not filtered right now. Turn on safe-screen if you want a calmer, stricter feed for younger members.'}
                </p>
              </Card>
              <Card>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                  Feed status
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                  Family feed generation is only useful once invites and goals are real. eXplore keeps this screen visible,
                  but it will not invent a family feed before those inputs exist.
                </p>
              </Card>
            </div>
          )}

          {activeTab === 'members' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Card>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                  Members
                </h3>
                {(family.members || []).map((member) => (
                  <div
                    key={member.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 0',
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--text-primary)',
                        color: 'var(--bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {(member.name || member.email || '?')[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {member.name || member.email}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {member.role === 'owner' ? 'Owner' : 'Member'}
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
              <Card>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                  Invite a member
                </h3>
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="name@example.com"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-elevated)',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    marginBottom: 10,
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={handleInvite}
                  style={{
                    width: '100%',
                    padding: 12,
                    borderRadius: 10,
                    border: 'none',
                    background: 'var(--text-primary)',
                    color: 'var(--bg)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Send invite
                </button>
              </Card>
            </div>
          )}

          {activeTab === 'goals' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Card>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                  Shared goals
                </h3>
                {(family.goals || []).length === 0 ? (
                  <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                    No live goals have been saved yet. Add one below and it will be used for future shared recommendations.
                  </p>
                ) : (
                  (family.goals || []).map((goal) => (
                    <div
                      key={goal.id}
                      style={{
                        padding: '12px 0',
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {goal.goal_text}
                      </div>
                      {goal.topic_tags?.length ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {goal.topic_tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border)',
                                borderRadius: 999,
                                padding: '3px 8px',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </Card>
              <Card>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                  Add a goal
                </h3>
                <input
                  value={goalText}
                  onChange={(event) => setGoalText(event.target.value)}
                  placeholder="Example: healthier meals during the week"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-elevated)',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    marginBottom: 10,
                    boxSizing: 'border-box',
                  }}
                />
                <input
                  value={goalTopics}
                  onChange={(event) => setGoalTopics(event.target.value)}
                  placeholder="Optional topics, comma-separated"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-elevated)',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    marginBottom: 10,
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={handleAddGoal}
                  style={{
                    width: '100%',
                    padding: 12,
                    borderRadius: 10,
                    border: 'none',
                    background: 'var(--premium)',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Save goal
                </button>
              </Card>
            </div>
          )}
        </>
      )}

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
