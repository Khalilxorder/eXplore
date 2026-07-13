'use client';

import { useMemo, useState } from 'react';
import { normalizeStringList } from '../lib/intelligenceProfile';

const COMPANY_OPTIONS = [
  { id: 'anthropic', label: 'Anthropic / Claude' },
  { id: 'openai', label: 'OpenAI / ChatGPT' },
  { id: 'google', label: 'Gemini / DeepMind' },
  { id: 'xai', label: 'Grok / xAI' },
];

const SUMMARY_STYLE_OPTIONS = [
  {
    id: 'compact',
    label: 'Short and sharp',
    description: 'Fast headlines, plain language, almost no filler.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Short summaries with enough context to make decisions.',
  },
  {
    id: 'deep',
    label: 'Deeper context',
    description: 'More explanation when the shift really matters.',
  },
];

const URGENCY_OPTIONS = [
  {
    id: 'instant',
    label: 'Near release time',
    description: 'Surface the most important alerts as fast as possible.',
  },
  {
    id: 'important',
    label: 'Important only',
    description: 'Send only higher-signal updates worth interrupting me for.',
  },
  {
    id: 'digest',
    label: 'Digest feel',
    description: 'Keep the feed live, but avoid turning everything into an alert.',
  },
];

function buildLegacyTopicPayload({ focusAIReleases, focusRegionalRisk, aiCompanies, currentGoal }) {
  const selectedTopics = [];
  const selectedTopicNames = [];

  if (focusAIReleases) {
    selectedTopics.push('ai-releases');
    selectedTopicNames.push('AI releases');
  }

  if (focusRegionalRisk) {
    selectedTopics.push('regional-risk');
    selectedTopicNames.push('Iran / regional risk');
  }

  for (const companyKey of aiCompanies) {
    selectedTopics.push(`company-${companyKey}`);
    const option = COMPANY_OPTIONS.find((entry) => entry.id === companyKey);
    if (option?.label) {
      selectedTopicNames.push(option.label);
    }
  }

  if (currentGoal) {
    selectedTopics.push('current-goal');
    selectedTopicNames.push(currentGoal);
  }

  return { selectedTopics, selectedTopicNames };
}

function parseLineItems(value = '') {
  return normalizeStringList(
    String(value || '')
      .split(/\r?\n/g)
      .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
  );
}

export default function OnboardingScreen({ onComplete, onSkip }) {
  const [step, setStep] = useState(1);
  const [focusAIReleases, setFocusAIReleases] = useState(true);
  const [focusRegionalRisk, setFocusRegionalRisk] = useState(true);
  const [aiCompanies, setAiCompanies] = useState(['anthropic', 'openai', 'google', 'xai']);
  const [summaryStyle, setSummaryStyle] = useState('balanced');
  const [notificationUrgency, setNotificationUrgency] = useState('important');
  const [currentGoal, setCurrentGoal] = useState('');
  const [trustedChannel, setTrustedChannel] = useState('');
  const [peopleOfInterestText, setPeopleOfInterestText] = useState('Dario Amodei');
  const [finishing, setFinishing] = useState(false);

  const contentPref = summaryStyle === 'deep' ? 'long' : summaryStyle === 'compact' ? 'short' : 'both';

  const canContinueWatchStep = focusAIReleases || focusRegionalRisk;
  const canContinueGoalStep = true; // goal is optional — user can start without one
  const selectedPeople = useMemo(() => parseLineItems(peopleOfInterestText), [peopleOfInterestText]);
  const selectedCompanyLabels = useMemo(
    () => COMPANY_OPTIONS.filter((option) => aiCompanies.includes(option.id)).map((option) => option.label),
    [aiCompanies],
  );

  const toggleCompany = (companyId) => {
    setAiCompanies((current) => (
      current.includes(companyId)
        ? current.filter((entry) => entry !== companyId)
        : [...current, companyId]
    ));
  };

  const handleComplete = async () => {
    if (finishing) {
      return;
    }

    setFinishing(true);

    try {
      const legacyTopics = buildLegacyTopicPayload({
        focusAIReleases,
        focusRegionalRisk,
        aiCompanies,
        currentGoal: currentGoal.trim(),
      });

      await onComplete?.({
        ...legacyTopics,
        contentPref,
        trustedChannel: trustedChannel.trim(),
        peopleOfInterest: selectedPeople,
        focusAIReleases,
        focusRegionalRisk,
        aiCompanies,
        summaryStyle,
        notificationUrgency,
        currentGoal: currentGoal.trim(),
      });
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div
      className="page-enter"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-xl) var(--space-base)',
        background: 'var(--bg)',
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--space-tight)', marginBottom: 'var(--space-large)' }}>
        {[1, 2, 3].map((currentStep) => (
          <div
            key={currentStep}
            style={{
              flex: 1,
              height: '4px',
              borderRadius: 'var(--radius-sm)',
              background: currentStep <= step ? 'var(--accent)' : 'var(--border)',
              transition: 'background var(--duration-normal) var(--ease-out)',
            }}
          />
        ))}
      </div>

      <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-tight)' }}>
        Step {step} of 3
      </p>

      {step === 1 ? (
        <>
          <h1 style={{ font: 'var(--font-h1)', marginBottom: 'var(--space-tight)' }}>
            What should eXplore watch?
          </h1>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginBottom: 'var(--space-medium)' }}>
            Choose the lanes and official AI sources that should stay near the top.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', marginBottom: 'var(--space-medium)' }}>
            <button
              type="button"
              className="card"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: focusAIReleases ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: 'var(--surface)',
              }}
              onClick={() => setFocusAIReleases((current) => !current)}
            >
              <p style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>Official AI releases</p>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Anthropic, OpenAI, Gemini / DeepMind, and Grok / xAI launches.
              </p>
            </button>

            <button
              type="button"
              className="card"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: focusRegionalRisk ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: 'var(--surface)',
              }}
              onClick={() => setFocusRegionalRisk((current) => !current)}
            >
              <p style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>Iran / regional risk</p>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Higher-signal developments that change safety, access, travel, or energy risk.
              </p>
            </button>
          </div>

          {focusAIReleases ? (
            <div className="subtle-panel" style={{ marginBottom: 'var(--space-large)' }}>
              <div>
                <p style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>AI companies</p>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                  Pick the official sources that should stay near the top and power release alerts.
                </p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-tight)' }}>
                {COMPANY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`chip ${aiCompanies.includes(option.id) ? 'active' : ''}`}
                    onClick={() => toggleCompany(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 'var(--space-small)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onSkip?.()}
            >
              Skip for now
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!canContinueWatchStep}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </div>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginTop: 'var(--space-tight)', textAlign: 'center' }}>
            You can always refine this later in the <strong style={{ color: 'var(--accent)' }}>Rules</strong> tab.
          </p>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 style={{ font: 'var(--font-h1)', marginBottom: 'var(--space-tight)' }}>
            How should it feel?
          </h1>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginBottom: 'var(--space-medium)' }}>
            Set the tone for summaries and how aggressively the app should interrupt you.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-medium)', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
              {SUMMARY_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="card"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: summaryStyle === option.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: summaryStyle === option.id ? 'var(--accent-light)' : 'var(--surface)',
                  }}
                  onClick={() => setSummaryStyle(option.id)}
                >
                  <p style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>{option.label}</p>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>{option.description}</p>
                </button>
              ))}
            </div>

            <div className="subtle-panel">
              <div>
                <p style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>Notification urgency</p>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                  You can still fine-tune this later, but this gives the first setup the right tone.
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                {URGENCY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`chip ${notificationUrgency === option.id ? 'active' : ''}`}
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => setNotificationUrgency(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-small)', marginTop: 'var(--space-large)' }}>
            <button type="button" className="btn btn-ghost" onClick={() => onSkip?.()}>Skip for now</button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(3)}>
              Continue
            </button>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <h1 style={{ font: 'var(--font-h1)', marginBottom: 'var(--space-tight)' }}>
            What matters most right now?
          </h1>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginBottom: 'var(--space-medium)' }}>
            Give the app your current goal so it can sort signal by what actually matters to you now.
          </p>

          <div className="field-stack" style={{ marginBottom: 'var(--space-medium)' }}>
            <textarea
              className="text-surface"
              rows={4}
              placeholder="Example: Track the AI releases that actually change what I can use, and warn me fast about Iran-related risk that affects safety or access."
              value={currentGoal}
              onChange={(event) => setCurrentGoal(event.target.value)}
            />
            <input
              type="text"
              className="text-surface"
              placeholder="Optional trusted source or creator"
              value={trustedChannel}
              onChange={(event) => setTrustedChannel(event.target.value)}
            />
            <textarea
              className="text-surface"
              rows={4}
              placeholder={'People whose words or interviews matter to you\nExample:\nDario Amodei\nSam Altman'}
              value={peopleOfInterestText}
              onChange={(event) => setPeopleOfInterestText(event.target.value)}
            />
          </div>

          <div className="subtle-panel" style={{ marginBottom: 'var(--space-large)' }}>
            <div>
              <p style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>Your setup preview</p>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                This is the signal profile the app will start with.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-tight)' }}>
              {focusAIReleases ? <span className="chip active">AI releases</span> : null}
              {focusRegionalRisk ? <span className="chip active">Iran / regional risk</span> : null}
              <span className="chip active">{SUMMARY_STYLE_OPTIONS.find((option) => option.id === summaryStyle)?.label || 'Balanced'}</span>
              <span className="chip active">{URGENCY_OPTIONS.find((option) => option.id === notificationUrgency)?.label || 'Important only'}</span>
            </div>
            {selectedCompanyLabels.length ? (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Release watch: {selectedCompanyLabels.join(', ')}
              </p>
            ) : null}
            {selectedPeople.length ? (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                People of interest: {selectedPeople.slice(0, 4).join(', ')}
              </p>
            ) : null}
            {trustedChannel.trim() ? (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Trusted source: {trustedChannel.trim()}
              </p>
            ) : null}
            {currentGoal.trim() ? (
              <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
                Goal: {currentGoal.trim()}
              </p>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-small)' }}>
            <button type="button" className="btn btn-ghost" onClick={() => onSkip?.()}>Skip for now</button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>Back</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={handleComplete}
              disabled={finishing}
            >
              {finishing ? 'Saving your setup...' : 'Start Exploring'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
