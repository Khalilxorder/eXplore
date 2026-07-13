'use client';
import { useCallback, useRef, useState, useEffect, useEffectEvent } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { AuthProvider, useAuth } from './components/AuthProvider';
import AppShell from './components/AppShell';
import PublicLanding from './components/PublicLanding';
import HomeScreen from './components/HomeScreen';
import VideoLibraryScreen from './components/VideoLibraryScreen';
import SearchScreen from './components/SearchScreen';
import DetailScreen from './components/DetailScreen';

import SavedScreen from './components/SavedScreen';
import SourcesScreen from './components/SourcesScreen';
import TopicsScreen from './components/TopicsScreen';
import SourceWebScreen from './components/SourceWebScreen';
import HistoryScreen from './components/HistoryScreen';
import TemplateScreen from './components/TemplateScreen';
import OnboardingScreen from './components/OnboardingScreen';
import PreferencesScreen from './components/PreferencesScreen';
import AuthStatusScreen from './components/AuthStatusScreen';
import AuthScreen from './components/AuthScreen';
import AnomalyFeed from './components/AnomalyFeed';

import SubscriptionScreen from './components/SubscriptionScreen';
import FamilyScreen from './components/FamilyScreen';
import ReferralScreen from './components/ReferralScreen';
import WrittenNewsBriefScreen from './components/WrittenNewsBriefScreen';
import CultureScreen from './components/CultureScreen';
import OpportunitiesScreen from './components/OpportunitiesScreen';
import AddInterestScreen from './components/AddInterestScreen';
import MailIntelligenceScreen from './components/MailIntelligenceScreen';
import FormulationScreen from './components/FormulationScreen';
import ExperienceScreen from './components/ExperienceScreen';
import SharedExperienceScreen from './components/SharedExperienceScreen';
import ExperimentScreen from './components/ExperimentScreen';
import MusicStatsScreen from './components/MusicStatsScreen';
import PriorityRadarMonitor from './components/PriorityRadarMonitor';
import PriorityRadarPhoneSetup from './components/PriorityRadarPhoneSetup';
import ServiceWorkerRegistrar from './components/ServiceWorkerRegistrar';
import AiChatPanel, { AiChatToggleButton } from './components/AiChatPanel';
import {
  AUTH_REQUIRED_EVENT,
  fetchHistory,
  saveTemplateWorkspace,
  updateNotificationPreferences,
  updatePreferences,
} from './lib/api';
import MessagingHubScreen from './components/MessagingHubScreen';
import PriorityRadarScreen from './components/PriorityRadarScreen';
import PriorityRadarDetailScreen from './components/PriorityRadarDetailScreen';
import NobelPrizesScreen from './components/NobelPrizesScreen';
import CollectionsScreen from './components/CollectionsScreen';
import WeeklyDigestScreen from './components/WeeklyDigestScreen';
import ScientistToolScreen from './components/ScientistToolScreen';
import RecommenderAdmin from './components/RecommenderAdmin';
import { addAndroidBackButtonListener, addAppUrlOpenListener, isNativeShell } from './lib/mobile';
import { attachPriorityRadarNotificationListeners } from './lib/pushNotifications';
import { parsePriorityRadarUrl, PRIORITY_RADAR_OPEN_EVENT } from './lib/priorityRadarRouting';
import {
  parsePrivateMessengerUrl,
  PRIVATE_MESSENGER_OPEN_EVENT,
} from './lib/privateMessengerRouting';
import {
  clearMetaInboxParamsFromBrowser,
  parseMetaInboxUrl,
} from './lib/metaInboxRouting';
import { savePriorityRadarSettings, loadPriorityRadarSettings } from './lib/alertRadar';
import { normalizeStringList } from './lib/intelligenceProfile';
import {
  loadGuestDismissedIds,
  recordGuestHistory,
  rememberGuestDismissedId,
} from './lib/guestPersistence';

const ONBOARDING_STORAGE_KEY = 'explore-onboarding-complete';
const ONBOARDING_PROFILE_STORAGE_KEY = 'explore-onboarding-profile';
const ONBOARDING_PROFILE_SYNCED_USER_KEY = 'explore-onboarding-synced-user';
const EXPLORE_FEED_REFRESH_EVENT = 'explore-feed-refresh';
const DEFAULT_AI_COMPANIES = ['anthropic', 'openai', 'google', 'xai'];
const BUILD_META_URL = '/__explore_build.json';
const EXPLORE_SECTION_ITEMS = [
  { screen: 'home', label: 'News', title: 'Latest news' },
  { screen: 'videos', label: 'Videos', title: 'YouTube videos' },
  { screen: 'culture', label: 'Culture', title: 'Culture' },
  { screen: 'opportunities', label: 'Jobs', title: 'Jobs and scholarships', className: 'chip--opportunities' },
  { screen: 'scientist-tool', label: 'Scientist', title: 'Scientist Tool' },
  { screen: 'nobel-prizes', label: 'Nobel', title: 'Nobel Prizes', className: 'chip--nobel' },
  { screen: 'digest', label: 'Digest', title: 'Weekly Digest', className: 'chip--digest' },
  { screen: 'written-news', label: 'Written', title: 'Written Brief' },
  { screen: 'topics', label: 'Topics', title: 'Monitored topics', className: 'chip--topics' },
  { screen: 'music-stats', label: 'Music', title: 'Music Stats', className: 'chip--music' },
];

function normalizeOnboardingProfile(profile = {}) {
  const selectedTopicNames = Array.isArray(profile.selectedTopicNames)
    ? profile.selectedTopicNames.filter(Boolean)
    : [];
  const selectedTopics = Array.isArray(profile.selectedTopics)
    ? profile.selectedTopics.filter(Boolean)
    : [];
  const topicText = `${selectedTopicNames.join(' ')} ${selectedTopics.join(' ')}`.toLowerCase();
  const focusSource = profile.focus && typeof profile.focus === 'object' ? profile.focus : {};
  const aiFocus = focusSource.ai !== undefined
    ? focusSource.ai !== false
    : profile.watchAi !== false && (profile.watchAi === true || profile.includeAi === true || /\b(ai|anthropic|openai|gemini|grok|xai|claude)\b/.test(topicText));
  const geoFocus = focusSource.geo !== undefined
    ? focusSource.geo !== false
    : profile.watchGeo === true || profile.includeGeo === true || /\b(iran|israel|qatar|war|missile|regional risk)\b/.test(topicText);

  const companySelections = profile.companySelections && typeof profile.companySelections === 'object'
    ? profile.companySelections
    : {};
  const normalizedCompanies = Array.from(new Set(
    [
      ...(Array.isArray(profile.aiCompanies) ? profile.aiCompanies : []),
      ...Object.entries(companySelections)
        .filter(([, enabled]) => enabled)
        .map(([companyKey]) => companyKey),
    ]
      .map((entry) => String(entry || '').trim().toLowerCase())
      .map((entry) => entry === 'gemini' ? 'google' : entry === 'grok' ? 'xai' : entry)
      .filter((entry) => DEFAULT_AI_COMPANIES.includes(entry))
  ));
  const aiCompanies = normalizedCompanies.length ? normalizedCompanies : DEFAULT_AI_COMPANIES;

  const summaryStyle = String(
    profile.summaryStyle
      || profile.briefingStylePreset
      || profile.contentPref
      || 'balanced'
  ).trim().toLowerCase();
  const notificationUrgency = String(
    profile.notificationUrgency
      || profile.alertUrgency
      || 'important'
  ).trim().toLowerCase();
  const currentGoal = String(profile.currentGoal || profile.goal || '').trim();
  const trustedChannel = String(profile.trustedChannel || '').trim();
  const peopleOfInterest = normalizeStringList(profile.peopleOfInterest || []);
  const primaryFocus = String(profile.primaryFocus || profile.focusPriority || '').trim().toLowerCase();

  return {
    ...profile,
    selectedTopics,
    selectedTopicNames,
    focus: {
      ai: aiFocus || !geoFocus,
      geo: geoFocus,
    },
    aiCompanies,
    summaryStyle,
    notificationUrgency,
    currentGoal,
    trustedChannel,
    peopleOfInterest,
    primaryFocus,
  };
}

function getAiCompanyLabels(companies = []) {
  const labelMap = {
    anthropic: 'Anthropic / Claude',
    openai: 'OpenAI / ChatGPT',
    google: 'Gemini / DeepMind',
    xai: 'Grok / xAI',
  };

  return companies
    .map((companyKey) => labelMap[companyKey] || companyKey)
    .filter(Boolean);
}

function buildOnboardingWorkspace(profile = {}) {
  const normalized = normalizeOnboardingProfile(profile);
  const focusLabel = normalized.selectedTopicNames.length
    ? normalized.selectedTopicNames.slice(0, 4).join(', ')
    : normalized.focus.ai && normalized.focus.geo
      ? 'AI releases and Iran / regional risk'
      : normalized.focus.ai
        ? 'AI releases'
        : normalized.focus.geo
          ? 'Iran / regional risk'
          : 'the highest-signal updates';
  const companyLabels = getAiCompanyLabels(normalized.aiCompanies);
  const watchQuestions = [];

  if (normalized.focus.ai) {
    watchQuestions.push(
      `Which official releases from ${companyLabels.join(', ')} actually change what I can use, buy, or build right now?`
    );
  }

  if (normalized.focus.geo) {
    watchQuestions.push('Which Iran / regional-risk updates change real safety, access, travel, energy, or decision risk?');
  }

  if (normalized.currentGoal) {
    watchQuestions.push(`Which updates matter most for this current goal: ${normalized.currentGoal}?`);
  }

  for (const person of normalized.peopleOfInterest.slice(0, 3)) {
    watchQuestions.push(`What are ${person}'s latest interviews, statements, or public moves signaling right now?`);
  }

  watchQuestions.push(
    normalized.trustedChannel
      ? `When ${normalized.trustedChannel} spots something important, what deeper shift does it signal?`
      : `Which ${focusLabel} updates are genuinely important instead of just popular?`
  );

  let briefingStyle = [
    'Use short direct titles.',
    'Lead with why it matters in plain language.',
    'Cut hype, filler, and repeated context.',
  ];

  if (normalized.summaryStyle === 'deep' || normalized.contentPref === 'long') {
    briefingStyle = [
      'Use short direct titles.',
      'Prefer deeper context over speed.',
      'Explain the shift clearly before moving on.',
    ];
  } else if (normalized.summaryStyle === 'compact' || normalized.contentPref === 'short') {
    briefingStyle = [
      'Use short direct titles.',
      'Lead with the takeaway first.',
      'Keep summaries compact and cut filler.',
    ];
  }

  if (normalized.focus.ai) {
    briefingStyle.push(`Separate official releases from ${companyLabels.join(', ')} from broader AI chatter.`);
  }

  if (normalized.focus.geo) {
    briefingStyle.push('Treat Iran and nearby escalation as a serious risk lane, not generic geopolitics.');
  }

  if (normalized.notificationUrgency === 'instant') {
    briefingStyle.push('Show exact release timing when available.');
  }

  return {
    watchQuestions: [...new Set(watchQuestions)].slice(0, 6),
    briefingStyle: [...new Set(briefingStyle)].slice(0, 6),
    workspaceMemory: {
      priorityTopics: [...new Set([
        ...(normalized.focus.ai ? ['AI releases', 'New AI tools I can use now'] : []),
        ...(normalized.focus.geo ? ['Iran / regional risk'] : []),
        ...(normalized.currentGoal ? [normalized.currentGoal] : []),
      ])].slice(0, 8),
      avoidTopics: ['Hype', 'Celebrity AI chatter', 'Repeated context'],
      trackedCompanies: normalized.focus.ai ? normalized.aiCompanies : [],
      peopleOfInterest: normalized.peopleOfInterest,
      sourcePreferences: {
        officialFirst: true,
        written: true,
        socialVideo: true,
        socialPhoto: false,
        trustedSourcesOnly: true,
      },
      alertStyle: normalized.notificationUrgency === 'instant'
        ? 'strict'
        : normalized.notificationUrgency === 'important'
          ? 'balanced'
          : 'broad',
    },
  };
}

function buildOnboardingPreferences(profile = {}) {
  const normalized = normalizeOnboardingProfile(profile);
  const basePreferences = normalized.summaryStyle === 'deep' || normalized.contentPref === 'long'
    ? {
        depth_pref: 0.85,
        rarity_pref: 0.65,
        length_pref: 0.85,
      }
    : normalized.summaryStyle === 'compact' || normalized.contentPref === 'short'
      ? {
          depth_pref: 0.55,
          rarity_pref: 0.55,
          length_pref: 0.3,
        }
      : {
          depth_pref: 0.7,
          rarity_pref: 0.6,
          length_pref: 0.5,
        };

  const interests = [
    ...(normalized.focus.ai ? ['AI releases'] : []),
    ...(normalized.focus.geo ? ['Iran risk'] : []),
    ...getAiCompanyLabels(normalized.aiCompanies),
    ...normalized.selectedTopicNames,
    ...(normalized.currentGoal ? [normalized.currentGoal] : []),
  ];

  return {
    ...basePreferences,
    interests: [...new Set(interests)].slice(0, 12),
  };
}

function buildOnboardingRadarSettings(profile = {}) {
  const normalized = normalizeOnboardingProfile(profile);
  const companyFlags = Object.fromEntries(
    DEFAULT_AI_COMPANIES.map((companyKey) => [companyKey, normalized.aiCompanies.includes(companyKey)])
  );
  const enabled = normalized.notificationUrgency !== 'off';

  return {
    profile: 'release-watch',
    enabled,
    pollMinutes: normalized.notificationUrgency === 'instant' ? 5 : 10,
    categories: {
      ai: normalized.focus.ai,
      geo: normalized.focus.geo,
    },
    releaseWatch: {
      enabled: normalized.focus.ai,
      minImportance: normalized.notificationUrgency === 'instant' ? 'major' : 'important',
      companies: companyFlags,
    },
  };
}

function buildOnboardingNotificationPreferences(profile = {}) {
  const normalized = normalizeOnboardingProfile(profile);
  return {
    alerts_enabled: normalized.notificationUrgency !== 'off',
    ai_enabled: normalized.focus.ai,
    geo_enabled: normalized.focus.geo,
    push_enabled: false,
    local_fallback_enabled: normalized.notificationUrgency !== 'off',
    ai_release_watch_enabled: normalized.focus.ai,
    ai_release_watch_companies: normalized.aiCompanies,
    ai_release_watch_min_importance: normalized.notificationUrgency === 'instant' ? 'major' : 'important',
  };
}

function getTabForScreen(nextScreen = 'home') {
  if ([
    'videos',
    'culture',
    'opportunities',
    'scientist-tool',
    'nobel-prizes',
    'digest',
    'written-news',
    'topics',
    'music-stats',
    'experience',
    'shared-experience',
  ].includes(nextScreen)) {
    return 'explore';
  } else if (nextScreen === 'messages') {
    return 'messages';
  }

  if (nextScreen === 'preferences' || [
    'sources',
    'history',
    'subscription',
    'family',
    'referral',
    'formulation',
    'experiment',
    'collections',
    'template',
    'saved',
    'search',
  ].includes(nextScreen)) {
    return 'you';
  }

  return 'explore';
}

function getRootScreenForTab(tab = 'explore') {
  if (tab === 'template') {
    return 'template';
  }

  if (tab === 'search') {
    return 'search';
  }

  if (tab === 'saved') {
    return 'saved';
  }

  if (tab === 'messages') {
    return 'messages';
  }

  if (tab === 'you') {
    return 'preferences';
  }

  return 'home';
}

function getNavigationSignature(snapshot = {}) {
  return [
    snapshot.screen || '',
    snapshot.activeTab || '',
    snapshot.selectedItem?.id || '',
    snapshot.selectedRadarAlert?.id || '',
    snapshot.radarReturnScreen || '',
    snapshot.detailReturnScreen || '',
    snapshot.pendingInboxTarget?.screen || '',
    snapshot.anomalyMode ? '1' : '0',
  ].join('|');
}

function refreshExploreFeed({ behavior = 'smooth' } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.scrollTo({ top: 0, behavior });
  window.dispatchEvent(new CustomEvent(EXPLORE_FEED_REFRESH_EVENT));
}

function ExploreApp() {
  const { user, loading, isAdmin } = useAuth();
  const [skippedAuth, setSkippedAuth] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [activeTab, setActiveTab] = useState('explore');
  const [screen, setScreen] = useState('home');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedRadarAlert, setSelectedRadarAlert] = useState(null);
  const [radarReturnScreen, setRadarReturnScreen] = useState('home');
  const [detailReturnScreen, setDetailReturnScreen] = useState('home');
  const [pendingInboxTarget, setPendingInboxTarget] = useState(null);
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [anomalyMode, setAnomalyMode] = useState(false);
  const [hiddenItemIds, setHiddenItemIds] = useState([]);
  const [buildSyncMessage, setBuildSyncMessage] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState(null);

  const handleAskAiAboutItem = (item) => {
    setChatContext({
      title: item?.title || '',
      summary: item?.summary || item?.reason || '',
      source: item?.source || '',
      url: item?.url || '',
      prefilledQuestion: item?.prefilledQuestion || '',
    });
    setChatOpen(true);
  };
  const navigationHistoryRef = useRef([]);
  const navigationRestoreInProgressRef = useRef(false);
  const showExploreTopTabs = screen === 'home'
    || screen === 'videos'
    || screen === 'culture'
    || screen === 'opportunities'
    || screen === 'scientist-tool'
    || screen === 'nobel-prizes'
    || screen === 'digest'
    || screen === 'written-news'
    || screen === 'topics'
    || screen === 'music-stats';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let active = true;
    const nextOnboarded = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';

    // Tell Capgo that the new update loaded successfully and didn't crash
    if (isNativeShell() && CapacitorUpdater && typeof CapacitorUpdater.notifyAppReady === 'function') {
      try {
        CapacitorUpdater.notifyAppReady().catch((e) => console.warn('CapacitorUpdater promise reject:', e));
      } catch (err) {
        console.warn('CapacitorUpdater sync error:', err);
      }
    }

    queueMicrotask(() => {
      if (!active) {
        return;
      }

      setOnboarded(nextOnboarded);
      setOnboardingReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;
    const currentBuildId = String(process.env.NEXT_PUBLIC_BUILD_ID || '').trim();

    void (async () => {
      try {
        const response = await fetch(`${BUILD_META_URL}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          return;
        }

        const buildMeta = await response.json();
        if (cancelled) {
          return;
        }

        const remoteBuildId = String(buildMeta?.buildId || '').trim();
        if (!remoteBuildId) {
          return;
        }

        if (!currentBuildId || remoteBuildId === currentBuildId) {
          setBuildSyncMessage('');
          return;
        }

        setBuildSyncMessage('A newer build is ready. Refresh once or use Reset local cache in You if this screen still looks old.');
      } catch (error) {
        if (!cancelled) {
          setBuildSyncMessage('');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleAuthRequired = () => {
      navigationHistoryRef.current = [];
      navigationRestoreInProgressRef.current = false;
      setSkippedAuth(false);
      setScreen('home');
      setActiveTab('explore');
      setSelectedItem(null);
      setSelectedRadarAlert(null);
      setRadarReturnScreen('home');
      setDetailReturnScreen('home');
      setPendingInboxTarget(null);
      setHiddenItemIds(loadGuestDismissedIds());
    };

    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      queueMicrotask(() => {
        if (!cancelled) {
          setHiddenItemIds(loadGuestDismissedIds());
        }
      });
      return undefined;
    }

    void (async () => {
      try {
        const payload = await fetchHistory('dismissed');
        if (!cancelled && Array.isArray(payload?.items)) {
          setHiddenItemIds(payload.items.map((entry) => entry.id).filter(Boolean));
        }
      } catch (error) {
        if (!cancelled) {
          setHiddenItemIds([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id || !onboarded) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      try {
        const lastSyncedUserId = window.localStorage.getItem(ONBOARDING_PROFILE_SYNCED_USER_KEY);
        if (lastSyncedUserId === String(user.id)) {
          return;
        }

        const rawProfile = window.localStorage.getItem(ONBOARDING_PROFILE_STORAGE_KEY);
        if (!rawProfile) {
          return;
        }

        const parsedProfile = JSON.parse(rawProfile);
        if (parsedProfile?.skipped) {
          return;
        }

        const normalizedProfile = normalizeOnboardingProfile(parsedProfile);
        const workspace = buildOnboardingWorkspace(normalizedProfile);
        const preferences = buildOnboardingPreferences(normalizedProfile);
        const radarSettings = buildOnboardingRadarSettings(normalizedProfile);
        const notificationPreferences = buildOnboardingNotificationPreferences(normalizedProfile);
        const results = await Promise.allSettled([
          saveTemplateWorkspace(workspace),
          savePriorityRadarSettings(radarSettings),
          updatePreferences(preferences),
          updateNotificationPreferences(notificationPreferences),
        ]);

        if (!cancelled && results.every((result) => result.status === 'fulfilled')) {
          window.localStorage.setItem(ONBOARDING_PROFILE_SYNCED_USER_KEY, String(user.id));
        }
      } catch {
        // Keep local onboarding state intact so a future sign-in can retry sync.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onboarded, user?.id]);

  const captureNavigationSnapshot = useCallback(() => ({
    screen,
    activeTab,
    selectedItem,
    selectedRadarAlert,
    radarReturnScreen,
    detailReturnScreen,
    pendingInboxTarget,
    anomalyMode,
  }), [
    screen,
    activeTab,
    selectedItem,
    selectedRadarAlert,
    radarReturnScreen,
    detailReturnScreen,
    pendingInboxTarget,
    anomalyMode,
  ]);

  const pushNavigationSnapshot = useCallback(() => {
    if (navigationRestoreInProgressRef.current) {
      return;
    }

    const snapshot = captureNavigationSnapshot();
    const history = navigationHistoryRef.current;
    const last = history[history.length - 1];

    if (!last || getNavigationSignature(last) !== getNavigationSignature(snapshot)) {
      history.push(snapshot);
    }
  }, [captureNavigationSnapshot]);

  const restoreNavigationSnapshot = useCallback((snapshot) => {
    if (!snapshot) {
      return false;
    }

    navigationRestoreInProgressRef.current = true;
    setScreen(snapshot.screen || 'home');
    setActiveTab(snapshot.activeTab || 'explore');
    setSelectedItem(snapshot.selectedItem || null);
    setSelectedRadarAlert(snapshot.selectedRadarAlert || null);
    setRadarReturnScreen(snapshot.radarReturnScreen || 'home');
    setDetailReturnScreen(snapshot.detailReturnScreen || 'home');
    setPendingInboxTarget(snapshot.pendingInboxTarget || null);
    setAnomalyMode(Boolean(snapshot.anomalyMode));

    setTimeout(() => {
      navigationRestoreInProgressRef.current = false;
    }, 0);

    return true;
  }, []);

  const routeMetaInboxTarget = useEffectEvent((target) => {
    if (!target?.screen) {
      return;
    }

    pushNavigationSnapshot();
    setActiveTab('explore');
    setSelectedItem(null);
    setSelectedRadarAlert(null);
    setPendingInboxTarget(target);
    setScreen('messages');
  });

  const routePriorityRadarTarget = useEffectEvent((target) => {
    if (!target?.screen) {
      return;
    }

    const nextReturnScreen = screen === 'preferences' ? 'preferences' : 'home';
    pushNavigationSnapshot();

    if (target.screen === 'priority-radar-detail') {
      setActiveTab('explore');
      setRadarReturnScreen(nextReturnScreen);
      setSelectedItem(null);
      setSelectedRadarAlert(target.alertId ? { id: target.alertId } : null);
      setPendingInboxTarget(null);
      setScreen('priority-radar-detail');
      return;
    }

    setActiveTab('explore');
    setRadarReturnScreen(nextReturnScreen);
    setSelectedItem(null);
    setSelectedRadarAlert(null);
    setPendingInboxTarget(null);
    setSelectedTopicId('');
    setScreen('priority-radar');
  });

  const routePrivateMessengerTarget = useEffectEvent((target) => {
    if (!target?.screen) {
      return;
    }

    pushNavigationSnapshot();
    setActiveTab('messages');
    setSelectedItem(null);
    setSelectedRadarAlert(null);
    setPendingInboxTarget(target);
    setScreen('messages');
  });

  const routeIncomingUrl = useEffectEvent((rawUrl, { clearBrowserUrl = false } = {}) => {
    const privateMessengerTarget = parsePrivateMessengerUrl(rawUrl);
    if (privateMessengerTarget) {
      routePrivateMessengerTarget(privateMessengerTarget);
      return true;
    }

    const metaTarget = parseMetaInboxUrl(rawUrl);
    if (metaTarget) {
      if (clearBrowserUrl) {
        clearMetaInboxParamsFromBrowser();
      }

      routeMetaInboxTarget(metaTarget);
      return true;
    }

    const radarTarget = parsePriorityRadarUrl(rawUrl);
    if (radarTarget) {
      routePriorityRadarTarget(radarTarget);
      return true;
    }

    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let isActive = true;
    const disposers = [];

    const handlePriorityRadarOpen = (event) => {
      routePriorityRadarTarget(event?.detail || null);
    };
    const handlePrivateMessengerOpen = (event) => {
      routePrivateMessengerTarget(event?.detail || null);
    };

    window.addEventListener(PRIORITY_RADAR_OPEN_EVENT, handlePriorityRadarOpen);
    window.addEventListener(PRIVATE_MESSENGER_OPEN_EVENT, handlePrivateMessengerOpen);

    void (async () => {
      routeIncomingUrl(window.location.href, { clearBrowserUrl: true });
      const [removeNotificationListeners, removeAppListener] = await Promise.all([
        attachPriorityRadarNotificationListeners(),
        addAppUrlOpenListener((event) => {
          routeIncomingUrl(event?.url);
        }),
      ]);

      if (!isActive) {
        if (typeof removeNotificationListeners === 'function') {
          removeNotificationListeners();
        }
        if (typeof removeAppListener === 'function') {
          removeAppListener();
        }
        return;
      }

      disposers.push(removeNotificationListeners, removeAppListener);
    })();

    return () => {
      isActive = false;
      window.removeEventListener(PRIORITY_RADAR_OPEN_EVENT, handlePriorityRadarOpen);
      window.removeEventListener(PRIVATE_MESSENGER_OPEN_EVENT, handlePrivateMessengerOpen);
      disposers.forEach((dispose) => {
        if (typeof dispose === 'function') {
          dispose();
        }
      });
    };
  }, []);

  // Show auth screen if not logged in and not skipped
  const isAuthenticated = Boolean(user || skippedAuth);

  const handleNavigate = (target, data) => {
    pushNavigationSnapshot();

    if (target === 'detail' && data) {
      if (!user?.id) {
        recordGuestHistory(data, 'view');
      }
      setDetailReturnScreen(screen);
      setSelectedItem(data);
      setSelectedRadarAlert(null);
      setPendingInboxTarget(null);
      setScreen('detail');
    } else if (target === 'priority-radar') {
      setRadarReturnScreen(screen === 'preferences' ? 'preferences' : 'home');
      setSelectedItem(null);
      setSelectedRadarAlert(null);
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('priority-radar');
    } else if (target === 'priority-radar-detail') {
      if (screen !== 'priority-radar' && screen !== 'priority-radar-detail') {
        setRadarReturnScreen(screen === 'preferences' ? 'preferences' : 'home');
      }

      setSelectedItem(null);
      setSelectedRadarAlert(data || null);
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('priority-radar-detail');
    } else if (target === 'template') {
      setPendingInboxTarget(null);
      setActiveTab('you');
      setScreen('template');
    } else if (target === 'videos') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('videos');
    } else if (target === 'culture') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('culture');
    } else if (target === 'scientist-tool') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('scientist-tool');
    } else if (target === 'written-news') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('written-news');
    } else if (target === 'search') {
      setPendingInboxTarget(null);
      setActiveTab('you');
      setScreen('search');
    } else if (target === 'saved') {
      setPendingInboxTarget(null);
      setActiveTab('you');
      setScreen('saved');
    } else if (target === 'messages') {
      setActiveTab('messages');
      setPendingInboxTarget(null);
      setScreen('messages');
    } else if (target === 'topics') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setSelectedTopicId('');
      setScreen('topics');
    } else if (target === 'source-web') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setSelectedTopicId(String(data?.topicId || data?.topic_id || ''));
      setScreen('source-web');
    } else if (target === 'anomaly-radar') {
      setAnomalyMode(true);
    } else if (target === 'nobel-prizes') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('nobel-prizes');
    } else if (target === 'collections') {
      setPendingInboxTarget(null);
      setActiveTab('you');
      setScreen('collections');
    } else if (target === 'digest') {
      setPendingInboxTarget(null);
      setActiveTab('explore');
      setScreen('digest');
    } else if (target === 'mail') {
      setPendingInboxTarget(null);
      setActiveTab('you');
      setScreen('mail');
    } else if (target === 'recommender-admin' && !isAdmin) {
      setPendingInboxTarget(null);
      setScreen('preferences');
    } else if (['sources', 'topics', 'source-web', 'history', 'subscription', 'family', 'referral', 'formulation', 'experience', 'shared-experience', 'experiment', 'music-stats', 'recommender-admin', 'auth-status'].includes(target)) {
      setPendingInboxTarget(null);
      setScreen(target);
    }
  };

  const handleRequireAuth = useCallback(() => {
    setSkippedAuth(false);
    setPendingInboxTarget(null);
    setSelectedItem(null);
    setSelectedRadarAlert(null);
  }, []);

  const handleDismissItem = (item) => {
    if (!item?.id) {
      return;
    }

    if (!user?.id) {
      rememberGuestDismissedId(item.id);
      recordGuestHistory(item, 'dismiss');
    }

    setHiddenItemIds((current) => (
      current.includes(item.id) ? current : [...current, item.id]
    ));
  };

  const handleOnboardingComplete = async (profile = {}) => {
    const normalizedProfile = normalizeOnboardingProfile(profile);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_PROFILE_STORAGE_KEY, JSON.stringify(normalizedProfile));
    }

    const workspace = buildOnboardingWorkspace(normalizedProfile);
    const preferences = buildOnboardingPreferences(normalizedProfile);
    const radarSettings = buildOnboardingRadarSettings(normalizedProfile);
    const notificationPreferences = buildOnboardingNotificationPreferences(normalizedProfile);
    const operations = [
      saveTemplateWorkspace(workspace),
      savePriorityRadarSettings(radarSettings),
    ];

    if (user) {
      operations.push(updatePreferences(preferences));
      operations.push(updateNotificationPreferences(notificationPreferences));
    }

    await Promise.allSettled(operations);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    }
    setOnboarded(true);
  };

  const handleOnboardingSkip = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
      window.localStorage.setItem(ONBOARDING_PROFILE_STORAGE_KEY, JSON.stringify({ skipped: true }));
    }
    setOnboarded(true);
  };

  const handleTabChange = (tab) => {
    const nextScreen = getRootScreenForTab(tab);
    if (tab === activeTab && screen === nextScreen) {
      if (tab === 'explore') {
        refreshExploreFeed();
      }
      return;
    }

    pushNavigationSnapshot();
    setPendingInboxTarget(null);
    setActiveTab(tab);
    setScreen(nextScreen);
    setSelectedItem(null);
    setSelectedRadarAlert(null);
  };

  const handleHomePress = useCallback(() => {
    if (screen === 'home' && activeTab === 'explore') {
      refreshExploreFeed();
      return;
    }

    refreshExploreFeed();

    pushNavigationSnapshot();
    setPendingInboxTarget(null);
    setActiveTab('explore');
    setScreen('home');
    setSelectedItem(null);
    setSelectedRadarAlert(null);
  }, [activeTab, pushNavigationSnapshot, screen]);

  const handleExploreSectionPress = useCallback((nextScreen) => {
    if (nextScreen === 'home') {
      handleHomePress();
      return;
    }

    if (nextScreen === 'template') {
      setActiveTab('you');
    } else if (nextScreen === 'messages') {
      setActiveTab('messages');
    } else {
      setActiveTab('explore');
    }
    setScreen(nextScreen);
  }, [handleHomePress]);

  const handleBack = useCallback(() => {
    const previousState = navigationHistoryRef.current.pop();
    if (restoreNavigationSnapshot(previousState)) {
      return;
    }

    if (screen === 'detail') {
      const returnScreen = detailReturnScreen || 'home';
      setSelectedItem(null);
      setScreen(returnScreen);
      setActiveTab(getTabForScreen(returnScreen));
      return;
    }

    if (screen === 'priority-radar-detail') {
      setScreen('priority-radar');
      return;
    }

    if (screen === 'priority-radar') {
      setSelectedRadarAlert(null);
      setScreen(radarReturnScreen);
      setActiveTab(radarReturnScreen === 'preferences' ? 'you' : 'explore');
      return;
    }

    if (screen === 'saved' || screen === 'collections' || screen === 'template' || screen === 'topics' || screen === 'source-web') {
      setScreen('preferences');
      setActiveTab('you');
    } else if (['sources', 'topics', 'source-web', 'history', 'subscription', 'family', 'referral', 'formulation', 'experience', 'shared-experience', 'experiment', 'auth-status'].includes(screen)) {
      setScreen('preferences');
    } else {
      setScreen('home');
      setActiveTab('explore');
      setSelectedItem(null);
      setSelectedRadarAlert(null);
    }
  }, [detailReturnScreen, radarReturnScreen, restoreNavigationSnapshot, screen]);

  const handleAndroidBack = useEffectEvent(() => {
    const isRootScreen = screen === 'home'
      && activeTab === 'explore'
      && !selectedItem
      && !selectedRadarAlert
      && !pendingInboxTarget
      && !anomalyMode
      && navigationHistoryRef.current.length === 0;

    if (isRootScreen) {
      return false;
    }

    handleBack();
    return true;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;
    let removeBackListener = null;

    void (async () => {
      removeBackListener = await addAndroidBackButtonListener(handleAndroidBack);

      if (cancelled && typeof removeBackListener === 'function') {
        removeBackListener();
      }
    })();

    return () => {
      cancelled = true;
      if (typeof removeBackListener === 'function') {
        removeBackListener();
      }
    };
  }, []);

  const showLoading = loading || !onboardingReady;
  const showAppContent = !showLoading && isAuthenticated && onboarded;
  const showAuthContent = !showLoading && !isAuthenticated;
  const showOnboardingContent = !showLoading && isAuthenticated && !onboarded;
  const showPublicLanding = false;
  const useAuthPanelContainer = !showAppContent;

  useEffect(() => {
    if (!showAppContent || typeof window === 'undefined') {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [showAppContent]);

  const topBarTitle = screen === 'messages'
    ? 'Messages'
    : screen === 'home'
      ? 'Latest news'
      : screen === 'videos'
        ? 'YouTube videos'
      : screen === 'scientist-tool'
        ? 'Scientist Tool'
      : screen === 'opportunities'
        ? 'Opportunities Radar'
      : screen === 'experience'
        ? 'Xperience'
      : screen === 'shared-experience'
        ? 'Shared Experience'
      : screen === 'mail'
        ? 'Mail Intelligence'
      : screen === 'priority-radar' || screen === 'priority-radar-detail'
      ? 'Priority Radar'
    : screen === 'written-news'
      ? 'Written Brief'
      : screen === 'music-stats'
      ? 'Music Stats'
    : screen === 'saved'
      ? 'Saved'
      : screen === 'search'
        ? 'Search'
    : screen === 'topics'
      ? 'Topics'
    : screen === 'source-web'
      ? 'Source Web'
    : ({
      explore: 'eXplore',
      videos: 'Videos',
      template: 'News Rules',
      you: 'You',
    }[activeTab] || 'eXplore');

  return (
    <>
      {showPublicLanding ? (
        <PublicLanding
          authenticated={isAuthenticated}
          loading={showLoading}
          onOpenApp={() => setSkippedAuth(true)}
        />
      ) : null}

      <div
        id="auth-panel"
        className={useAuthPanelContainer ? 'container' : undefined}
        style={useAuthPanelContainer ? { paddingBottom: 'var(--space-xl)' } : undefined}
      >
        {showLoading ? (
          <div
            className="card page-enter"
            style={{
              marginTop: 'var(--space-small)',
              textAlign: 'center',
              padding: 'var(--space-2xl)',
              background: 'var(--surface)',
            }}
          >
            <h2 style={{ font: 'var(--font-h2)', marginBottom: 'var(--space-small)' }}>Loading eXplore</h2>
            <p style={{ color: 'var(--text-secondary)', font: 'var(--font-body)' }}>
              Getting your feed readyâ€¦
            </p>
          </div>
        ) : showAuthContent ? (
          <AuthScreen embedded onSkip={() => setSkippedAuth(true)} />
        ) : showOnboardingContent ? (
          <OnboardingScreen
            onComplete={handleOnboardingComplete}
            onSkip={handleOnboardingSkip}
          />
        ) : showAppContent ? (
          <>
            <PriorityRadarMonitor />
            <PriorityRadarPhoneSetup />

            {screen !== 'messages' ? (
              <>
                <AiChatPanel
                  isOpen={chatOpen}
                  onClose={() => setChatOpen(false)}
                  initialContext={chatContext}
                  onContextConsumed={() => setChatContext(null)}
                />
                <AiChatToggleButton
                  onClick={() => setChatOpen((v) => !v)}
                  isOpen={chatOpen}
                />
              </>
            ) : null}
            {anomalyMode && <AnomalyFeed onClose={() => setAnomalyMode(false)} />}
            <AppShell activeTab={activeTab} title={topBarTitle} onTabChange={handleTabChange} onBack={handleBack} onHomePress={handleHomePress} screen={screen} shellVariant={screen === 'messages' ? 'inbox' : 'default'} radarActive={loadPriorityRadarSettings().enabled === true} onOpenRadar={() => handleNavigate('priority-radar')} onAskAi={() => setChatOpen((v) => !v)} chatOpen={chatOpen}>
            {buildSyncMessage ? (
                <div className="container" style={{ paddingTop: 'var(--space-small)' }}>
                  <div className="card" style={{ marginBottom: 'var(--space-small)' }}>
                    <strong>Update available</strong>
                    <p style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>A new version of eXplore is ready. Refresh the page to update.</p>
                  </div>
                </div>
              ) : null}
              {showExploreTopTabs ? (
                <div className="container explore-section-nav">
                  <div className="scroll-row explore-section-row" aria-label="Explore sections">
                    {EXPLORE_SECTION_ITEMS.map((item) => (
                      <button
                        key={item.screen}
                        type="button"
                        title={item.title}
                        aria-label={item.title}
                        className={`chip ${item.className || ''} ${screen === item.screen ? 'active' : ''}`}
                        onClick={() => handleExploreSectionPress(item.screen)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {screen === 'home' && (
                <HomeScreen
                  hiddenItemIds={hiddenItemIds}
                  onDismissItem={handleDismissItem}
                  onNavigate={handleNavigate}
                  onAskAi={handleAskAiAboutItem}
                />
              )}
              {screen === 'add-interest' && (
                <AddInterestScreen onBack={handleBack} />
              )}
              {screen === 'videos' && (
                <VideoLibraryScreen onNavigate={handleNavigate} />
              )}
               {screen === 'opportunities' && <OpportunitiesScreen />}
               {screen === 'mail' && <MailIntelligenceScreen onBack={handleBack} />}
               {screen === 'scientist-tool' && <ScientistToolScreen />}
              {screen === 'nobel-prizes' && (
                <NobelPrizesScreen onBack={handleBack} onNavigate={handleNavigate} />
              )}
              {screen === 'digest' && (
                <WeeklyDigestScreen onBack={handleBack} />
              )}
              {screen === 'culture' && (
                <CultureScreen onBack={handleBack} />
              )}
              {screen === 'messages' && (
                <MessagingHubScreen
                  onBack={handleBack}
                  onRequireAuth={handleRequireAuth}
                  initialOpenTarget={pendingInboxTarget}
                  onConsumeInitialTarget={() => setPendingInboxTarget(null)}
                />
              )}
              {screen === 'priority-radar' && <PriorityRadarScreen onBack={handleBack} onNavigate={handleNavigate} />}
              {screen === 'priority-radar-detail' && (
                <PriorityRadarDetailScreen
                  alertId={selectedRadarAlert?.id || ''}
                  initialAlert={selectedRadarAlert}
                  onBack={handleBack}
                  onAskAi={handleAskAiAboutItem}
                />
              )}
              {screen === 'written-news' && (
                <WrittenNewsBriefScreen
                  hiddenItemIds={hiddenItemIds}
                  onBack={handleBack}
                  onDismissItem={handleDismissItem}
                  onNavigate={handleNavigate}
                />
              )}
              {screen === 'music-stats' && <MusicStatsScreen />}
              {screen === 'template' && <TemplateScreen />}
              {screen === 'search' && (
                <SearchScreen
                  hiddenItemIds={hiddenItemIds}
                  onBack={handleBack}
                  onDismissItem={handleDismissItem}
                  onNavigate={handleNavigate}
                />
              )}
              {screen === 'detail' && (
                <DetailScreen
                  item={selectedItem}
                  onBack={handleBack}
                  onDismissItem={handleDismissItem}
                  onAskAi={handleAskAiAboutItem}
                />
              )}
              {screen === 'saved' && (
                <SavedScreen
                  hiddenItemIds={hiddenItemIds}
                  onBack={handleBack}
                  onNavigate={handleNavigate}
                />
              )}
              {screen === 'collections' && <CollectionsScreen onBack={handleBack} />}
              {screen === 'preferences' && <PreferencesScreen onBack={handleBack} onNavigate={handleNavigate} />}
              {screen === 'sources' && <SourcesScreen onBack={handleBack} />}
              {screen === 'topics' && <TopicsScreen onBack={handleBack} onOpenSourceWeb={(topicId) => handleNavigate('source-web', { topicId })} />}
              {screen === 'source-web' && <SourceWebScreen topicId={selectedTopicId} onBack={handleBack} />}
              {screen === 'history' && <HistoryScreen onBack={handleBack} />}
              {screen === 'subscription' && <SubscriptionScreen onBack={handleBack} />}
              {screen === 'family' && <FamilyScreen onBack={handleBack} />}
              {screen === 'referral' && <ReferralScreen onBack={handleBack} />}
              {screen === 'formulation' && <FormulationScreen onBack={handleBack} />}
              {screen === 'experience' && <ExperienceScreen onBack={handleBack} />}
              {screen === 'shared-experience' && <SharedExperienceScreen onBack={handleBack} />}
              {screen === 'experiment' && <ExperimentScreen onBack={handleBack} />}
              {screen === 'recommender-admin' && <RecommenderAdmin onBack={handleBack} />}
              {screen === 'auth-status' && <AuthStatusScreen onBack={handleBack} />}
            </AppShell>
          </>
        ) : null}
      </div>
    </>
  );
}

export default function Home() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ServiceWorkerRegistrar />
        <ExploreApp />
      </AuthProvider>
    </ThemeProvider>
  );
}
