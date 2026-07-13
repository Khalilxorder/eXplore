'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftIcon, BellIcon, SearchIcon, BookmarkIcon, CompassIcon, FileTextIcon, UserIcon, SettingsIcon } from './Icons';
import FinalInterpretationCard from './FinalInterpretationCard';
import TemplateScreen from './TemplateScreen';
import { useAuth } from './AuthProvider';
import { useTheme } from './ThemeProvider';
import {
  analyzeSelfData,
  deactivatePushToken,
  fetchHierarchyState,
  fetchModelPoolStatus,
  fetchNotificationPreferences,
  fetchNotificationStatus,
  fetchPreferences,
  fetchEventSourceMap,
  fetchSourcesStatus,
  fetchSystemReadiness,
  fetchTemplate,
  getApiBaseOverride,
  resolveApiBase,
  setApiBaseOverride,
  registerPushToken,
  updateHierarchyGoal,
  updateHierarchyStories,
  updateNotificationPreferences,
  updatePreferences,
  fetchProfileVariants,
  generateProfileVariant,
  saveProfileVariant,
  fetchAppMode,
  updateAppMode,
  fetchIntelligenceProfile,
  fetchUserTheory,
  pauseUserTheory,
  resumeUserTheory,
  resetUserTheory,
  exportUserTheory,
  fetchIntelligenceCorrections,
  fetchIntelligenceMultipliers,
  runPersonalIntelligenceCycle,
  fetchIntelligenceCycleStatus,
  addInterest,
  updateInterestWeight,
  addGoal,
  updateGoal,
  fetchMemories,
  proposeMemory,
  updateMemory,
  fetchMemoryQuestions,
  answerMemoryQuestion,
} from '../lib/api';
import { buildOperatingBrief } from '../lib/intelligenceProfile';
import { getNotificationState, requestNotificationAccess } from '../lib/notifications';
import {
  describePriorityRadarReleaseWatchMinImportance,
  PRIORITY_RADAR_SEEN_KEY,
  PRIORITY_RADAR_RELEASE_MIN_IMPORTANCE_OPTIONS,
  PRIORITY_RADAR_REFERENCE_POINTS,
  getPriorityRadarReleaseWatchMinImportance,
  getPriorityRadarReleaseWatchCompanies,
  getPriorityRadarReleaseWatchSummary,
  getPriorityRadarDirectNewsReason,
  getPriorityRadarDirectNewsSources,
  loadPriorityRadarSettings,
  runPriorityRadarCheck,
  savePriorityRadarSettings,
  syncPriorityRadarWithNative,
} from '../lib/alertRadar';
import {
  clearRememberedPushDevice,
  getPushNotificationState,
  loadRememberedPushDevice,
  registerDeviceForPush,
  rememberRegisteredPushDevice,
} from '../lib/pushNotifications';
import {
  buildVideoLibrarySearchProfiles,
  getVideoLibraryCategoryLabel,
  getVideoLibraryCreatorLabel,
  normalizeVideoLibraryPreferences,
} from '../data/videoLibrary';

function formatTimestamp(value) {
  if (!value) {
    return 'N/A';
  }

  try {
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

const STATUS_STYLES = {
  live: {
    label: 'Live',
    color: 'var(--success)',
    background: 'var(--success-light)',
  },
  partial: {
    label: 'Partial',
    color: 'var(--warning)',
    background: 'var(--warning-light)',
  },
  unavailable: {
    label: 'Unavailable',
    color: 'var(--error)',
    background: 'var(--error-light)',
  },
};

function uniqueDisplayItems(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
}

function renderPreferenceChips(items = [], { toneClass = '', emptyMessage = 'Nothing saved yet.' } = {}) {
  const normalizedItems = uniqueDisplayItems(items);

  if (!normalizedItems.length) {
    return (
      <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
        {emptyMessage}
      </span>
    );
  }

  return normalizedItems.map((item) => (
    <span key={item} className={`chip ${toneClass}`.trim()}>{item}</span>
  ));
}

function ProfileGroupCard({
  number,
  title,
  kicker,
  description,
  affects,
  wide = false,
  children,
}) {
  return (
    <div className={`profile-group ${wide ? 'profile-group--wide' : ''}`.trim()}>
      <div className="profile-group-header">
        <span className="profile-group-index">{number}</span>
        <div className="profile-group-copy">
          <div className="profile-group-title-row">
            <strong className="profile-group-title">{title}</strong>
            <span className="profile-group-kicker">{kicker}</span>
          </div>
          <p className="profile-group-description">{description}</p>
        </div>
      </div>
      {affects && (
        <p className="profile-group-affects">
          <strong>Affects:</strong> {affects}
        </p>
      )}
      {children}
    </div>
  );
}

function ProfileTextarea({ rows = 4, value, onChange, placeholder }) {
  return (
    <textarea
      className="text-surface profile-textarea"
      rows={rows}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  );
}

function normalizeTemplateFilterState(template = {}) {
  const workspace = template?.workspace && typeof template.workspace === 'object'
    ? template.workspace
    : template && typeof template === 'object'
      ? template
      : {};
  const workspaceMemory = workspace?.workspaceMemory && typeof workspace.workspaceMemory === 'object'
    ? workspace.workspaceMemory
    : {};

  return {
    connected: Boolean(template),
    operatingBrief: buildOperatingBrief(template || {}),
    videoLibrary: normalizeVideoLibraryPreferences(workspaceMemory.videoLibrary),
  };
}

function clampPreference(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, numeric));
}

function preferenceToPercent(value, fallback) {
  return Math.round(clampPreference(value, fallback) * 100);
}

function percentToPreference(value, fallback) {
  return clampPreference(Number(value) / 100, fallback);
}

function getStatusStyle(status) {
  return STATUS_STYLES[status] || STATUS_STYLES.unavailable;
}

const NOTIFICATION_READINESS_STYLES = {
  enabled: {
    label: 'Ready',
    color: 'var(--accent)',
    background: 'var(--accent-light)',
  },
  needs_permission: {
    label: 'Needs permission',
    color: 'var(--warning)',
    background: 'var(--warning-light)',
  },
  needs_registration: {
    label: 'Needs setup',
    color: 'var(--text-secondary)',
    background: 'var(--surface-elevated)',
  },
  backend_unavailable: {
    label: 'Backend offline',
    color: 'var(--error)',
    background: 'var(--error-light)',
  },
};

function getNotificationStatusStyle(statusKey) {
  return NOTIFICATION_READINESS_STYLES[statusKey] || NOTIFICATION_READINESS_STYLES.needs_registration;
}

function formatNotificationValue(value, fallback = 'Unknown') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeNotificationStatusValue(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function buildNotificationReadinessSummary({
  backendStatus = null,
  notificationState = {},
  pushState = {},
  systemReadiness = null,
  alertsEnabled = false,
  rememberedDevice = null,
} = {}) {
  const rawBackendStatus = normalizeNotificationStatusValue(
    backendStatus?.normalized_status
      || backendStatus?.status
      || backendStatus?.backend_state
      || ''
  );
  const backendReachable = backendStatus
    ? backendStatus.backend_reachable !== false && rawBackendStatus !== 'backend_unavailable'
    : systemReadiness
      ? systemReadiness.runtime?.status !== 'unavailable'
      : true;
  const backendStatusLabel = formatNotificationValue(
    backendStatus?.status_label
      || backendStatus?.backend_state
      || (rawBackendStatus ? rawBackendStatus.replace(/_/g, ' ') : '')
      || (backendReachable ? 'live' : 'backend unavailable')
  );
  const localPermission = normalizeNotificationStatusValue(
    notificationState?.permission
      || pushState?.permission
      || backendStatus?.permission_state
      || 'default'
  );
  const localSupported = notificationState.supported !== false || pushState.supported !== false;
  const tokenPresent = Boolean(
    backendStatus?.push_token_present
      || backendStatus?.token_present
      || backendStatus?.token_state === 'present'
      || backendStatus?.token_state === 'registered'
      || backendStatus?.registration_state === 'registered'
      || pushState?.token
      || rememberedDevice?.token
  );
  const registered = Boolean(
    backendStatus?.push_registered
      || backendStatus?.registration_state === 'registered'
      || backendStatus?.registration_state === 'active'
      || backendStatus?.push_sendable
  );
  const lastSuccessfulDeliveryAt = formatNotificationValue(
    backendStatus?.last_successful_delivery_at
      || backendStatus?.last_delivery_at
      || backendStatus?.last_success_at
      || systemReadiness?.push?.last_successful_delivery_at
      || systemReadiness?.push?.last_delivery_at
      || systemReadiness?.push?.last_success_at,
    ''
  );

  let key = 'needs_registration';
  let label = NOTIFICATION_READINESS_STYLES.needs_registration.label;
  let description = 'Tap Enable high-priority alerts to finish setup on this phone.';

  if (!backendReachable) {
    key = 'backend_unavailable';
    label = NOTIFICATION_READINESS_STYLES.backend_unavailable.label;
    description = 'The backend is offline, so alerts cannot finish setup right now.';
  } else if (localPermission === 'denied') {
    key = 'needs_permission';
    label = NOTIFICATION_READINESS_STYLES.needs_permission.label;
    description = 'Allow notification permission on this phone to receive alerts.';
  } else if (localPermission !== 'granted') {
    key = 'needs_permission';
    label = NOTIFICATION_READINESS_STYLES.needs_permission.label;
    description = 'Tap Enable high-priority alerts so the app can ask for permission.';
  } else if (!alertsEnabled || (!registered && !tokenPresent)) {
    key = 'needs_registration';
    label = NOTIFICATION_READINESS_STYLES.needs_registration.label;
    description = 'This phone still needs setup before alerts can arrive.';
  } else if (!localSupported && (notificationState.isNative || pushState.isNative)) {
    key = 'backend_unavailable';
    label = NOTIFICATION_READINESS_STYLES.backend_unavailable.label;
    description = 'This phone build does not expose notification support right now.';
  } else {
    key = 'enabled';
    label = NOTIFICATION_READINESS_STYLES.enabled.label;
    description = registered
      ? 'High-priority alerts are ready on this phone.'
      : 'This phone is ready. Backend sync is still catching up.';
  }

  const backendTruthLine = formatNotificationValue(
    backendStatus?.normalized_status
      || backendStatus?.status
      || backendStatus?.status_label
      || (backendReachable ? 'live' : 'backend_unavailable')
  );

  return {
    key,
    label,
    description,
    evidence: [
      { label: 'Backend', value: backendTruthLine },
      { label: 'Permission', value: localPermission },
      { label: 'Token', value: tokenPresent ? 'saved' : 'missing' },
      { label: 'Setup', value: registered ? 'ready' : 'syncing' },
      {
        label: 'Can send',
        value: backendStatus?.push_sendable !== false && alertsEnabled && localPermission === 'granted' && backendReachable ? 'yes' : 'no',
      },
    ],
    backendReachable,
    lastSuccessfulDeliveryAt,
  };
}

function describeBackendReachability(apiBase, isNative) {
  if (!apiBase) {
    return { kind: 'unknown', message: '' };
  }

  try {
    const normalizedUrl = typeof apiBase === 'string' ? apiBase.replace(/\\/g, '/') : apiBase;
    const parsed = new URL(normalizedUrl);
    const host = String(parsed.hostname || '').toLowerCase();
    const isPrivateIp = /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      || host === 'localhost'
      || host === '127.0.0.1';

    if (isNative && isPrivateIp) {
      return {
        kind: 'local',
        message: 'This phone build is using a local PC backend. Keep the PC backend running and keep the phone on the same network.',
      };
    }

    if (isPrivateIp) {
      return {
        kind: 'local',
        message: 'This build is using a local backend on your network.',
      };
    }

    return {
      kind: 'hosted',
      message: 'This build is using a hosted backend URL.',
    };
  } catch {
    return { kind: 'unknown', message: '' };
  }
}

function normalizeRemoteReleaseWatchCompany(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'gemini' || normalized === 'google') {
    return 'google';
  }

  if (normalized === 'grok' || normalized === 'xai') {
    return 'xai';
  }

  return normalized;
}

function buildRemoteReleaseWatchPayload(settings, options = {}) {
  const payload = {
    ai_release_watch_enabled: settings.releaseWatch?.enabled !== false,
    ai_release_watch_companies: getPriorityRadarReleaseWatchCompanies(settings).map((company) => company.key),
    direct_news_watch_enabled: settings.directNewsWatch?.enabled !== false,
    direct_news_watch_sources: getPriorityRadarDirectNewsSources(settings).map((source) => source.key),
    direct_news_watch_reason: getPriorityRadarDirectNewsReason(settings),
  };

  if (options.includeMinImportance !== false) {
    payload.ai_release_watch_min_importance = getPriorityRadarReleaseWatchMinImportance(settings);
  }

  return payload;
}

function mergeRemotePreferencesIntoRadarSettings(localRadarSettings, remotePreferences) {
  const remoteCompanySet = new Set(
    Array.isArray(remotePreferences?.ai_release_watch_companies)
      ? remotePreferences.ai_release_watch_companies.map(normalizeRemoteReleaseWatchCompany).filter(Boolean)
      : []
  );
  const localCompanies = localRadarSettings.releaseWatch?.companies || {};
  const remoteDirectNewsSourceSet = new Set(
    Array.isArray(remotePreferences?.direct_news_watch_sources)
      ? remotePreferences.direct_news_watch_sources.map(normalizeRemoteReleaseWatchCompany).filter(Boolean)
      : []
  );
  const localDirectNewsSources = localRadarSettings.directNewsWatch?.sources || {};

  return {
    ...localRadarSettings,
    enabled: Boolean(remotePreferences?.alerts_enabled),
    categories: {
      ai: remotePreferences?.ai_enabled !== false,
      geo: remotePreferences?.geo_enabled !== false,
    },
    releaseWatch: {
      ...localRadarSettings.releaseWatch,
      enabled: remotePreferences?.ai_release_watch_enabled !== false,
      minImportance: remotePreferences?.ai_release_watch_min_importance || localRadarSettings.releaseWatch?.minImportance || 'major',
      companies: Object.fromEntries(
        Object.keys(localCompanies).map((companyKey) => ([
          companyKey,
          remoteCompanySet.size ? remoteCompanySet.has(companyKey) : localCompanies[companyKey] !== false,
        ]))
      ),
    },
    directNewsWatch: {
      ...localRadarSettings.directNewsWatch,
      enabled: remotePreferences?.direct_news_watch_enabled !== false,
      reason: remotePreferences?.direct_news_watch_reason || localRadarSettings.directNewsWatch?.reason,
      sources: Object.fromEntries(
        Object.keys(localDirectNewsSources).map((sourceKey) => ([
          sourceKey,
          remoteDirectNewsSourceSet.size
            ? remoteDirectNewsSourceSet.has(sourceKey)
            : localDirectNewsSources[sourceKey] === true,
        ]))
      ),
    },
  };
}

export default function PreferencesScreen({ onBack, onNavigate }) {
  const { user, signOut, isAdmin } = useAuth();
  const { themePreference, setThemePreference } = useTheme();
  const [activeAccordion, setActiveAccordion] = useState(null);
  const defaultBackendUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const resolvedBackendUrl = resolveApiBase();
  const [apiBaseInput, setApiBaseInput] = useState('');
  const [apiMessage, setApiMessage] = useState('');
  const [notificationState, setNotificationState] = useState({
    supported: false,
    permission: 'default',
    platform: 'web',
    isNative: false,
    canSchedule: false,
  });
  const [notificationStatus, setNotificationStatus] = useState(null);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [radarSettings, setRadarSettings] = useState(loadPriorityRadarSettings());
  const [radarCapabilities, setRadarCapabilities] = useState({
    syncedReleaseWatchMinImportance: false,
  });
  const [radarMessage, setRadarMessage] = useState('');
  const [radarBusy, setRadarBusy] = useState(false);
  const [pushState, setPushState] = useState({
    supported: false,
    permission: 'default',
    platform: 'web',
    isNative: false,
    canRegister: false,
  });
  const [systemReadiness, setSystemReadiness] = useState(null);
  const [modelPoolStatus, setModelPoolStatus] = useState(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState('');
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [sourceSummary, setSourceSummary] = useState({
    total: 0,
    configured: 0,
    partial: 0,
  });
  const [eventSourceMap, setEventSourceMap] = useState(null);
  const [contentPrefs, setContentPrefs] = useState({
    depth_pref: 0.7,
    rarity_pref: 0.6,
    length_pref: 0.5,
    interests: [],
  });
  const [templateFilterState, setTemplateFilterState] = useState({
    loaded: false,
    ...normalizeTemplateFilterState(null),
  });
  const [hierarchyState, setHierarchyState] = useState(null);
  const [hierarchyGoalDraft, setHierarchyGoalDraft] = useState('');
  const [storyHighestOrderDraft, setStoryHighestOrderDraft] = useState('');
  const [storyYoursDraft, setStoryYoursDraft] = useState('');
  const [storySubStoriesDraft, setStorySubStoriesDraft] = useState('');
  const [selfRawDataDraft, setSelfRawDataDraft] = useState('');
  const [scientificProfile, setScientificProfile] = useState(null);
  const [selfAnalysisBusy, setSelfAnalysisBusy] = useState(false);
  const [selfAnalysisMessage, setSelfAnalysisMessage] = useState('');
  const [hierarchyBusy, setHierarchyBusy] = useState(false);
  const [hierarchyMessage, setHierarchyMessage] = useState('');
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [showAdvancedAlerts, setShowAdvancedAlerts] = useState(false);
  const [variants, setVariants] = useState([]);
  const [generatingVariants, setGeneratingVariants] = useState({});
  const [variantMessage, setVariantMessage] = useState('');
  const [showSetupLinks, setShowSetupLinks] = useState(false);
  const [showAdvancedConnection, setShowAdvancedConnection] = useState(false);
  const [deviceResetBusy, setDeviceResetBusy] = useState(false);

  const [appMode, setAppMode] = useState('average');
  const [modeBusy, setModeBusy] = useState(false);
  const [userTheory, setUserTheory] = useState(null);
  const [theoryBusy, setTheoryBusy] = useState(false);
  const [theoryMessage, setTheoryMessage] = useState('');
  const [theoryCorrections, setTheoryCorrections] = useState([]);
  const [theoryMultipliers, setTheoryMultipliers] = useState([]);
  const [cycleStatus, setCycleStatus] = useState(null);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [cycleMessage, setCycleMessage] = useState('');

  // ── Three-Tier Notification Rules State & Handlers ──────────────────
  const [threeTierRules, setThreeTierRules] = useState([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    topic: '',
    sources: '',
    triggerWords: '',
    negativeFilters: '',
    freshnessWindow: '24 hours',
    priority: 'Important',
    reason: '',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('explore-three-tier-rules');
    if (stored) {
      try {
        setThreeTierRules(JSON.parse(stored));
      } catch (e) {
        console.error(e);
      }
    } else {
      const defaultRules = [
        {
          id: 'rule-king-abdullah',
          topic: 'King Abdullah Schools Admissions',
          sources: 'MOE, Facebook Official',
          triggerWords: 'applications, 2026, 2027, admission, registration',
          negativeFilters: '2025, 2024, archive, old',
          freshnessWindow: '24 hours',
          priority: 'Direct',
          reason: 'Monitor applications for King Abdullah II Schools of Excellence',
          lastChecked: new Date().toISOString(),
        },
        {
          id: 'rule-ai-releases',
          topic: 'Frontier AI Model Releases',
          sources: 'OpenAI, Anthropic, Google, xAI',
          triggerWords: 'GPT-5, Claude 4, Gemini 2, Grok 3, release, launch',
          negativeFilters: 'rumor, leak, speculation',
          freshnessWindow: '12 hours',
          priority: 'Important',
          reason: 'Track official releases of frontier AI models',
          lastChecked: new Date().toISOString(),
        }
      ];
      setThreeTierRules(defaultRules);
      localStorage.setItem('explore-three-tier-rules', JSON.stringify(defaultRules));
    }
  }, []);

  const saveRules = (newRules) => {
    setThreeTierRules(newRules);
    if (typeof window !== 'undefined') {
      localStorage.setItem('explore-three-tier-rules', JSON.stringify(newRules));
    }
  };

  const handleAddRuleClick = () => {
    setEditingRuleId(null);
    setRuleForm({
      topic: '',
      sources: '',
      triggerWords: '',
      negativeFilters: '',
      freshnessWindow: '24 hours',
      priority: 'Important',
      reason: '',
    });
    setShowRuleForm(true);
  };

  const handleEditRuleClick = (rule) => {
    setEditingRuleId(rule.id);
    setRuleForm({
      topic: rule.topic,
      sources: rule.sources,
      triggerWords: rule.triggerWords,
      negativeFilters: rule.negativeFilters,
      freshnessWindow: rule.freshnessWindow,
      priority: rule.priority,
      reason: rule.reason,
    });
    setShowRuleForm(true);
  };

  const handleDeleteRule = (id) => {
    const nextRules = threeTierRules.filter((r) => r.id !== id);
    saveRules(nextRules);
  };

  const handleSaveRule = (e) => {
    e.preventDefault();
    if (!ruleForm.topic.trim()) return;

    let nextRules;
    if (editingRuleId) {
      nextRules = threeTierRules.map((r) =>
        r.id === editingRuleId
          ? {
              ...r,
              topic: ruleForm.topic.trim(),
              sources: ruleForm.sources.trim(),
              triggerWords: ruleForm.triggerWords.trim(),
              negativeFilters: ruleForm.negativeFilters.trim(),
              freshnessWindow: ruleForm.freshnessWindow,
              priority: ruleForm.priority,
              reason: ruleForm.reason.trim(),
              lastChecked: new Date().toISOString(),
            }
          : r
      );
    } else {
      const newRule = {
        id: `rule-${Date.now()}`,
        topic: ruleForm.topic.trim(),
        sources: ruleForm.sources.trim(),
        triggerWords: ruleForm.triggerWords.trim(),
        negativeFilters: ruleForm.negativeFilters.trim(),
        freshnessWindow: ruleForm.freshnessWindow,
        priority: ruleForm.priority,
        reason: ruleForm.reason.trim(),
        lastChecked: new Date().toISOString(),
      };
      nextRules = [...threeTierRules, newRule];
    }

    saveRules(nextRules);
    setShowRuleForm(false);
    setEditingRuleId(null);
  };

  // ── Personal Intelligence Engine ────────────────────────────────────
  const [intelligenceProfile, setIntelligenceProfile] = useState(null);
  const [intLoading, setIntLoading] = useState(false);
  const [intMessage, setIntMessage] = useState('');
  const [newInterest, setNewInterest] = useState('');
  const [newGoalText, setNewGoalText] = useState('');
  const [newGoalPriority, setNewGoalPriority] = useState('medium');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [memoryQuestions, setMemoryQuestions] = useState([]);
  const [memAnswers, setMemAnswers] = useState({});

  const handleModeChange = async (newMode) => {
    if (newMode === appMode || modeBusy) return;
    setModeBusy(true);
    try {
      const res = await updateAppMode(newMode);
      if (res && res.success && res.mode) {
        setAppMode(res.mode);
        const hierarchy = await fetchHierarchyState();
        if (hierarchy?.hierarchy) {
          setHierarchyState(hierarchy.hierarchy);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setModeBusy(false);
    }
  };

  const handleGenerateVariant = async (kind) => {
    setGeneratingVariants((prev) => ({ ...prev, [kind]: true }));
    setVariantMessage('');
    try {
      const res = await generateProfileVariant(kind);
      if (res && res.success && res.variant) {
        const saveRes = await saveProfileVariant(kind, `${kind.charAt(0).toUpperCase() + kind.slice(1)} Variant`, res.variant);
        if (saveRes && saveRes.success) {
          setVariantMessage(`${kind.charAt(0).toUpperCase() + kind.slice(1)} profile variant refreshed!`);
          const listRes = await fetchProfileVariants();
          if (listRes && listRes.success) {
            setVariants(listRes.variants || []);
          }
        } else {
          setVariantMessage(`Generated, but failed to save: ${saveRes?.error || 'Unknown error'}`);
        }
      } else {
        setVariantMessage(`Failed to generate: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      setVariantMessage(err.message || 'An error occurred.');
    } finally {
      setGeneratingVariants((prev) => ({ ...prev, [kind]: false }));
    }
  };

  const refreshDiagnostics = async () => {
    setDiagnosticsBusy(true);
    setDiagnosticsMessage('');

    try {
      const [readiness, sources, modelPool] = await Promise.all([
        fetchSystemReadiness(),
        fetchSourcesStatus(),
        fetchModelPoolStatus().catch(() => null),
      ]);

      if (readiness) {
        setSystemReadiness(readiness);
      } else {
        setDiagnosticsMessage('Could not reach the backend diagnostics endpoint.');
      }

      if (sources?.summary) {
        setSourceSummary(sources.summary);
      }

      if (modelPool) {
        setModelPoolStatus(modelPool);
      }
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    setApiBaseInput(getApiBaseOverride());

    void (async () => {
      const [state, nextPushState, backendStatus, readiness, sources, template, sourceMap, modelPool] = await Promise.all([
        getNotificationState(),
        getPushNotificationState(),
        fetchNotificationStatus().catch(() => null),
        fetchSystemReadiness(),
        fetchSourcesStatus(),
        fetchTemplate().catch(() => null),
        fetchEventSourceMap().catch(() => null),
        fetchModelPoolStatus().catch(() => null),
      ]);

      if (!cancelled) {
        setNotificationState(state);
        setPushState(nextPushState);
        setNotificationStatus(backendStatus);
        setRadarSettings(loadPriorityRadarSettings());
        setRadarCapabilities({
          syncedReleaseWatchMinImportance: false,
        });
        setSystemReadiness(readiness || null);
        setModelPoolStatus(modelPool || null);
        setSourceSummary(
          sources?.summary || {
            total: 0,
            configured: 0,
            partial: 0,
          },
        );
        setTemplateFilterState({
          loaded: true,
          ...normalizeTemplateFilterState(template),
        });
        setEventSourceMap(sourceMap?.sourceMap || null);
      }

      if (user && !cancelled) {
        const [remotePreferences, preferences, hierarchy, variantsRes] = await Promise.all([
          fetchNotificationPreferences(),
          fetchPreferences(),
          fetchHierarchyState(),
          fetchProfileVariants().catch(() => null),
        ]);

        if (remotePreferences) {
          const syncedReleaseWatchMinImportance = Object.prototype.hasOwnProperty.call(
            remotePreferences,
            'ai_release_watch_min_importance',
          );
          const localRadarSettings = loadPriorityRadarSettings();
          const mergedSettings = mergeRemotePreferencesIntoRadarSettings(localRadarSettings, remotePreferences);

          if (!cancelled) {
            setRadarSettings(mergedSettings);
            setRadarCapabilities({
              syncedReleaseWatchMinImportance,
            });
          }

          await savePriorityRadarSettings(mergedSettings);
        }

        if (preferences && !cancelled) {
          setContentPrefs({
            depth_pref: clampPreference(preferences.depth_pref, 0.7),
            rarity_pref: clampPreference(preferences.rarity_pref, 0.6),
            length_pref: clampPreference(preferences.length_pref, 0.5),
            interests: Array.isArray(preferences.interests) ? preferences.interests : [],
          });
        }

        if (hierarchy?.hierarchy && !cancelled) {
          setHierarchyState(hierarchy.hierarchy);
          setHierarchyGoalDraft(hierarchy.hierarchy.currentGoal || '');
          setStoryHighestOrderDraft(hierarchy.hierarchy.storyHighestOrder || '');
          setStoryYoursDraft(hierarchy.hierarchy.storyYours || '');
          setStorySubStoriesDraft(hierarchy.hierarchy.storySubStories || '');
          setSelfRawDataDraft(hierarchy.hierarchy.selfRawData || '');
          setScientificProfile(hierarchy.hierarchy.scientificProfile || null);
          setAppMode(hierarchy.hierarchy.appMode || 'average');
        }

        if (variantsRes && variantsRes.success && !cancelled) {
          setVariants(variantsRes.variants || []);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load intelligence profile whenever screen mounts
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [profile, questions] = await Promise.all([
          fetchIntelligenceProfile().catch(() => null),
          fetchMemoryQuestions().catch(() => []),
        ]);
        if (!active) return;
        if (profile) setIntelligenceProfile(profile);
        if (Array.isArray(questions?.questions)) setMemoryQuestions(questions.questions);
        else if (Array.isArray(questions)) setMemoryQuestions(questions);
      } catch { /* silent */ }
    })();
    return () => { active = false; };
  }, []);

  const handleAddInterest = async () => {
    const name = newInterest.trim();
    if (!name) return;
    setIntLoading(true); setIntMessage('');
    try {
      await addInterest(name, 1.0);
      setNewInterest('');
      const profile = await fetchIntelligenceProfile();
      if (profile) setIntelligenceProfile(profile);
      setIntMessage('Interest added.');
    } catch (e) {
      setIntMessage(e.message || 'Error adding interest.');
    } finally { setIntLoading(false); }
  };

  const handleAddGoal = async () => {
    const text = newGoalText.trim();
    if (!text) return;
    setIntLoading(true); setIntMessage('');
    try {
      await addGoal(text, newGoalPriority);
      setNewGoalText('');
      const profile = await fetchIntelligenceProfile();
      if (profile) setIntelligenceProfile(profile);
      setIntMessage('Goal added.');
    } catch (e) {
      setIntMessage(e.message || 'Error adding goal.');
    } finally { setIntLoading(false); }
  };

  const handleProposeMemory = async () => {
    const text = newMemoryText.trim();
    if (!text) return;
    setIntLoading(true); setIntMessage('');
    try {
      await proposeMemory(text, 0.7);
      setNewMemoryText('');
      setIntMessage('Memory proposed.');
    } catch (e) {
      setIntMessage(e.message || 'Error proposing memory.');
    } finally { setIntLoading(false); }
  };

  const handleAnswerQuestion = async (questionId) => {
    const text = (memAnswers[questionId] || '').trim();
    if (!text) return;
    setIntLoading(true); setIntMessage('');
    try {
      await answerMemoryQuestion(questionId, text);
      setMemAnswers((prev) => ({ ...prev, [questionId]: '' }));
      const questions = await fetchMemoryQuestions().catch(() => null);
      if (questions?.questions) setMemoryQuestions(questions.questions);
      else if (Array.isArray(questions)) setMemoryQuestions(questions);
      setIntMessage('Answer saved.');
    } catch (e) {
      setIntMessage(e.message || 'Error saving answer.');
    } finally { setIntLoading(false); }
  };

  const runNotificationAction = async (action) => {
    setNotificationBusy(true);
    setNotificationMessage('');

    try {
      const result = await action();
      const nextNotificationState = result?.state || await getNotificationState();
      const nextPushState = result?.pushState || await getPushNotificationState();
      const nextNotificationStatus = await fetchNotificationStatus().catch(() => null);
      setNotificationState(nextNotificationState);
      setPushState(nextPushState);
      setNotificationStatus(nextNotificationStatus);
      setNotificationMessage(result?.message || '');
    } finally {
      setNotificationBusy(false);
    }
  };

  const runRadarAction = async (action) => {
    setRadarBusy(true);
    setRadarMessage('');

    try {
      const result = await action();
      const nextNotificationState = result?.state || await getNotificationState();
      const nextPushState = result?.pushState || await getPushNotificationState();
      const nextNotificationStatus = await fetchNotificationStatus().catch(() => null);
      setNotificationState(nextNotificationState);
      setPushState(nextPushState);
      setNotificationStatus(nextNotificationStatus);

      if (result?.settings) {
        setRadarSettings(result.settings);
      } else {
        setRadarSettings(loadPriorityRadarSettings());
      }

      if (result?.message) {
        setRadarMessage(result.message);
      }

      await refreshDiagnostics();
    } finally {
      setRadarBusy(false);
    }
  };

  const saveApiOverride = async () => {
    setApiBaseOverride(apiBaseInput);
    await syncPriorityRadarWithNative(radarSettings);
    await refreshDiagnostics();

    if (apiBaseInput.trim()) {
      setApiMessage(`Backend saved: ${apiBaseInput.trim()}`);
      return;
    }

    setApiMessage('Automatic backend detection restored.');
  };

  const resetApiOverride = async () => {
    setApiBaseInput('');
    setApiBaseOverride('');
    await syncPriorityRadarWithNative(radarSettings);
    await refreshDiagnostics();
    setApiMessage('Automatic backend detection restored.');
  };

  const resetLocalCache = async () => {
    setDeviceResetBusy(true);
    setApiMessage('');

    try {
      setApiBaseInput('');
      setApiBaseOverride('');

      if (typeof window !== 'undefined') {
        [
          PRIORITY_RADAR_SEEN_KEY,
          'explore-api-base',
          'explore-feed-cache',
          'explore-last-build-id',
          'explore-budapest-ambient-v1',
        ].forEach((key) => localStorage.removeItem(key));
        Object.keys(localStorage)
          .filter((key) => key.startsWith('explore-build-refresh:'))
          .forEach((key) => localStorage.removeItem(key));

        sessionStorage.removeItem('explore-weather-cache');

        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
        }

        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
        }
      }

      await syncPriorityRadarWithNative(radarSettings);
      await refreshDiagnostics();
      setApiMessage('Local cache cleared. Refresh eXplore if anything still looks old.');
    } finally {
      setDeviceResetBusy(false);
    }
  };

  const enablePriorityRadar = async () => {
    const isNativeAlerts = Boolean(notificationState.isNative);
    const notificationResult = isNativeAlerts
      ? await registerDeviceForPush()
      : await requestNotificationAccess();
    const settings = await savePriorityRadarSettings({
      ...radarSettings,
      enabled: true,
    });

    let pushRegistrationOk = false;

    if (notificationResult?.ok && notificationResult?.token) {
      const registeredDevice = {
        token: notificationResult.token,
        device_id: notificationResult.device_id || '',
        app_version: notificationResult.app_version || '',
        platform: notificationResult.platform || notificationState.platform || 'web',
      };

      rememberRegisteredPushDevice(registeredDevice);

      if (isNativeAlerts) {
        try {
          const deviceResult = await registerPushToken(registeredDevice);
          pushRegistrationOk = Boolean(deviceResult?.success);
          if (!pushRegistrationOk) {
            clearRememberedPushDevice();
          }
        } catch {
          pushRegistrationOk = false;
          clearRememberedPushDevice();
        }
      }
    }

    if (user) {
      const currentPreferences = await fetchNotificationPreferences();
      await updateNotificationPreferences({
        alerts_enabled: true,
        ai_enabled: settings.categories.ai,
        geo_enabled: settings.categories.geo,
        push_enabled: isNativeAlerts ? pushRegistrationOk : currentPreferences?.push_enabled === true,
        local_fallback_enabled: true,
        ...buildRemoteReleaseWatchPayload(settings, {
          includeMinImportance: radarCapabilities.syncedReleaseWatchMinImportance,
        }),
      });
    }

    const result = await runPriorityRadarCheck({ requestPermission: false, force: true });
    const pushState = await getPushNotificationState();
    const baseMessage = isNativeAlerts
      ? user
        ? 'High-priority alerts are on. This phone is finishing setup in the background.'
        : 'High-priority alerts are on for this phone.'
      : user
        ? 'High-priority alerts are on.'
        : 'High-priority alerts are on in this browser.';

    return {
      ...result,
      state: result.state || notificationResult,
      pushState,
      settings,
      message: notificationResult.permission === 'granted'
        ? (result.ok
          ? (isNativeAlerts && !pushRegistrationOk
            ? `${baseMessage} Backend sync is still catching up.`
            : baseMessage)
          : `${baseMessage} No new high-priority alerts were ready right now.`)
        : `${baseMessage} Alerts stay silent until you allow notifications in system settings.`,
    };
  };

  const disablePriorityRadar = async () => {
    const settings = await savePriorityRadarSettings({
      ...radarSettings,
      enabled: false,
    });

    if (user) {
      await updateNotificationPreferences({
        alerts_enabled: false,
        push_enabled: false,
        local_fallback_enabled: false,
        ...buildRemoteReleaseWatchPayload(settings, {
          includeMinImportance: radarCapabilities.syncedReleaseWatchMinImportance,
        }),
      });

      const rememberedDevice = loadRememberedPushDevice();
      if (rememberedDevice?.token || rememberedDevice?.device_id) {
        await deactivatePushToken({
          token: rememberedDevice.token,
          device_id: rememberedDevice.device_id,
        });
        clearRememberedPushDevice();
      }
    }

    return {
      ok: true,
      settings,
      message: 'High-priority alerts are off.',
    };
  };

  const checkPriorityRadarNow = async () => {
    return runPriorityRadarCheck({
      requestPermission: true,
      force: true,
    });
  };

  const toggleRadarCategory = async (categoryKey) => {
    const nextCategories = {
      ...radarSettings.categories,
      [categoryKey]: !radarSettings.categories[categoryKey],
    };

    if (!nextCategories.ai && !nextCategories.geo) {
      setRadarMessage('Keep at least one alert type on.');
      return;
    }

    setRadarBusy(true);
    setRadarMessage('');

    try {
      const settings = await savePriorityRadarSettings({
        ...radarSettings,
        categories: nextCategories,
      });

      setRadarSettings(settings);

      if (user) {
        const currentPreferences = await fetchNotificationPreferences();
        await updateNotificationPreferences({
          alerts_enabled: settings.enabled,
          ai_enabled: settings.categories.ai,
          geo_enabled: settings.categories.geo,
          push_enabled: currentPreferences?.push_enabled === true,
          local_fallback_enabled: settings.enabled,
          ...buildRemoteReleaseWatchPayload(settings, {
            includeMinImportance: radarCapabilities.syncedReleaseWatchMinImportance,
          }),
        });
      }

      setRadarMessage(
        categoryKey === 'ai'
          ? `AI launch alerts ${settings.categories.ai ? 'enabled' : 'muted'} and saved.`
          : `Iran/Qatar alerts ${settings.categories.geo ? 'enabled' : 'muted'} and saved.`
      );

      await refreshDiagnostics();
    } finally {
      setRadarBusy(false);
    }
  };

  const updateRadarReleaseWatch = async (nextReleaseWatch) => {
    setRadarBusy(true);
    setRadarMessage('');

    try {
      const settings = await savePriorityRadarSettings({
        ...radarSettings,
        releaseWatch: nextReleaseWatch,
      });

      setRadarSettings(settings);

      if (user) {
        const currentPreferences = await fetchNotificationPreferences();
        await updateNotificationPreferences({
          alerts_enabled: settings.enabled,
          ai_enabled: settings.categories.ai,
          geo_enabled: settings.categories.geo,
          push_enabled: currentPreferences?.push_enabled === true,
          local_fallback_enabled: settings.enabled,
          ...buildRemoteReleaseWatchPayload(settings, {
            includeMinImportance: radarCapabilities.syncedReleaseWatchMinImportance,
          }),
        });
      }

      setRadarMessage(
        settings.releaseWatch.enabled
          ? `Release watch is on for ${getPriorityRadarReleaseWatchSummary(settings)}. ${describePriorityRadarReleaseWatchMinImportance(getPriorityRadarReleaseWatchMinImportance(settings))}`
          : 'Release watch is off.'
      );

      await refreshDiagnostics();
    } finally {
      setRadarBusy(false);
    }
  };

  const toggleReleaseWatchEnabled = async () => {
    const nextReleaseWatch = {
      ...radarSettings.releaseWatch,
      enabled: !radarSettings.releaseWatch.enabled,
    };

    await updateRadarReleaseWatch(nextReleaseWatch);
  };

  const setReleaseWatchImportance = async (minImportance) => {
    await updateRadarReleaseWatch({
      ...radarSettings.releaseWatch,
      minImportance,
    });
  };

  const toggleReleaseWatchCompany = async (companyKey) => {
    const currentCompanies = radarSettings.releaseWatch?.companies || {};
    const selectedCount = Object.values(currentCompanies).filter(Boolean).length;
    const nextEnabled = !currentCompanies[companyKey];
    if (!nextEnabled && selectedCount <= 1) {
      setRadarMessage('Keep at least one release-watch company on.');
      return;
    }

    await updateRadarReleaseWatch({
      ...radarSettings.releaseWatch,
      companies: {
        ...currentCompanies,
        [companyKey]: nextEnabled,
      },
    });
  };

  const updateDirectNewsWatch = async (nextDirectNewsWatch) => {
    setRadarBusy(true);
    setRadarMessage('');

    try {
      const settings = await savePriorityRadarSettings({
        ...radarSettings,
        directNewsWatch: nextDirectNewsWatch,
      });

      setRadarSettings(settings);

      if (user) {
        const currentPreferences = await fetchNotificationPreferences();
        await updateNotificationPreferences({
          alerts_enabled: settings.enabled,
          ai_enabled: settings.categories.ai,
          geo_enabled: settings.categories.geo,
          push_enabled: currentPreferences?.push_enabled === true,
          local_fallback_enabled: settings.enabled,
          ...buildRemoteReleaseWatchPayload(settings, {
            includeMinImportance: radarCapabilities.syncedReleaseWatchMinImportance,
          }),
        });
      }

      setRadarMessage('Direct news notification rule saved.');
      await refreshDiagnostics();
    } finally {
      setRadarBusy(false);
    }
  };

  const toggleDirectNewsWatchSource = async (sourceKey) => {
    const currentSources = radarSettings.directNewsWatch?.sources || {};
    const selectedCount = Object.values(currentSources).filter(Boolean).length;
    const nextEnabled = !currentSources[sourceKey];
    if (!nextEnabled && selectedCount <= 1) {
      setRadarMessage('Keep at least one direct-notification source on.');
      return;
    }

    await updateDirectNewsWatch({
      ...radarSettings.directNewsWatch,
      sources: {
        ...currentSources,
        [sourceKey]: nextEnabled,
      },
    });
  };

  const saveContentPreferences = async () => {
    if (!user) {
      setPreferenceMessage('Sign in to save content preferences to your account.');
      return;
    }

    setPreferenceBusy(true);
    setPreferenceMessage('');

    try {
      const result = await updatePreferences({
        depth_pref: contentPrefs.depth_pref,
        rarity_pref: contentPrefs.rarity_pref,
        length_pref: contentPrefs.length_pref,
      });

      setPreferenceMessage(result?.success ? 'Content preferences saved.' : 'Could not save content preferences right now.');
    } finally {
      setPreferenceBusy(false);
    }
  };

  const saveHierarchyPreferences = async () => {
    if (!user) {
      setHierarchyMessage('Sign in to save your current goal.');
      return;
    }

    const nextGoal = String(hierarchyGoalDraft || '').trim();
    if (!nextGoal) {
      setHierarchyMessage('Write one clear goal before saving.');
      return;
    }

    setHierarchyBusy(true);
    setHierarchyMessage('');

    try {
      const result = await updateHierarchyGoal(nextGoal);
      if (result?.success && result?.hierarchy) {
        setHierarchyState(result.hierarchy);
        setHierarchyGoalDraft(result.hierarchy.currentGoal || nextGoal);
        setHierarchyMessage('Current goal saved.');
      } else {
        setHierarchyMessage('Could not save your current goal right now.');
      }
    } finally {
      setHierarchyBusy(false);
    }
  };

  const saveStoriesPreferences = async () => {
    if (!user) {
      setHierarchyMessage('Sign in to save your stories.');
      return;
    }

    const storyHighestOrder = String(storyHighestOrderDraft || '').trim();
    const storyYours = String(storyYoursDraft || '').trim();
    const storySubStories = String(storySubStoriesDraft || '').trim();

    if (!storyHighestOrder && !storyYours && !storySubStories) {
      setHierarchyMessage('Provide at least one story layer before saving.');
      return;
    }

    setHierarchyBusy(true);
    setHierarchyMessage('');

    try {
      const result = await updateHierarchyStories({
        storyHighestOrder,
        storyYours,
        storySubStories,
      });

      if (result?.success && result?.hierarchy) {
        setHierarchyState(result.hierarchy);
        setStoryHighestOrderDraft(result.hierarchy.storyHighestOrder || storyHighestOrder);
        setStoryYoursDraft(result.hierarchy.storyYours || storyYours);
        setStorySubStoriesDraft(result.hierarchy.storySubStories || storySubStories);
        setHierarchyGoalDraft(result.hierarchy.currentGoal || storySubStories);
        setHierarchyMessage('Stories saved successfully.');
      } else {
        setHierarchyMessage('Could not save your stories right now.');
      }
    } catch (err) {
      setHierarchyMessage(`Error saving stories: ${err.message || err}`);
    } finally {
      setHierarchyBusy(false);
    }
  };

  const handleAnalyzeSelfData = async () => {
    if (!user) {
      setSelfAnalysisMessage('Sign in to analyze your SELF data.');
      return;
    }

    const rawText = String(selfRawDataDraft || '').trim();
    if (!rawText) {
      setSelfAnalysisMessage('Please paste your SELF 1-page gist or results before submitting.');
      return;
    }

    setSelfAnalysisBusy(true);
    setSelfAnalysisMessage('');

    try {
      const result = await analyzeSelfData(rawText);
      if (result?.success && result?.hierarchy) {
        setHierarchyState(result.hierarchy);
        setSelfRawDataDraft(result.hierarchy.selfRawData || rawText);
        setScientificProfile(result.hierarchy.scientificProfile || null);
        setSelfAnalysisMessage('SELF website results analyzed and synced successfully!');
      } else {
        setSelfAnalysisMessage('Failed to analyze your SELF data.');
      }
    } catch (err) {
      setSelfAnalysisMessage(`Error analyzing data: ${err.message || err}`);
    } finally {
      setSelfAnalysisBusy(false);
    }
  };

  const notificationReadiness = buildNotificationReadinessSummary({
    backendStatus: notificationStatus,
    notificationState,
    pushState,
    systemReadiness,
    alertsEnabled: radarSettings.enabled,
    rememberedDevice: loadRememberedPushDevice(),
  });
  const notificationStatusLabel = notificationReadiness.label;
  const notificationStatusDescription = notificationReadiness.description;

  const radarStatusLabel = radarSettings.enabled
    ? notificationState.isNative
      ? 'High-priority alerts are on'
      : 'High-priority alerts are on in eXplore'
    : 'High-priority alerts are off';
  const releaseWatchSummary = getPriorityRadarReleaseWatchSummary(radarSettings);
  const releaseWatchMinImportance = getPriorityRadarReleaseWatchMinImportance(radarSettings);
  const releaseWatchMinImportanceDescription = describePriorityRadarReleaseWatchMinImportance(releaseWatchMinImportance);
  const radarScopeDescription = radarSettings.categories.ai && !radarSettings.categories.geo
    ? `${releaseWatchSummary}.`
    : !radarSettings.categories.ai && radarSettings.categories.geo
      ? 'Urgent Iran/Qatar updates and major political events can notify you.'
      : `${releaseWatchSummary}. Urgent Iran/Qatar updates and major political events can also notify you.`;
  const backendReachability = describeBackendReachability(resolvedBackendUrl, notificationState.isNative);
  const showConnectionPanel = notificationState.isNative || process.env.NEXT_PUBLIC_DEBUG_BACKEND_OVERRIDE === 'true';
  const selectedReleaseWatchCompanies = getPriorityRadarReleaseWatchCompanies(radarSettings);
  const directNewsReason = getPriorityRadarDirectNewsReason(radarSettings);
  const connectionSummaryLabel = backendReachability.kind === 'hosted'
    ? 'Hosted backend'
    : backendReachability.kind === 'local'
      ? 'Local backend'
      : 'Automatic backend';
  const releaseWatchSyncLabel = user
    ? radarCapabilities.syncedReleaseWatchMinImportance
      ? 'This strictness syncs to your account and local fallback radar.'
      : 'This strictness applies on this device now. Your signed-in backend does not expose synced AI importance yet.'
    : notificationState.isNative
      ? 'This strictness applies on this phone through local fallback radar.'
      : 'This strictness applies in this browser while eXplore is open.';
  const activeOperatingBrief = templateFilterState.operatingBrief;
  const activeVideoLibrary = templateFilterState.videoLibrary;
  const templateSourceAndAlertChips = uniqueDisplayItems([
    activeOperatingBrief.alertStyle,
    ...activeOperatingBrief.preferredSources,
  ]);
  const templateTrackedChips = uniqueDisplayItems([
    ...activeOperatingBrief.trackedCompanies,
    ...activeOperatingBrief.peopleOfInterest,
  ]);
  const templateSignalFallbacks = uniqueDisplayItems([
    ...activeOperatingBrief.priorityTopics,
    ...activeOperatingBrief.trackedCompanies,
    ...activeOperatingBrief.peopleOfInterest,
  ]);
  const templateVideoCreatorLabels = activeVideoLibrary.creators.map((creatorKey) => getVideoLibraryCreatorLabel(creatorKey));
  const templateVideoCategoryLabels = activeVideoLibrary.categories.map((categoryKey) => getVideoLibraryCategoryLabel(categoryKey));
  const templateVideoSearchProfiles = buildVideoLibrarySearchProfiles(activeVideoLibrary);
  const templateFilterStatusLabel = !templateFilterState.loaded
    ? 'Loading...'
    : templateFilterState.connected
      ? 'Live brief'
      : 'Backend needed';
  const templateFilterSummary = !templateFilterState.loaded
    ? 'Loading the saved rules eXplore is using now.'
    : !templateFilterState.connected
      ? 'eXplore could not reach the saved News Rules right now, so this page cannot show the live filter yet.'
      : activeOperatingBrief.summary;
  const releaseWatchCompanyLabels = selectedReleaseWatchCompanies.map((company) => company.label || company.key);
  const filterPipelineSteps = [
    '1. Trust official and configured sources first',
    '2. Match your priority topics and tracked companies',
    '3. Suppress muted topics and stale repeated noise',
    '4. Promote model releases, written reporting, and transcript-backed videos',
    '5. Rank newest important items before generic coverage',
  ];
  const contentPreferenceChips = [
    `Depth ${preferenceToPercent(contentPrefs.depth_pref, 0.7)}%`,
    `Rarity ${preferenceToPercent(contentPrefs.rarity_pref, 0.6)}%`,
    `Length ${preferenceToPercent(contentPrefs.length_pref, 0.5)}%`,
  ];
  const alertCategoryChips = [
    radarSettings.enabled ? 'Priority Radar on' : 'Priority Radar off',
    radarSettings.categories?.ai ? 'AI release alerts on' : 'AI release alerts muted',
    radarSettings.categories?.geo ? 'Regional risk alerts on' : 'Regional risk alerts muted',
    radarSettings.releaseWatch?.enabled ? 'Official release watch on' : 'Official release watch off',
    radarSettings.directNewsWatch?.enabled ? 'Direct news rule on' : 'Direct news rule off',
  ];
  const filterBehaviorChips = [
    'Official releases beat commentary',
    'Fresh items beat old repeats',
    'Avoid topics are downgraded',
    'Transcript-backed video is promoted',
  ];
  const normalizedProfileSearch = profileSearch.trim().toLowerCase();
  const profileSectionVisible = (terms = '') => (
    !normalizedProfileSearch || String(terms || '').toLowerCase().includes(normalizedProfileSearch)
  );
  const visibleProfileSectionCount = [
    'life narrative highest order religious bible meaning humanity',
    'future wish north star life goal become',
    'current goals projects jobs scholarships news priority',
    'self evidence personality big five narrative cognitive iq',
    'filters do not show muted strictness suppress rarity length',
    'rules news template filter priority tracked companies voices interest',
    'messaging private inbox messages direct conversation',
  ].filter(profileSectionVisible).length;

  const readinessCards = systemReadiness ? [
    { key: 'runtime', title: 'Backend', payload: systemReadiness.runtime },
    { key: 'auth', title: 'Auth', payload: systemReadiness.auth },
    {
      key: 'ai',
      title: 'Ask AI',
      payload: modelPoolStatus ? {
        status: modelPoolStatus.degraded
          ? 'partial'
          : modelPoolStatus.keyCount || modelPoolStatus.openaiConfigured
            ? 'live'
            : 'unavailable',
        message: modelPoolStatus.degraded
          ? `${modelPoolStatus.coolingKeyCount || 0}/${modelPoolStatus.keyCount || 0} Gemini keys cooling. Ask AI uses rule fallback until a provider responds.`
          : modelPoolStatus.keyCount
            ? `${modelPoolStatus.provider || 'AI'} ready with ${modelPoolStatus.availableKeyCount ?? modelPoolStatus.keyCount} available Gemini keys.`
            : modelPoolStatus.openaiConfigured
              ? 'OpenAI fallback is configured.'
              : 'No live AI provider is configured.',
      } : {
        status: 'partial',
        message: 'AI provider diagnostics are unavailable.',
      },
    },
    { key: 'discovery', title: 'Best Feed', payload: systemReadiness.discovery },
    { key: 'written_news', title: 'Written Brief', payload: systemReadiness.written_news },
    { key: 'sources', title: 'Sources', payload: systemReadiness.sources },
    { key: 'push', title: 'Push', payload: systemReadiness.push },
    { key: 'meta', title: 'Meta Inbox', payload: systemReadiness.meta },
  ] : [];
  const liveStatusSummary = systemReadiness
    ? `${readinessCards.filter((card) => card.payload?.status === 'live').length} live, ${readinessCards.filter((card) => card.payload?.status === 'partial').length} partial`
    : 'Diagnostics unavailable';
  const liveFilterHealthChips = [
    `Backend: ${systemReadiness?.runtime?.status || 'checking'}`,
    `Sources: ${sourceSummary.configured || 0}/${sourceSummary.total || 0} ready`,
    sourceSummary.partial ? `${sourceSummary.partial} partial sources` : 'No partial sources',
    `Discovery: ${systemReadiness?.discovery?.status || 'checking'}`,
    `Feed candidates: ${systemReadiness?.discovery?.candidate_count || 0}`,
    liveStatusSummary,
  ];
  const enableAlertsLabel = notificationReadiness.key === 'enabled'
    ? 'High-priority alerts on'
    : 'Enable high-priority alerts';
  const enableAlertsDisabled = radarBusy
    || notificationBusy
    || notificationReadiness.key === 'enabled'
    || notificationReadiness.key === 'backend_unavailable';
  const renderProfileSearchBox = (modifierClass = '') => (
    <div className={`profile-search-box ${modifierClass}`.trim()} role="search">
      <SearchIcon size={16} />
      <input
        value={profileSearch}
        onChange={(event) => setProfileSearch(event.target.value)}
        placeholder="Search profile sections"
        autoCapitalize="none"
      />
    </div>
  );

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
      <div className="container">
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 'var(--space-medium)', flexWrap: 'wrap', gap: 'var(--space-small)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-small)' }}>
            <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
              <ArrowLeftIcon size={22} />
            </button>
            <h1 style={{ font: 'var(--font-h1)', margin: 0 }}>Preferences</h1>
          </div>
        </div>

        <FinalInterpretationCard />

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-base)' }}>
            <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Release watch</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(releaseWatchCompanyLabels, {
                      toneClass: 'active',
                      emptyMessage: 'Official release watch is off.',
                    })}
                  </div>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                    {releaseWatchMinImportanceDescription}
                  </p>
                </div>
              </div>

              <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Muted or ignored</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(
                      activeOperatingBrief.avoidTopics.map((topic) => `Ignore: ${topic}`),
                      {
                        emptyMessage: 'Nothing is being suppressed yet.',
                      },
                    )}
                  </div>
                </div>
              </div>

              <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Ranking knobs</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(contentPreferenceChips, { toneClass: 'active' })}
                  </div>
                </div>
              </div>

              <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Source and alert posture</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(templateSourceAndAlertChips, {
                      toneClass: 'active',
                      emptyMessage: 'No source posture is saved yet.',
                    })}
                  </div>
                </div>
              </div>

              <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Alert categories</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(alertCategoryChips, { toneClass: 'active' })}
                  </div>
                </div>
              </div>

              <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Ranking behavior</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(filterBehaviorChips, { toneClass: 'active' })}
                  </div>
                </div>
              </div>

              <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Live filter health</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(liveFilterHealthChips, {
                      toneClass: systemReadiness ? 'active' : '',
                    })}
                  </div>
                </div>
              </div>

              <div className="subtle-panel" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Video library focus</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(templateVideoCreatorLabels, {
                      toneClass: 'active',
                      emptyMessage: 'No saved creators yet.',
                    })}
                    {renderPreferenceChips(templateVideoCategoryLabels, {
                      emptyMessage: '',
                    })}
                    <span className={`chip ${activeVideoLibrary.inlinePlayback !== false ? 'active' : ''}`}>
                      {activeVideoLibrary.inlinePlayback !== false ? 'Watch inside Explore' : 'Open on YouTube'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {activeOperatingBrief.watchQuestions.length > 0 && (
              <div className="subtle-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Questions guiding the feed</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {renderPreferenceChips(activeOperatingBrief.watchQuestions, {
                      toneClass: 'active',
                    })}
                  </div>
                </div>
              </div>
            )}

            {templateVideoSearchProfiles.length > 0 && (
              <div className="subtle-panel" style={{ gap: 'var(--space-base)' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Current video search types</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-tight)' }}>
                  {templateVideoSearchProfiles.map((profile) => (
                    <div key={profile.key} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span className="chip active" style={{ width: 'fit-content' }}>{profile.label}</span>
                      <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                        {profile.queryHint}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </section>

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)' }}>
              <BellIcon size={18} />
              High-priority alerts
            </h2>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            {/* Main summary row: status + scope */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span className="page-kicker">High priority</span>
                <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', fontWeight: 700 }}>
                  {radarStatusLabel}
                </p>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', maxWidth: '44ch' }}>
                  {radarScopeDescription}
                </p>
              </div>
              <span
                className="status-pill"
                style={{
                  color: getNotificationStatusStyle(notificationReadiness.key).color,
                  background: getNotificationStatusStyle(notificationReadiness.key).background,
                }}
              >
                {notificationStatusLabel}
              </span>
            </div>

            {/* Simplified readiness state — four clean states only */}
            <div
              className="subtle-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-tight)',
                borderLeft: `3px solid ${getNotificationStatusStyle(notificationReadiness.key).color}`,
              }}
            >
              <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', fontWeight: 700, marginBottom: '4px' }}>
                {notificationStatusLabel}
              </p>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', maxWidth: '52ch' }}>
                {notificationStatusDescription}
              </p>
            </div>

            {/* Release watch company chips */}
            {selectedReleaseWatchCompanies.length > 0 && (
              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                {selectedReleaseWatchCompanies.map((company) => (
                  <span key={company.key} className="chip active">{company.label}</span>
                ))}
              </div>
            )}

            <div className="subtle-panel" style={{ gap: 'var(--space-tight)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Direct notification
                  </p>
                  <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>Investable shares</strong>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    void updateDirectNewsWatch({
                      ...radarSettings.directNewsWatch,
                      enabled: !radarSettings.directNewsWatch?.enabled,
                    });
                  }}
                  disabled={radarBusy}
                  style={{
                    borderColor: radarSettings.directNewsWatch?.enabled ? 'var(--accent)' : 'var(--border)',
                    color: radarSettings.directNewsWatch?.enabled ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {radarSettings.directNewsWatch?.enabled ? 'On' : 'Off'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                {PRIORITY_RADAR_REFERENCE_POINTS.map((reference) => {
                  const enabled = radarSettings.directNewsWatch?.sources?.[reference.companyId] === true;
                  return (
                    <button
                      key={`direct-news-source-${reference.companyId}`}
                      className="btn btn-secondary btn-sm"
                      onClick={() => { void toggleDirectNewsWatchSource(reference.companyId); }}
                      disabled={radarBusy || !radarSettings.directNewsWatch?.enabled}
                      style={{
                        borderColor: enabled ? 'var(--accent)' : 'var(--border)',
                        color: enabled ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {reference.publisher}
                    </button>
                  );
                })}
              </div>

              <textarea
                className="text-surface profile-textarea"
                rows={3}
                value={directNewsReason}
                onChange={(event) => {
                  setRadarSettings((current) => ({
                    ...current,
                    directNewsWatch: {
                      ...current.directNewsWatch,
                      reason: event.target.value,
                    },
                  }));
                }}
                aria-label="Why this direct notification matters"
              />

              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { void updateDirectNewsWatch(radarSettings.directNewsWatch); }}
                disabled={radarBusy || !radarSettings.directNewsWatch?.enabled}
                style={{ alignSelf: 'flex-start' }}
              >
                Save direct rule
              </button>
            </div>

            <div className="subtle-panel" style={{ gap: 'var(--space-tight)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Reference map
                  </p>
                  <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>Watched sources</strong>
                </div>
                <span className="status-pill">
                  {eventSourceMap?.lanes?.reduce((sum, lane) => sum + (lane.sources?.length || 0), 0) || 0} sources
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                {(eventSourceMap?.lanes || []).map((lane) => (
                  <span key={lane.id} className="chip active">
                    {lane.label} ({lane.sources?.length || 0})
                  </span>
                ))}
                {!eventSourceMap?.lanes?.length ? (
                  <span className="chip">Source map loading</span>
                ) : null}
              </div>

              {(eventSourceMap?.lanes || []).slice(0, 5).map((lane) => (
                <div key={`lane-${lane.id}`} style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-tight)' }}>
                  <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                    {lane.label}
                  </strong>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {(lane.sources || []).slice(0, lane.id === 'ai_advantage' ? 20 : 6).map((source) => (
                      <span key={source.id} className="chip" title={source.url}>
                        {source.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Primary CTA */}
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => runNotificationAction(enablePriorityRadar)}
                disabled={enableAlertsDisabled}
              >
                {notificationBusy || radarBusy ? 'Working...' : enableAlertsLabel}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowAdvancedAlerts((current) => !current)}
              >
                {showAdvancedAlerts ? 'Hide advanced' : 'Advanced'}
              </button>
            </div>

            {notificationMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                {notificationMessage}
              </p>
            )}
            {radarMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                {radarMessage}
              </p>
            )}

            {/* Advanced diagnostics — hidden by default */}
            {showAdvancedAlerts && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-base)' }}>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                  Advanced — raw readiness details and manual controls.
                </p>

                {/* Evidence grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-tight)' }}>
                  {notificationReadiness.evidence.map((entry) => (
                    <div
                      key={entry.label}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '10px 12px',
                        background: 'var(--surface-elevated)',
                      }}
                    >
                      <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                        {entry.label}
                      </p>
                      <p style={{ font: 'var(--font-body)', fontWeight: 700 }}>
                        {entry.value}
                      </p>
                    </div>
                  ))}
                </div>

                <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                  Last successful delivery: {notificationReadiness.lastSuccessfulDeliveryAt
                    ? formatTimestamp(notificationReadiness.lastSuccessfulDeliveryAt)
                    : 'none recorded yet.'}
                </p>

                {/* Turn off / Check now */}
                <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { void runRadarAction(disablePriorityRadar); }}
                    disabled={radarBusy}
                  >
                    Turn off
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { void runRadarAction(checkPriorityRadarNow); }}
                    disabled={radarBusy || !notificationState.supported}
                  >
                    Check now
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => onNavigate?.('priority-radar')}
                  >
                    Open radar feed
                  </button>
                </div>

                {/* AI categories */}
                <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { void toggleRadarCategory('ai'); }}
                    disabled={radarBusy}
                    style={{
                      borderColor: radarSettings.categories.ai ? 'var(--accent)' : 'var(--border)',
                      color: radarSettings.categories.ai ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {radarSettings.categories.ai ? 'AI updates on' : 'AI updates off'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { void toggleRadarCategory('geo'); }}
                    disabled={radarBusy}
                    style={{
                      borderColor: radarSettings.categories.geo ? 'var(--accent)' : 'var(--border)',
                      color: radarSettings.categories.geo ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {radarSettings.categories.geo ? 'Iran/Qatar on' : 'Iran/Qatar off'}
                  </button>
                </div>

                {/* Release watch companies */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Release watch
                  </p>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => { void toggleReleaseWatchEnabled(); }}
                      disabled={radarBusy}
                      style={{
                        borderColor: radarSettings.releaseWatch.enabled ? 'var(--accent)' : 'var(--border)',
                        color: radarSettings.releaseWatch.enabled ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {radarSettings.releaseWatch.enabled ? 'Release watch on' : 'Release watch off'}
                    </button>
                    {Object.entries(radarSettings.releaseWatch?.companies || {}).map(([companyKey, enabled]) => {
                      const companyLabel = getPriorityRadarReleaseWatchCompanies({
                        releaseWatch: {
                          enabled: true,
                          companies: { [companyKey]: true },
                        },
                      })[0]?.label || companyKey;

                      return (
                        <button
                          key={companyKey}
                          className="btn btn-secondary"
                          onClick={() => { void toggleReleaseWatchCompany(companyKey); }}
                          disabled={radarBusy || !radarSettings.releaseWatch.enabled}
                          style={{
                            borderColor: enabled ? 'var(--accent)' : 'var(--border)',
                            color: enabled ? 'var(--accent)' : 'var(--text-secondary)',
                          }}
                        >
                          {companyLabel}
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                    Official release posts from the selected companies are prioritized before broader AI commentary.
                  </p>
                </div>

                {/* Push strictness */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                  <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                    AI push strictness
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                    {PRIORITY_RADAR_RELEASE_MIN_IMPORTANCE_OPTIONS.map((option) => (
                      <button
                        key={`release-importance-${option.value}`}
                        className="btn btn-secondary"
                        onClick={() => { void setReleaseWatchImportance(option.value); }}
                        disabled={radarBusy || !radarSettings.releaseWatch.enabled}
                        style={{
                          borderColor: releaseWatchMinImportance === option.value ? 'var(--accent)' : 'var(--border)',
                          color: releaseWatchMinImportance === option.value ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                    {releaseWatchMinImportanceDescription}
                  </p>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                    {releaseWatchSyncLabel}
                  </p>
                </div>

                {/* Account/device summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-tight)' }}>
                  {[
                    { label: 'Account synced', value: user ? (systemReadiness?.auth?.status === 'live' ? 'Ready' : 'Partial') : (radarSettings.enabled ? 'Local only' : 'No') },
                    { label: 'Device registered', value: systemReadiness?.push?.push_registered ? 'Yes' : 'No' },
                    { label: 'Hosted push', value: systemReadiness?.push?.push_configured ? 'Ready' : 'Missing' },
                    { label: 'Fallback', value: systemReadiness?.push?.local_fallback_enabled ? 'On' : 'Off' },
                  ].map((entry) => (
                    <div key={entry.label} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--surface-elevated)' }}>
                      <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{entry.label}</p>
                      <p style={{ font: 'var(--font-body)', fontWeight: 700 }}>{entry.value}</p>
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-secondary"
                  type="button"
                  style={{ width: '100%', marginTop: 'var(--space-tight)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  onClick={() => onNavigate?.('auth-status')}
                >
                  🔑 View Detailed Auth & Notification Status
                </button>

                {radarMessage && (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                    {radarMessage}
                  </p>
                )}
                {diagnosticsMessage && (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                    {diagnosticsMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', margin: 0 }}>
              📋 Three-Tier Notification Rules
            </h2>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={handleAddRuleClick}
            >
              + Add Rule
            </button>
          </div>

          {showRuleForm && (
            <div className="card" style={{ marginBottom: 'var(--space-base)', background: 'var(--surface-elevated)', border: '1px solid var(--accent)' }}>
              <h3 style={{ font: 'var(--font-body)', fontWeight: 700, marginBottom: 'var(--space-small)' }}>
                {editingRuleId ? 'Edit Notification Rule' : 'Create Notification Rule'}
              </h3>
              <form onSubmit={handleSaveRule} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                <div>
                  <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Topic Name</label>
                  <div className="search-bar">
                    <input
                      type="text"
                      placeholder="e.g. King Abdullah Schools admissions"
                      value={ruleForm.topic}
                      onChange={(e) => setRuleForm({ ...ruleForm, topic: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-small)' }}>
                  <div>
                    <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Priority Level</label>
                    <select
                      className="text-surface"
                      style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)' }}
                      value={ruleForm.priority}
                      onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })}
                    >
                      <option value="Watch">Watch (Low Priority)</option>
                      <option value="Important">Important (Medium Priority)</option>
                      <option value="Direct">Direct (High/Instant Alert)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Freshness Window</label>
                    <select
                      className="text-surface"
                      style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)' }}
                      value={ruleForm.freshnessWindow}
                      onChange={(e) => setRuleForm({ ...ruleForm, freshnessWindow: e.target.value })}
                    >
                      <option value="1 hour">1 hour</option>
                      <option value="6 hours">6 hours</option>
                      <option value="12 hours">12 hours</option>
                      <option value="24 hours">24 hours</option>
                      <option value="3 days">3 days</option>
                      <option value="7 days">7 days</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Source List (comma-separated)</label>
                  <div className="search-bar">
                    <input
                      type="text"
                      placeholder="e.g. MOE, Facebook, Twitter"
                      value={ruleForm.sources}
                      onChange={(e) => setRuleForm({ ...ruleForm, sources: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-small)' }}>
                  <div>
                    <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Trigger Words (comma-separated)</label>
                    <div className="search-bar">
                      <input
                        type="text"
                        placeholder="e.g. admission, applications"
                        value={ruleForm.triggerWords}
                        onChange={(e) => setRuleForm({ ...ruleForm, triggerWords: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Negative Filters (ignore list)</label>
                    <div className="search-bar">
                      <input
                        type="text"
                        placeholder="e.g. archive, old, 2025"
                        value={ruleForm.negativeFilters}
                        onChange={(e) => setRuleForm({ ...ruleForm, negativeFilters: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Reason / Intent</label>
                  <textarea
                    className="text-surface profile-textarea"
                    rows={2}
                    placeholder="Why are you watching this topic?"
                    value={ruleForm.reason}
                    onChange={(e) => setRuleForm({ ...ruleForm, reason: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-tight)', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowRuleForm(false)}>
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-sm" type="submit">
                    Save Rule
                  </button>
                </div>
              </form>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            {threeTierRules.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 'var(--space-large)', color: 'var(--text-tertiary)' }}>
                No custom notification rules set up. Click &apos;+ Add Rule&apos; above to create one.
              </div>
            ) : (
              threeTierRules.map((rule) => {
                const badgeColor = rule.priority === 'Direct'
                  ? 'var(--error)'
                  : rule.priority === 'Important'
                    ? 'var(--warning)'
                    : 'var(--accent)';
                const badgeBg = rule.priority === 'Direct'
                  ? 'rgba(239, 68, 68, 0.1)'
                  : rule.priority === 'Important'
                    ? 'rgba(245, 158, 11, 0.1)'
                    : 'rgba(59, 130, 246, 0.1)';

                return (
                  <div key={rule.id} className="card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-small)', marginBottom: '8px' }}>
                      <div>
                        <span
                          className="status-pill"
                          style={{ color: badgeColor, background: badgeBg, fontWeight: 700, marginRight: '8px', fontSize: '11px', textTransform: 'uppercase' }}
                        >
                          {rule.priority}
                        </span>
                        <strong style={{ font: 'var(--font-body)', fontSize: '16px', color: 'var(--text-primary)' }}>
                          {rule.topic}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 6px', fontSize: '11px' }}
                          onClick={() => handleEditRuleClick(rule)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 6px', fontSize: '11px', color: 'var(--error)' }}
                          onClick={() => handleDeleteRule(rule.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '0 0 12px 0', fontStyle: 'italic' }}>
                      &ldquo;{rule.reason || 'No reason specified'}&rdquo;
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', fontSize: '12px', borderTop: '1px solid var(--border-soft)', paddingTop: '10px' }}>
                      <div>
                        <span style={{ color: 'var(--text-tertiary)', display: 'block' }}>Sources</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{rule.sources || 'Any'}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-tertiary)', display: 'block' }}>Trigger Words</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{rule.triggerWords || 'None'}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-tertiary)', display: 'block' }}>Negative Filters</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{rule.negativeFilters || 'None'}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-tertiary)', display: 'block' }}>Freshness / Last Checked</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {rule.freshnessWindow} / {rule.lastChecked ? new Date(rule.lastChecked).toLocaleTimeString() : 'Never'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)' }}>
              👥 Profile variants (Version control)
            </h2>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-medium)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Generate tailored profile versions focused on specific goals (Scholarships, Jobs, Study, or Projects) built dynamically from your user value hierarchy.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-base)' }}>
              {['scholarship', 'job', 'study', 'project'].map((kind) => {
                const variant = variants.find((v) => v.kind === kind);
                const isGenerating = !!generatingVariants[kind];
                
                return (
                  <div 
                    key={kind} 
                    className="opp-card" 
                    style={{ 
                      borderLeft: `3px solid ${kind === 'scholarship' ? 'var(--warning)' : kind === 'job' ? 'var(--success)' : kind === 'study' ? 'var(--accent)' : '#a78bfa'}`, 
                      background: 'var(--chrome-bg)', 
                      borderRadius: '8px', 
                      border: '1px solid var(--border-soft)', 
                      borderLeftWidth: '3px',
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="opp-cat-badge" style={{ color: 'var(--text-primary)', font: 'var(--font-caption)', fontWeight: 700, textTransform: 'uppercase' }}>
                        {kind}
                      </span>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleGenerateVariant(kind)}
                        disabled={isGenerating}
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                      >
                        {isGenerating ? 'Tailoring...' : variant ? 'Refresh' : 'Generate'}
                      </button>
                    </div>

                    {variant && variant.body ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                        <div style={{ font: 'var(--font-body)', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {variant.title}
                        </div>
                        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                          {variant.body.summary}
                        </p>
                        
                        {variant.body.skills && variant.body.skills.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                            {variant.body.skills.map((skill, si) => (
                              <span key={si} className="chip" style={{ fontSize: '10px', padding: '2px 6px' }}>{skill}</span>
                            ))}
                          </div>
                        )}

                        {variant.body.highlights && variant.body.highlights.length > 0 && (
                          <ul style={{ margin: '6px 0 0', paddingLeft: '16px', font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {variant.body.highlights.map((h, hi) => (
                              <li key={hi}>{h}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <div style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: '4px' }}>
                        No version generated yet. Click generate to create a goal-aligned profile draft.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {variantMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', margin: '8px 0 0' }}>
                {variantMessage}
              </p>
            )}
          </div>
        </section>

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <h2 className="section-title">More tools</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSetupLinks((current) => !current)}>
              {showSetupLinks ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Secondary setup surfaces live here when you need them, without taking over the main product.
            </p>
            {showSetupLinks && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-tight)' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => onNavigate?.('sources')}>
                  Sources ({sourceSummary.total || 0})
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => onNavigate?.('history')}>
                  History & Data
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => onNavigate?.('saved')}>
                  Saved
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => onNavigate?.('subscription')}>
                  Subscription setup
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, borderColor: 'var(--premium)', color: 'var(--premium)' }} onClick={() => onNavigate?.('family')}>
                  Family setup
                </button>
                <button className="btn btn-secondary" style={{ gridColumn: '1 / -1', borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => onNavigate?.('referral')}>
                  Referral setup
                </button>
                <button className="btn btn-secondary" style={{ gridColumn: '1 / -1', borderColor: '#a78bfa', color: '#a78bfa' }} onClick={() => onNavigate?.('mail')}>
                  📬 Mail Intelligence
                </button>
                <button className="btn btn-secondary" style={{ gridColumn: '1 / -1', borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => onNavigate?.('formulation')}>
                  ✍ Distill Golden Formulation
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => onNavigate?.('experience')}>
                  📓 eXperience Journal
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => onNavigate?.('shared-experience')}>
                  Shared Experience
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => onNavigate?.('experiment')}>
                  🧪 eXperiment Track
                </button>
                {isAdmin && (
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, gridColumn: '1 / -1', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                    onClick={() => onNavigate?.('recommender-admin')}
                  >
                    🤖 Intelligence Engine Admin
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <h2 className="section-title">System health</h2>
            <span className="status-pill">{liveStatusSummary}</span>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Backend readiness for feed, push, and auth. Toggle Advanced in High-priority alerts above for notification controls.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { void refreshDiagnostics(); }} disabled={diagnosticsBusy}>
                {diagnosticsBusy ? 'Refreshing...' : 'Refresh diagnostics'}
              </button>
            </div>

            {!systemReadiness && (
              <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', fontWeight: 600 }}>
                Backend diagnostics are unavailable right now.
              </p>
            )}

            {systemReadiness && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-tight)' }}>
                  {readinessCards.map((card) => {
                    const style = getStatusStyle(card.payload?.status);

                    return (
                      <div
                        key={card.key}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-md)',
                          padding: 'var(--space-small)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          minHeight: '100px',
                          background: 'var(--surface-elevated)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-tight)' }}>
                          <h3 style={{ font: 'var(--font-body)', fontWeight: 700 }}>{card.title}</h3>
                          <span className="status-pill" style={{ color: style.color, background: style.background }}>
                            {style.label}
                          </span>
                        </div>
                        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                          {card.payload?.message || 'No status message yet.'}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                  Sources ready: {sourceSummary.configured || 0}. Partial: {sourceSummary.partial || 0}. Tracked channels: {systemReadiness.discovery?.tracked_channel_count || 0}. Topic monitors: {systemReadiness.discovery?.topic_monitor_count || 0}. Feed candidates: {systemReadiness.discovery?.candidate_count || 0}. Devices registered: {systemReadiness.push?.registered_device_count || 0}.
                </p>
              </>
            )}

            {diagnosticsMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                {diagnosticsMessage}
              </p>
            )}
          </div>
        </section>


        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <h2 className="section-title">Connection and cache</h2>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', fontWeight: 700 }}>
              {connectionSummaryLabel}
            </p>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Current backend: {resolvedBackendUrl || defaultBackendUrl || 'Automatic backend detection'}
            </p>

            {backendReachability.message && (
              <p style={{
                font: 'var(--font-caption)',
                color: backendReachability.kind === 'local' ? 'var(--warning)' : 'var(--text-secondary)',
              }}>
                {backendReachability.message}
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => { void resetLocalCache(); }} disabled={deviceResetBusy}>
                {deviceResetBusy ? 'Clearing cache...' : 'Reset local cache'}
              </button>
              {showConnectionPanel && (
                <>
                  <button className="btn btn-secondary" onClick={() => { void resetApiOverride(); }}>
                    Use configured default
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowAdvancedConnection((current) => !current)}>
                    {showAdvancedConnection ? 'Hide backend override' : 'Edit backend URL'}
                  </button>
                </>
              )}
            </div>

            {showConnectionPanel && showAdvancedConnection && (
              <>
                <div className="search-bar">
                  <input
                    type="url"
                    placeholder={resolvedBackendUrl || defaultBackendUrl || 'Auto-detect backend'}
                    value={apiBaseInput}
                    onChange={(event) => setApiBaseInput(event.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => { void saveApiOverride(); }}>
                    Save backend URL
                  </button>
                </div>
              </>
            )}

            {apiMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                {apiMessage}
              </p>
            )}
          </div>
        </section>

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <h2 className="section-title">Signals you follow</h2>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            {contentPrefs.interests.length > 0 ? contentPrefs.interests.map((interest) => (
              <div key={interest.id || interest.topic_id || interest.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-small)' }}>
                <span style={{
                  font: 'var(--font-body)',
                  width: '160px',
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{interest.name}</span>
                <div style={{
                  flex: 1,
                  height: '8px',
                  background: 'var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round(Number(interest.weight || 0) * 100)}%`,
                    background: 'var(--accent)',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'width 0.3s var(--ease-out)',
                  }} />
                </div>
                <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', width: '32px', textAlign: 'right' }}>
                  {Math.round(Number(interest.weight || 0) * 100)}%
                </span>
              </div>
            )) : templateSignalFallbacks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                  These signals are coming from your saved News Rules right now.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  {renderPreferenceChips(templateSignalFallbacks, { toneClass: 'active' })}
                </div>
              </div>
            ) : (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {user ? 'No saved interests yet.' : 'Sign in to load your saved interests.'}
              </p>
            )}
          </div>
        </section>

        <section id="user-theory" style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <div>
              <h2 className="section-title">User Theory</h2>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: 'var(--space-tight)' }}>
                The system&apos;s structured understanding of you: inferred interests, evidence, corrections, and controls to pause, reset, or export.
              </p>
            </div>
            <span className={`status-pill ${userTheory?.status === 'paused' ? 'is-empty' : 'is-live'}`}>
              {userTheory?.status || 'loading'}
            </span>
          </div>
          <div className="card" style={{ padding: 'var(--space-base)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={theoryBusy}
                onClick={async () => {
                  setTheoryBusy(true);
                  setTheoryMessage('');
                  try {
                    const [theoryRes, corrRes, multRes] = await Promise.all([
                      fetchUserTheory(),
                      fetchIntelligenceCorrections(),
                      fetchIntelligenceMultipliers(),
                    ]);
                    if (theoryRes?.theory) setUserTheory(theoryRes.theory);
                    setTheoryCorrections(Array.isArray(corrRes?.corrections) ? corrRes.corrections : []);
                    setTheoryMultipliers(Array.isArray(multRes?.multipliers) ? multRes.multipliers : []);
                    setTheoryMessage('User Theory refreshed.');
                  } catch {
                    setTheoryMessage('Could not load User Theory.');
                  } finally {
                    setTheoryBusy(false);
                  }
                }}
              >
                Refresh theory
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={theoryBusy}
                onClick={async () => {
                  setTheoryBusy(true);
                  try {
                    const res = userTheory?.status === 'paused'
                      ? await resumeUserTheory()
                      : await pauseUserTheory();
                    if (res?.theory) setUserTheory(res.theory);
                    setTheoryMessage(res?.message || 'Status updated.');
                  } catch {
                    setTheoryMessage('Could not change theory status.');
                  } finally {
                    setTheoryBusy(false);
                  }
                }}
              >
                {userTheory?.status === 'paused' ? 'Resume learning' : 'Pause learning'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={theoryBusy}
                onClick={async () => {
                  if (!window.confirm('Reset inferred interests, multipliers, and correction history? Story layers and explicit goals stay.')) {
                    return;
                  }
                  setTheoryBusy(true);
                  try {
                    const res = await resetUserTheory();
                    if (res?.theory) setUserTheory(res.theory);
                    setTheoryCorrections([]);
                    setTheoryMultipliers([]);
                    setTheoryMessage(res?.message || 'Theory reset.');
                  } catch {
                    setTheoryMessage('Could not reset theory.');
                  } finally {
                    setTheoryBusy(false);
                  }
                }}
              >
                Reset inferred theory
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={theoryBusy}
                onClick={async () => {
                  setTheoryBusy(true);
                  try {
                    const res = await exportUserTheory();
                    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `explore-user-theory-${Date.now()}.json`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                    setTheoryMessage('User Theory exported.');
                  } catch {
                    setTheoryMessage('Could not export theory.');
                  } finally {
                    setTheoryBusy(false);
                  }
                }}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={cycleBusy}
                onClick={async () => {
                  setCycleBusy(true);
                  setCycleMessage('Running full intelligence cycle...');
                  try {
                    const snapshot = await runPersonalIntelligenceCycle({ runExternal: true, limit: 12 });
                    const status = await fetchIntelligenceCycleStatus();
                    setCycleStatus(status);
                    if (snapshot?.theory) {
                      setUserTheory((current) => current ? { ...current, status: snapshot.theory.status } : current);
                    }
                    setCycleMessage(
                      snapshot?.success
                        ? `Cycle complete: ${snapshot.ranking?.itemCount || 0} ranked items, ${snapshot.clustering?.clusterCount || 0} clusters, theory ${snapshot.theory?.status || 'active'}.`
                        : 'Cycle finished with issues.'
                    );
                    // Refresh theory evidence counts
                    const theoryRes = await fetchUserTheory();
                    if (theoryRes?.theory) setUserTheory(theoryRes.theory);
                  } catch (error) {
                    setCycleMessage(error?.message || 'Cycle failed. Backend may be offline.');
                  } finally {
                    setCycleBusy(false);
                  }
                }}
              >
                {cycleBusy ? 'Running cycle…' : 'Run full intelligence cycle'}
              </button>
            </div>
            {cycleMessage ? (
              <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>{cycleMessage}</p>
            ) : null}
            {cycleStatus ? (
              <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Cycle ready: {String(cycleStatus.ready)} · content {cycleStatus.contentCount} · topics {cycleStatus.topicCount} · evidence {cycleStatus.evidenceCount}
              </p>
            ) : null}
            {theoryMessage ? (
              <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>{theoryMessage}</p>
            ) : null}
            {userTheory ? (
              <>
                <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                  Last updated: {userTheory.last_updated || 'n/a'} · Mode: {userTheory.story_layers?.app_mode || 'average'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(userTheory.inferred_interests || []).slice(0, 12).map((entry) => (
                    <span key={`inf-${entry.name}`} className="chip">
                      Inferred: {entry.name} ({Math.round((entry.confidence || 0) * 100)}%)
                    </span>
                  ))}
                  {(userTheory.exclusions || []).slice(0, 8).map((entry) => (
                    <span key={`ex-${entry.name}`} className="chip">
                      Avoid: {entry.name}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div className="subtle-panel" style={{ padding: '10px' }}>
                    <strong style={{ font: 'var(--font-caption)' }}>Evidence</strong>
                    <p style={{ margin: '4px 0 0', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                      {(userTheory.evidence || []).length} active evidence rows
                    </p>
                  </div>
                  <div className="subtle-panel" style={{ padding: '10px' }}>
                    <strong style={{ font: 'var(--font-caption)' }}>Corrections</strong>
                    <p style={{ margin: '4px 0 0', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                      {theoryCorrections.length || (userTheory.correction_history || []).length} recent corrections
                    </p>
                  </div>
                  <div className="subtle-panel" style={{ padding: '10px' }}>
                    <strong style={{ font: 'var(--font-caption)' }}>Topic multipliers</strong>
                    <p style={{ margin: '4px 0 0', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                      {theoryMultipliers.length || (userTheory.topic_multipliers || []).length} learned topic weights
                    </p>
                  </div>
                </div>
                {(theoryCorrections.length || (userTheory.correction_history || []).length) ? (
                  <div>
                    <p className="page-kicker" style={{ marginBottom: '6px' }}>Recent corrections</p>
                    <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', font: 'var(--font-caption)' }}>
                      {(theoryCorrections.length ? theoryCorrections : userTheory.correction_history).slice(0, 6).map((row) => (
                        <li key={row.id}>
                          {row.feedback_type || 'feedback'}
                          {row.rating != null ? ` · score ${row.rating}` : ''}
                          {row.title ? ` · ${row.title}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Press Refresh theory to inspect what eXplore currently infers about you.
              </p>
            )}
          </div>
        </section>

        <section id="user-profile-map" style={{ marginBottom: 'var(--space-large)' }}>
          <div className="section-header">
            <div>
              <h2 className="section-title">User Profile information</h2>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: 'var(--space-tight)' }}>
                Seven editable groups decide what eXplore shows, ranks, alerts, and hides.
              </p>
            </div>
            <span className="status-pill is-live">Goal routed</span>
          </div>

          {renderProfileSearchBox()}

          <div className="profile-grid">
            {profileSectionVisible('life narrative highest order religious bible meaning humanity') ? (
            <ProfileGroupCard
              number="1"
              title="Life Narrative"
              kicker="Highest order"
              description="The shared human, religious, biblical, or meaning frame that gives distant signals context."
              affects="deep interpretation, long-term relevance, and which unusual signals are allowed into the feed."
            >
              <ProfileTextarea
                rows={4}
                placeholder="Write the highest-order life narrative eXplore should use."
                value={storyHighestOrderDraft}
                onChange={(event) => setStoryHighestOrderDraft(event.target.value)}
              />
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={() => { void saveStoriesPreferences(); }} disabled={hierarchyBusy}>
                  {hierarchyBusy ? 'Saving...' : 'Save story layers'}
                </button>
              </div>
            </ProfileGroupCard>
            ) : null}

            {profileSectionVisible('future wish north star life goal become') ? (
            <ProfileGroupCard
              number="2"
              title="Future Wish"
              kicker="North star"
              description="The one-page future life wish: who you want to become and what your life should move toward."
              affects="opportunity matching, research suggestions, feed ranking, and AI-suggested goals."
            >
              <ProfileTextarea
                rows={4}
                placeholder="Write the future life you want eXplore to protect and build toward."
                value={storyYoursDraft}
                onChange={(event) => setStoryYoursDraft(event.target.value)}
              />
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={() => { void saveStoriesPreferences(); }} disabled={hierarchyBusy}>
                  {hierarchyBusy ? 'Saving...' : 'Save future wish'}
                </button>
              </div>
            </ProfileGroupCard>
            ) : null}

            {profileSectionVisible('current goals projects jobs scholarships news priority') ? (
            <ProfileGroupCard
              number="3"
              title="Current Goals"
              kicker="Live filter"
              description="The concrete projects and next goals that should carry the most weight right now."
              affects="news priority, jobs, scholarships, alerts, and daily recommendations."
              wide
            >
              <div className="profile-field-stack">
                <span className="profile-field-label">Main current goal</span>
                <ProfileTextarea
                  rows={3}
                  placeholder="Write one clear current goal."
                  value={hierarchyGoalDraft}
                  onChange={(event) => setHierarchyGoalDraft(event.target.value)}
                />
              </div>
              <div className="profile-field-stack">
                <span className="profile-field-label">Active sub-stories and projects</span>
                <ProfileTextarea
                  rows={3}
                  placeholder="List the active projects, targets, deadlines, or lower-order goals."
                  value={storySubStoriesDraft}
                  onChange={(event) => setStorySubStoriesDraft(event.target.value)}
                />
              </div>
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={() => { void saveHierarchyPreferences(); }} disabled={hierarchyBusy}>
                  {hierarchyBusy ? 'Saving...' : 'Save current goal'}
                </button>
                <button className="btn btn-ghost" onClick={() => { void saveStoriesPreferences(); }} disabled={hierarchyBusy}>
                  Save goal story
                </button>
              </div>
              {hierarchyMessage && <p className="profile-status-message">{hierarchyMessage}</p>}
            </ProfileGroupCard>
            ) : null}

            {profileSectionVisible('self evidence personality big five narrative cognitive iq') ? (
            <ProfileGroupCard
              number="4"
              title="Evidence From SELF"
              kicker="Decision support"
              description="Paste SELF results or inspect the saved profile evidence behind personalization. This is not a diagnosis."
              affects="personality assumptions, narrative identity, cognitive style, confidence notes, and profile explanations."
              wide
            >
              <ProfileTextarea
                rows={4}
                placeholder="Paste the SELF gist or results summary."
                value={selfRawDataDraft}
                onChange={(event) => setSelfRawDataDraft(event.target.value)}
              />
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={() => { void handleAnalyzeSelfData(); }} disabled={selfAnalysisBusy}>
                  {selfAnalysisBusy ? 'Analyzing...' : 'Analyze SELF'}
                </button>
              </div>
              {selfAnalysisMessage && <p className="profile-status-message">{selfAnalysisMessage}</p>}

              <div className="profile-evidence-grid">
                <div className="profile-metric">
                  <span className="profile-metric-label">Core values</span>
                  <span className="profile-metric-value">
                    {(hierarchyState?.coreValues || []).length ? hierarchyState.coreValues.join(', ') : 'None detected yet'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">History hints</span>
                  <span className="profile-metric-value">
                    {(hierarchyState?.historyHints || []).length ? hierarchyState.historyHints.join(', ') : 'No import yet'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">Personality</span>
                  <span className="profile-metric-value">
                    {scientificProfile?.personality?.description || 'Run SELF analysis to generate this.'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">Narrative style</span>
                  <span className="profile-metric-value">
                    {scientificProfile?.narrative?.description || 'No narrative model yet.'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">Cognitive style</span>
                  <span className="profile-metric-value">
                    {scientificProfile?.cognitive?.description || 'No cognitive model yet.'}
                  </span>
                </div>
              </div>
            </ProfileGroupCard>
            ) : null}

            {profileSectionVisible('filters do not show muted strictness suppress rarity length') ? (
            <ProfileGroupCard
              number="5"
              title="Filters / Do-Not-Show"
              kicker="Guardrails"
              description="Control strictness here, and use News Rules for explicit topics, sources, formats, and alert rules to suppress."
              affects="suppressed topics, stale repeats, alert strictness, reading depth, and low-signal source handling."
              wide
            >
              <div className="profile-evidence-grid">
                <div className="profile-metric">
                  <span className="profile-metric-label">Muted topics</span>
                  <span className="profile-metric-value">
                    {activeOperatingBrief.avoidTopics.length ? activeOperatingBrief.avoidTopics.join(', ') : 'Nothing muted yet'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">Filter behavior</span>
                  <span className="profile-metric-value">{filterBehaviorChips.join(', ')}</span>
                </div>
              </div>

              <div className="slider-group">
                <label>
                  <span>Depth</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Quick to deep</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={preferenceToPercent(contentPrefs.depth_pref, 0.7)}
                  onChange={(event) => setContentPrefs((current) => ({
                    ...current,
                    depth_pref: percentToPreference(event.target.value, 0.7),
                  }))}
                />
              </div>

              <div className="slider-group">
                <label>
                  <span>Rarity</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Popular to rare</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={preferenceToPercent(contentPrefs.rarity_pref, 0.6)}
                  onChange={(event) => setContentPrefs((current) => ({
                    ...current,
                    rarity_pref: percentToPreference(event.target.value, 0.6),
                  }))}
                />
              </div>

              <div className="slider-group">
                <label>
                  <span>Length</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Any to long</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={preferenceToPercent(contentPrefs.length_pref, 0.5)}
                  onChange={(event) => setContentPrefs((current) => ({
                    ...current,
                    length_pref: percentToPreference(event.target.value, 0.5),
                  }))}
                />
              </div>

              <div className="profile-actions">
                <button className="btn btn-primary" onClick={() => { void saveContentPreferences(); }} disabled={preferenceBusy}>
                  {preferenceBusy ? 'Saving...' : 'Save filter strictness'}
                </button>
                <button className="btn btn-ghost" onClick={() => onNavigate?.('template')}>
                  Edit do-not-show rules
                </button>
              </div>
              {preferenceMessage && <p className="profile-status-message">{preferenceMessage}</p>}
            </ProfileGroupCard>
            ) : null}

            {profileSectionVisible('rules news template filter priority tracked companies voices interest') ? (
            <ProfileGroupCard
              number="6"
              title="News Rules"
              kicker="AI filter control"
              description="The natural-language rules telling eXplore what to watch, track, and avoid. These drive feed priority, alert triggers, video library focus, and brief tone."
              affects="feed priority, alert triggers, source ranking, video library focus, and daily brief tone."
              wide
            >
              <div className="profile-evidence-grid">
                <div className="profile-metric">
                  <span className="profile-metric-label">Priority topics</span>
                  <span className="profile-metric-value">
                    {activeOperatingBrief.priorityTopics.length
                      ? activeOperatingBrief.priorityTopics.join(', ')
                      : 'No priority topics yet'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">Tracked voices</span>
                  <span className="profile-metric-value">
                    {activeOperatingBrief.trackedCompanies.length
                      ? activeOperatingBrief.trackedCompanies.join(', ')
                      : 'No tracked voices yet'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">People of interest</span>
                  <span className="profile-metric-value">
                    {(activeOperatingBrief.peopleOfInterest || []).length
                      ? (activeOperatingBrief.peopleOfInterest || []).join(', ')
                      : 'No people of interest yet'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span className="profile-metric-label">Avoid topics</span>
                  <span className="profile-metric-value">
                    {activeOperatingBrief.avoidTopics.length
                      ? activeOperatingBrief.avoidTopics.join(', ')
                      : 'Nothing muted'}
                  </span>
                </div>
              </div>
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={() => onNavigate?.('template')}>
                  View &amp; edit rules
                </button>
              </div>
            </ProfileGroupCard>
            ) : null}

            {profileSectionVisible('messaging private inbox messages direct conversation') ? (
            <ProfileGroupCard
              number="7"
              title="Private Messaging"
              kicker="eXplore inbox"
              description="Direct messages, group threads, and live conversations from your eXplore network."
              affects="your inbox, contact list, and notification routing for private conversations."
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                  Your private messenger and shared conversations are accessible here. Open the full inbox to read threads, send messages, and manage your contacts.
                </p>
              </div>
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={() => onNavigate?.('messages')}>
                  Open messages
                </button>
              </div>
            </ProfileGroupCard>
            ) : null}

            {visibleProfileSectionCount === 0 ? (
              <div className="subtle-panel profile-group--wide">
                No profile section matches this search.
              </div>
            ) : null}
          </div>
        </section>

        <section style={{ display: 'none' }}>
          <h2 className="section-title" style={{ marginBottom: 'var(--space-base)' }}>The 3 Layers of Your Story</h2>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-medium)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-small)' }}>
              Configure the three primary layers of narratives shaping your life. These stories are placed at the heart of your user profile settings and are actively evaluated by our personalization engine to filter and score your home feed, alerts, and briefs.
            </p>

            {/* Layer 1: Highest Order all life story */}
            <div
              className="subtle-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-small)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-base)',
                border: '1px solid hsl(45, 40%, 25%)',
                background: 'linear-gradient(135deg, hsl(45, 35%, 8%), var(--surface-elevated))',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: 'hsl(45, 80%, 55%)',
                    color: '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    font: 'var(--font-micro)',
                  }}>1</span>
                  <strong style={{ font: 'var(--font-body)', fontWeight: 700, color: 'hsl(45, 90%, 65%)' }}>
                    Highest Order all life story
                  </strong>
                </div>
                <span style={{ font: 'var(--font-micro)', color: 'hsl(45, 80%, 50%)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Sacred & Shared Humanity
                </span>
              </div>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                Bible, religious stories, and the shared humanity story (the highest order story).
              </p>
              <div className="text-surface" style={{ padding: 0, border: '1px solid hsl(45, 30%, 18%)', background: 'rgba(0,0,0,0.2)' }}>
                <textarea
                  rows={3}
                  placeholder="Enter the overarching sacred, spiritual, religious or human narrative that guides your overall existence..."
                  value={storyHighestOrderDraft}
                  onChange={(event) => setStoryHighestOrderDraft(event.target.value)}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    font: 'var(--font-body)',
                    padding: 'var(--space-small)',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Layer 2: Your Story */}
            <div
              className="subtle-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-small)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-base)',
                border: '1px solid hsl(160, 30%, 20%)',
                background: 'linear-gradient(135deg, hsl(160, 25%, 7%), var(--surface-elevated))',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: 'hsl(160, 80%, 45%)',
                    color: '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    font: 'var(--font-micro)',
                  }}>2</span>
                  <strong style={{ font: 'var(--font-body)', fontWeight: 700, color: 'hsl(160, 80%, 55%)' }}>
                    Your Story
                  </strong>
                </div>
                <span style={{ font: 'var(--font-micro)', color: 'hsl(160, 75%, 45%)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Personal Path & Vision
                </span>
              </div>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                Past, present, and Future WISH of life and in relation to life.
              </p>
              <div className="text-surface" style={{ padding: 0, border: '1px solid hsl(160, 25%, 15%)', background: 'rgba(0,0,0,0.2)' }}>
                <textarea
                  rows={3}
                  placeholder="Enter your personal trajectory — who you were, where you are now, and your deepest wishes/wants for your future..."
                  value={storyYoursDraft}
                  onChange={(event) => setStoryYoursDraft(event.target.value)}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    font: 'var(--font-body)',
                    padding: 'var(--space-small)',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Layer 3: The current sub-stories */}
            <div
              className="subtle-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-small)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-base)',
                border: '1px solid hsl(230, 35%, 25%)',
                background: 'linear-gradient(135deg, hsl(230, 25%, 9%), var(--surface-elevated))',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: 'hsl(230, 80%, 65%)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    font: 'var(--font-micro)',
                  }}>3</span>
                  <strong style={{ font: 'var(--font-body)', fontWeight: 700, color: 'hsl(230, 85%, 68%)' }}>
                    The current sub-stories
                  </strong>
                </div>
                <span style={{ font: 'var(--font-micro)', color: 'hsl(230, 80%, 60%)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Active Goals & Projects
                </span>
              </div>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                The current sub-stories that are connected to your current goals of life.
              </p>
              <div className="text-surface" style={{ padding: 0, border: '1px solid hsl(230, 30%, 18%)', background: 'rgba(0,0,0,0.2)' }}>
                <textarea
                  rows={3}
                  placeholder="Enter the concrete immediate projects, targets, sub-stories, and goals that you are pursuing right now..."
                  value={storySubStoriesDraft}
                  onChange={(event) => setStorySubStoriesDraft(event.target.value)}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    font: 'var(--font-body)',
                    padding: 'var(--space-small)',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', marginTop: 'var(--space-small)' }}>
              <button
                className="btn btn-primary"
                onClick={() => { void saveStoriesPreferences(); }}
                disabled={hierarchyBusy}
                style={{
                  background: 'linear-gradient(90deg, hsl(45, 80%, 45%), hsl(160, 80%, 35%), hsl(230, 80%, 45%))',
                  border: 'none',
                  color: '#fff',
                  fontWeight: '700',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                }}
              >
                {hierarchyBusy ? 'Saving Stories...' : 'Save 3 Layers of Stories'}
              </button>
            </div>

            {hierarchyMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', fontWeight: 600 }}>
                {hierarchyMessage}
              </p>
            )}

            <div className="subtle-panel" style={{ marginTop: 'var(--space-small)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Core values detected</strong>
                <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  {(hierarchyState?.coreValues || []).length ? (
                    hierarchyState.coreValues.map((value) => (
                      <span key={value} className="chip active">{value}</span>
                    ))
                  ) : (
                    <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                      No core values extracted yet.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="subtle-panel">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>History hints</strong>
                <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  {(hierarchyState?.historyHints || []).length ? (
                    hierarchyState.historyHints.map((value) => (
                      <span key={value} className="chip">{value}</span>
                    ))
                  ) : (
                    <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                      Import or sync footprint data later if you want a deeper trajectory lens.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: 'none' }}>
          <h2 className="section-title" style={{ marginBottom: 'var(--space-base)' }}>SELF Assessment & Scientific Profiler</h2>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-medium)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-small)' }}>
              Link eXplore with your results from the <strong>SELF</strong> website. Paste the 1-page gist or results summary of your assessment below. Our cognitive profiler will process it to scientifically predict and visualize your personality traits, narrative style, and cognitive states, integrating these dimensions directly into your personalized intelligence feed.
            </p>

            <div className="text-surface" style={{ padding: 0, border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
              <textarea
                rows={4}
                placeholder="Paste the 1-page gist or summary text of your SELF website results here..."
                value={selfRawDataDraft}
                onChange={(event) => setSelfRawDataDraft(event.target.value)}
                style={{
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  font: 'var(--font-body)',
                  padding: 'var(--space-small)',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => { void handleAnalyzeSelfData(); }}
                disabled={selfAnalysisBusy}
                style={{
                  background: 'linear-gradient(135deg, hsl(270, 75%, 55%), hsl(230, 80%, 50%), hsl(190, 80%, 45%))',
                  border: 'none',
                  color: '#fff',
                  fontWeight: '700',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                }}
              >
                {selfAnalysisBusy ? 'Analyzing & Syncing...' : 'Analyze & Sync SELF Profile'}
              </button>
            </div>

            {selfAnalysisMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', fontWeight: 600 }}>
                {selfAnalysisMessage}
              </p>
            )}

            {scientificProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-medium)', marginTop: 'var(--space-base)' }}>
                
                {/* 1. Personality Traits (OCEAN) */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-base)' }}>
                  <h3 style={{ font: 'var(--font-body)', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-small)' }}>
                    <span>1. Personality Profile (Big Five OCEAN)</span>
                    <span style={{ font: 'var(--font-micro)', textTransform: 'uppercase', color: 'hsl(270, 85%, 68%)', letterSpacing: '0.05em' }}>Validated Models</span>
                  </h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                    {[
                      { name: 'Openness to Experience', val: scientificProfile.personality?.openness || 0, color: 'hsl(270, 80%, 55%)' },
                      { name: 'Conscientiousness', val: scientificProfile.personality?.conscientiousness || 0, color: 'hsl(180, 80%, 45%)' },
                      { name: 'Extraversion', val: scientificProfile.personality?.extraversion || 0, color: 'hsl(35, 90%, 55%)' },
                      { name: 'Agreeableness', val: scientificProfile.personality?.agreeableness || 0, color: 'hsl(145, 80%, 45%)' },
                      { name: 'Neuroticism', val: scientificProfile.personality?.neuroticism || 0, color: 'hsl(355, 80%, 55%)' }
                    ].map((trait) => (
                      <div key={trait.name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-caption)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{trait.name}</span>
                          <span style={{ fontWeight: 700, color: trait.color }}>{trait.val}%</span>
                        </div>
                        <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${trait.val}%`, background: trait.color, borderRadius: '4px', transition: 'width 1s ease' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', padding: 'var(--space-small)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid hsl(270, 80%, 55%)', margin: 0 }}>
                    {scientificProfile.personality?.description}
                  </p>
                </div>

                {/* 2. Narrative Identity Themes (Dan McAdams model) */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-base)' }}>
                  <h3 style={{ font: 'var(--font-body)', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-small)' }}>
                    <span>2. Narrative Identity Style (McAdams Model)</span>
                    <span style={{ font: 'var(--font-micro)', textTransform: 'uppercase', color: 'hsl(145, 80%, 45%)', letterSpacing: '0.05em' }}>Life Stories</span>
                  </h3>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-tight)', marginBottom: 'var(--space-small)' }}>
                    {[
                      { label: 'Agency', val: scientificProfile.narrative?.agency || 0, desc: 'Self-mastery & impact', color: 'hsl(210, 80%, 55%)' },
                      { label: 'Communion', val: scientificProfile.narrative?.communion || 0, desc: 'Connection & dialogue', color: 'hsl(330, 80%, 55%)' },
                      { label: 'Redemption', val: scientificProfile.narrative?.redemption || 0, desc: 'Growth from adversity', color: 'hsl(145, 80%, 45%)' },
                      { label: 'Contamination', val: scientificProfile.narrative?.contamination || 0, desc: 'Fragility & ruin', color: 'hsl(15, 80%, 50%)' }
                    ].map((theme) => (
                      <div key={theme.label} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-tight)', display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', textAlign: 'center' }}>
                        <span style={{ font: 'var(--font-caption)', fontWeight: 700, color: 'var(--text-primary)' }}>{theme.label}</span>
                        <span style={{ font: 'var(--font-body)', fontWeight: 800, color: theme.color, margin: '2px 0' }}>{theme.val}%</span>
                        <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>{theme.desc}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', padding: 'var(--space-small)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid hsl(330, 80%, 55%)', margin: 0 }}>
                    {scientificProfile.narrative?.description}
                  </p>
                </div>

                {/* 3. Cognitive States & Style */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-base)' }}>
                  <h3 style={{ font: 'var(--font-body)', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-small)' }}>
                    <span>3. Cognitive State & Processing Style</span>
                    <span style={{ font: 'var(--font-micro)', textTransform: 'uppercase', color: 'hsl(35, 90%, 55%)', letterSpacing: '0.05em' }}>Intellectual Processing</span>
                  </h3>
                  
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                    {[
                      { name: 'Need for Cognition', val: scientificProfile.cognitive?.needForCognition || 0 },
                      { name: 'Processing Depth', val: scientificProfile.cognitive?.processingDepth || 0 },
                      { name: 'Lateral Exploration', val: scientificProfile.cognitive?.lateralExploration || 0 },
                      { name: 'Estimated Cognitive Load', val: scientificProfile.cognitive?.cognitiveLoad || 0 }
                    ].map((metric) => (
                      <div key={metric.name} className="chip active" style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{metric.name}:</span>
                        <strong style={{ color: 'var(--accent)' }}>{metric.val}%</strong>
                      </div>
                    ))}
                  </div>
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', padding: 'var(--space-small)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid hsl(35, 90%, 55%)', margin: 0 }}>
                    {scientificProfile.cognitive?.description}
                  </p>
                </div>

              </div>
            )}
          </div>
        </section>

        <div className="divider" />

        <section style={{ display: 'none' }}>
          <h2 className="section-title" style={{ marginBottom: 'var(--space-base)' }}>Reading preferences</h2>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-medium)' }}>
            <div className="slider-group">
              <label>
                <span>Depth</span>
                <span style={{ color: 'var(--text-tertiary)' }}>Quick to deep</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={preferenceToPercent(contentPrefs.depth_pref, 0.7)}
                onChange={(event) => setContentPrefs((current) => ({
                  ...current,
                  depth_pref: percentToPreference(event.target.value, 0.7),
                }))}
              />
            </div>

            <div className="slider-group">
              <label>
                <span>Rarity</span>
                <span style={{ color: 'var(--text-tertiary)' }}>Popular to rare</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={preferenceToPercent(contentPrefs.rarity_pref, 0.6)}
                onChange={(event) => setContentPrefs((current) => ({
                  ...current,
                  rarity_pref: percentToPreference(event.target.value, 0.6),
                }))}
              />
            </div>

            <div className="slider-group">
              <label>
                <span>Length</span>
                <span style={{ color: 'var(--text-tertiary)' }}>Any to long</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={preferenceToPercent(contentPrefs.length_pref, 0.5)}
                onChange={(event) => setContentPrefs((current) => ({
                  ...current,
                  length_pref: percentToPreference(event.target.value, 0.5),
                }))}
              />
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => { void saveContentPreferences(); }} disabled={preferenceBusy}>
                {preferenceBusy ? 'Saving...' : 'Save preferences'}
              </button>
            </div>

            {preferenceMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                {preferenceMessage}
              </p>
            )}
          </div>
        </section>

        <div className="divider" />

        {/* ──────────────────────────────────────────────────── */}
        {/* INTELLIGENCE ENGINE                                  */}
        {/* ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 'var(--space-large)' }}>
          <h2 className="section-title" style={{ marginBottom: 'var(--space-base)' }}>
            Intelligence Engine
          </h2>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginBottom: 'var(--space-base)' }}>
            Teach eXplore what you care about. Interests and goals shape every recommendation.
          </p>

          {/* Interests */}
          <div className="card" style={{ marginBottom: 'var(--space-base)', background: 'var(--surface)' }}>
            <p style={{ font: 'var(--font-label)', color: 'var(--text-primary)', marginBottom: 'var(--space-tight)' }}>
              Interests
            </p>
            {intelligenceProfile?.interests?.length > 0 ? (
              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', marginBottom: 'var(--space-tight)' }}>
                {intelligenceProfile.interests.map((int) => (
                  <span key={int.interest_name || int.id} className="chip">
                    {int.interest_name}
                    {int.weight != null && (
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 4, fontSize: '0.75em' }}>
                        {Math.round(Number(int.weight) * 100)}%
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-tight)' }}>
                No interests yet.
              </p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <input
                id="pref-new-interest"
                className="text-surface"
                style={{ flex: 1, minWidth: 160, fontSize: '0.85rem', padding: '6px 10px', borderRadius: 8 }}
                placeholder="e.g. Machine Learning"
                value={newInterest}
                onChange={(e) => setNewInterest(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleAddInterest()}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleAddInterest()}
                disabled={intLoading || !newInterest.trim()}
              >
                Add
              </button>
            </div>
          </div>

          {/* Goals */}
          <div className="card" style={{ marginBottom: 'var(--space-base)', background: 'var(--surface)' }}>
            <p style={{ font: 'var(--font-label)', color: 'var(--text-primary)', marginBottom: 'var(--space-tight)' }}>
              Learning Goals
            </p>
            {intelligenceProfile?.goals?.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 var(--space-tight)' }}>
                {intelligenceProfile.goals.map((g) => (
                  <li key={g.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 0', font: 'var(--font-body)', color: 'var(--text-primary)',
                    }}
                  >
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: g.priority === 'high' ? 'var(--accent)' : g.priority === 'low' ? 'var(--text-tertiary)' : 'var(--warning)',
                      }}
                    />
                    {g.goal_text}
                    <span style={{ marginLeft: 'auto', font: 'var(--font-caption)', color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                      {g.priority}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-tight)' }}>
                No goals yet.
              </p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <input
                id="pref-new-goal"
                className="text-surface"
                style={{ flex: 1, minWidth: 200, fontSize: '0.85rem', padding: '6px 10px', borderRadius: 8 }}
                placeholder="e.g. Understand quantum computing"
                value={newGoalText}
                onChange={(e) => setNewGoalText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleAddGoal()}
              />
              <select
                id="pref-goal-priority"
                className="text-surface"
                style={{ fontSize: '0.85rem', padding: '6px 10px', borderRadius: 8 }}
                value={newGoalPriority}
                onChange={(e) => setNewGoalPriority(e.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleAddGoal()}
                disabled={intLoading || !newGoalText.trim()}
              >
                Add Goal
              </button>
            </div>
          </div>

          {/* Manual Memory */}
          <div className="card" style={{ marginBottom: 'var(--space-base)', background: 'var(--surface)' }}>
            <p style={{ font: 'var(--font-label)', color: 'var(--text-primary)', marginBottom: 'var(--space-tight)' }}>
              Add a Memory
            </p>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-tight)' }}>
              Record something important to your profile — context that helps eXplore recommend better.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <input
                id="pref-new-memory"
                className="text-surface"
                style={{ flex: 1, minWidth: 220, fontSize: '0.85rem', padding: '6px 10px', borderRadius: 8 }}
                placeholder="e.g. I work in biotech and travel often"
                value={newMemoryText}
                onChange={(e) => setNewMemoryText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleProposeMemory()}
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void handleProposeMemory()}
                disabled={intLoading || !newMemoryText.trim()}
              >
                Save Memory
              </button>
            </div>
          </div>

          {/* Memory Questions */}
          {memoryQuestions.length > 0 && (
            <div className="card" style={{ background: 'var(--surface)' }}>
              <p style={{ font: 'var(--font-label)', color: 'var(--text-primary)', marginBottom: 'var(--space-tight)' }}>
                Clarifying Questions
              </p>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-base)' }}>
                Answer these to help eXplore understand you better.
              </p>
              {memoryQuestions.map((q) => (
                <div key={q.id} style={{ marginBottom: 'var(--space-base)' }}>
                  <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginBottom: 4 }}>
                    {q.question_text}
                  </p>
                  <div style={{ display: 'flex', gap: 'var(--space-tight)' }}>
                    <input
                      className="text-surface"
                      style={{ flex: 1, fontSize: '0.85rem', padding: '6px 10px', borderRadius: 8 }}
                      placeholder="Your answer…"
                      value={memAnswers[q.id] || ''}
                      onChange={(e) => setMemAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && void handleAnswerQuestion(q.id)}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleAnswerQuestion(q.id)}
                      disabled={intLoading || !(memAnswers[q.id] || '').trim()}
                    >
                      Submit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {intMessage && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginTop: 'var(--space-tight)' }}>
              {intMessage}
            </p>
          )}
        </section>

        <div className="divider" />

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <h2 className="section-title" style={{ marginBottom: 'var(--space-base)' }}>Theme preference</h2>

          <div className="card" style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', background: 'var(--surface)' }}>
            {['ambient', 'light', 'dark'].map((pref) => {
              const active = themePreference === pref;
              return (
                <button
                  key={pref}
                  type="button"
                  className={`btn ${active ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setThemePreference(pref)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {pref}
                </button>
              );
            })}
          </div>
        </section>

        <div className="divider" />

        <section style={{ marginBottom: 'var(--space-large)' }}>
          <h2 className="section-title" style={{ marginBottom: 'var(--space-base)' }}>Account</h2>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginBottom: 'var(--space-base)' }}>
            {user?.email || 'Guest mode'}
          </p>
          {user ? (
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--error)' }}
                onClick={() => { void signOut(); }}
              >
                Sign Out
              </button>
              <a
                className="btn btn-secondary btn-sm"
                href="/account-deletion/"
                target="_blank"
                rel="noreferrer"
              >
                Request account deletion
              </a>
            </div>
          ) : (
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
              Google and email sign-in are available once Supabase is configured.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
