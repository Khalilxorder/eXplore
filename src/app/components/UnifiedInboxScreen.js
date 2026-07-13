'use client';

import { startTransition, useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { ArrowLeftIcon, SearchIcon } from './Icons';
import {
  disconnectMetaConnection,
  fetchMetaAuthorizeUrl,
  fetchMetaConversationMessages,
  fetchMetaInboxOverview,
  saveMetaConnection,
  sendMetaConversationMessage,
} from '../lib/api';
import { openExternalUrl } from '../lib/external';
import { META_INBOX_OPEN_EVENT } from '../lib/metaInboxRouting';

const CHANNELS = {
  instagram: {
    label: 'Instagram',
    headline: 'Professional inbox',
    toneClass: 'is-instagram',
    description: 'Use guided OAuth first, then choose the linked Facebook Page for your Instagram Professional account.',
    fields: [
      { key: 'display_name', label: 'Display name', placeholder: '@yourbrand', secret: false },
      { key: 'access_token', label: 'Page access token', placeholder: 'EAAG...', secret: true },
      { key: 'page_id', label: 'Facebook Page ID', placeholder: '1234567890', secret: false },
      { key: 'instagram_account_id', label: 'Instagram business account ID', placeholder: '1784...', secret: false },
    ],
  },
  messenger: {
    label: 'Facebook Messenger',
    headline: 'Page inbox',
    toneClass: 'is-messenger',
    description: 'Use guided OAuth to discover managed Pages, then finish setup by selecting the Page that should receive Messenger threads.',
    fields: [
      { key: 'display_name', label: 'Page name', placeholder: 'Explore Studio', secret: false },
      { key: 'access_token', label: 'Page access token', placeholder: 'EAAG...', secret: true },
      { key: 'page_id', label: 'Facebook Page ID', placeholder: '1029384756', secret: false },
    ],
  },
  whatsapp: {
    label: 'WhatsApp',
    headline: 'Business platform',
    toneClass: 'is-whatsapp',
    description: 'Authorize with Meta, choose the WhatsApp Business account, then select the phone number that should send and receive threads.',
    fields: [
      { key: 'display_name', label: 'Business name', placeholder: 'Explore Studio', secret: false },
      { key: 'access_token', label: 'Permanent access token', placeholder: 'EAAJ...', secret: true },
      { key: 'business_account_id', label: 'WhatsApp business account ID', placeholder: '3245...', secret: false },
      { key: 'phone_number_id', label: 'Phone number ID', placeholder: '1098...', secret: false },
    ],
  },
  telegram: {
    label: 'Telegram',
    headline: 'Manual/Direct Chat',
    toneClass: 'is-telegram',
    description: 'Telegram backend integration is currently not active. Save your username to create a manual fallback path.',
    fallback: true,
    appUrl: 'tg://resolve?domain=',
    webUrl: 'https://t.me/',
    fields: [
      { key: 'username', label: 'Telegram Username', placeholder: 'telegram_username', secret: false }
    ],
  },
  slack: {
    label: 'Slack',
    headline: 'Manual/Direct Chat',
    toneClass: 'is-slack',
    description: 'Slack backend integration is currently not active. Save your workspace to create a manual fallback path.',
    fallback: true,
    appUrl: 'slack://open?team=',
    webUrl: 'https://slack.com',
    fields: [
      { key: 'workspace', label: 'Slack Workspace Domain', placeholder: 'slack-workspace', secret: false }
    ],
  },
};

function buildEmptyForms() {
  return Object.keys(CHANNELS).reduce((accumulator, channel) => {
    accumulator[channel] = {};
    CHANNELS[channel].fields.forEach((field) => {
      accumulator[channel][field.key] = '';
    });
    return accumulator;
  }, {});
}

function loadLocalConnections() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem('explore-manual-connections') || '{}');
  } catch {
    return {};
  }
}

function mergeConnectionsWithLocal(connections) {
  const local = loadLocalConnections();
  const next = [...connections];

  Object.keys(CHANNELS).forEach((channel) => {
    if (CHANNELS[channel].fallback && !next.some((c) => c.channel === channel)) {
      next.push(createFallbackConnection(channel));
    }
  });

  return next.map((conn) => {
    const channelConfig = CHANNELS[conn.channel];
    if (channelConfig?.fallback) {
      const localData = local[conn.channel];
      const hasValue = localData && Object.values(localData).some((val) => String(val || '').trim());
      if (hasValue) {
        return {
          ...conn,
          status: 'ready',
          setup_state: 'ready',
          can_send: false,
          manual_handoff_ready: true,
          capabilities: {
            read_conversations: false,
            read_messages: false,
            send: false,
            reply: false,
            manual_handoff: true,
            limitation: 'Local-only manual handoff: eXplore copies text and opens the external app; it does not sync or send through this provider.',
          },
          display_name: Object.values(localData)[0] || '',
          ...localData,
        };
      }
    }
    return conn;
  });
}

function buildFormsFromOverview(overview) {
  const nextForms = buildEmptyForms();
  const local = loadLocalConnections();

  (overview?.connections || []).forEach((connection) => {
    nextForms[connection.channel] = {
      ...nextForms[connection.channel],
      display_name: connection.display_name || '',
      page_id: connection.page_id || '',
      instagram_account_id: connection.instagram_account_id || '',
      business_account_id: connection.business_account_id || '',
      phone_number_id: connection.phone_number_id || '',
      access_token: '',
    };
  });

  Object.keys(CHANNELS).forEach((channel) => {
    if (CHANNELS[channel].fallback && local[channel]) {
      nextForms[channel] = {
        ...nextForms[channel],
        ...local[channel],
      };
    }
  });

  return nextForms;
}

function createFallbackConnection(channel) {
  return {
    channel,
    label: CHANNELS[channel].label,
    status: 'disconnected',
    setup_state: 'disconnected',
    display_name: '',
    access_token_masked: '',
    page_id: '',
    instagram_account_id: '',
    business_account_id: '',
    phone_number_id: '',
    scopes: [],
    selection_options: {},
    missing_fields: CHANNELS[channel].fields.map((field) => field.key),
    can_send: false,
    manual_handoff_ready: false,
    capabilities: CHANNELS[channel].fallback
      ? {
          read_conversations: false,
          read_messages: false,
          send: false,
          reply: false,
          manual_handoff: true,
          limitation: 'No backend provider adapter is active for this channel.',
        }
      : {},
    connected_at: null,
    last_webhook_at: null,
    last_sync_at: null,
    updated_at: null,
  };
}

function getInitials(name) {
  return String(name || 'GM')
    .split(' ')
    .slice(0, 2)
    .map((segment) => segment[0])
    .join('')
    .toUpperCase();
}

function formatRelativeTime(value) {
  if (!value) {
    return 'now';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'now';
  }

  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.round(hours / 24)}d`;
}

function formatStatusLabel(status) {
  switch (status) {
    case 'selection_required':
      return 'Selection required';
    case 'needs_setup':
      return 'Needs setup';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Disconnected';
  }
}

function formatActivityLabel(label, value) {
  if (!value) {
    return `${label}: not yet seen`;
  }

  return `${label}: ${formatRelativeTime(value)} ago`;
}

function describeConnectionState(connection, config) {
  switch (connection?.setup_state) {
    case 'ready':
      return `${config.label} is ready for live webhook threads and outbound sends.`;
    case 'selection_required':
      return `OAuth finished. Choose the right ${config.label === 'WhatsApp' ? 'business account and phone number' : 'Page'} below to finish setup.`;
    case 'needs_setup':
      return connection?.missing_fields?.length
        ? `Still needed: ${connection.missing_fields.join(', ')}`
        : 'Some required fields are still missing.';
    case 'error':
      return 'This connection needs attention before it can go live.';
    default:
      return 'Not connected yet. Start with Meta OAuth or use the advanced fields if you are doing admin setup.';
  }
}

function getOverviewHeadline({ user, loadingOverview, overview }) {
  if (!user) {
    return 'Sign in to manage live Meta channels.';
  }

  if (loadingOverview && !overview) {
    return 'Loading Meta inbox readiness...';
  }

  if (overview?.status === 'live') {
    return 'At least one Meta channel is fully live.';
  }

  if (overview?.status === 'partial') {
    return 'Meta setup is partway complete.';
  }

  return 'Meta app credentials are still missing.';
}

function getOverviewDescription({ user, loadingOverview, overview }) {
  if (!user) {
    return 'The inbox is tied to your account, so sign-in is required before Instagram, Facebook Messenger, or WhatsApp can be connected.';
  }

  if (loadingOverview && !overview) {
    return 'Checking app credentials, webhook status, and channel setup now.';
  }

  if (overview?.status === 'live') {
    return 'Live threads will appear here as soon as webhook deliveries arrive, and ready channels can send replies straight through the backend.';
  }

  if (overview?.status === 'partial') {
    return 'The app can already guide setup, but one or more credentials or channel selections still need to be completed before every inbox action is live.';
  }

  return 'Meta OAuth, the webhook verify token, login config, backend URL, or the connection encryption secret are still incomplete.';
}

function getReturnBanner(target) {
  const label = CHANNELS[target?.channel]?.label || 'Meta';

  if (target?.status === 'ready') {
    return `${label} returned to eXplore and is ready for live inbox use.`;
  }

  if (target?.status === 'selection_required') {
    return `${label} returned to eXplore. Pick the discovered Page or account below to finish setup.`;
  }

  if (target?.status === 'needs_setup') {
    return `${label} returned to eXplore, but it still needs additional setup fields.`;
  }

  return 'Meta returned to eXplore. Refreshing the live inbox state now.';
}

export default function UnifiedInboxScreen({ onBack, initialOpenTarget = null, onConsumeInitialTarget }) {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewLoadFailed, setOverviewLoadFailed] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusTone, setStatusTone] = useState('muted');
  const [forms, setForms] = useState(buildEmptyForms());
  const [advancedOpen, setAdvancedOpen] = useState({});
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draftsByThread, setDraftsByThread] = useState({});
  const [liveMessages, setLiveMessages] = useState({});
  const [fallbackMessages, setFallbackMessages] = useState({});

  const setBanner = useCallback((message, tone = 'muted') => {
    setStatusMessage(message);
    setStatusTone(tone);
  }, []);

  const applyOverview = useCallback((payload, { preserveDraftInputs = true } = {}) => {
    setOverview(payload);
    setForms((current) => {
      const next = buildFormsFromOverview(payload);
      if (!preserveDraftInputs) {
        return next;
      }

      const merged = buildEmptyForms();
      Object.keys(next).forEach((channel) => {
        merged[channel] = {
          ...next[channel],
          access_token: current?.[channel]?.access_token || '',
        };
      });
      return merged;
    });
  }, []);

  const refreshOverview = useCallback(async ({ silent = false, preserveDraftInputs = true } = {}) => {
    if (!user) {
      setOverview(null);
      setForms(buildEmptyForms());
      setOverviewLoadFailed(false);
      return null;
    }

    setLoadingOverview(true);
    setOverviewLoadFailed(false);
    try {
      const payload = await fetchMetaInboxOverview();

      if (!payload) {
        setOverviewLoadFailed(true);
        if (!silent) {
          setBanner('Could not load the Meta inbox overview.', 'error');
        }
        return null;
      }

      applyOverview(payload, { preserveDraftInputs });
      setOverviewLoadFailed(false);
      return payload;
    } catch {
      setOverviewLoadFailed(true);
      if (!silent) {
        setBanner('Could not load the Meta inbox overview.', 'error');
      }
      return null;
    } finally {
      setLoadingOverview(false);
    }
  }, [applyOverview, setBanner, user]);

  useEffect(() => {
    if (!user) {
      startTransition(() => {
        setOverview(null);
        setForms(buildEmptyForms());
        setSelectedThreadId('');
        setLiveMessages({});
        setLoadingOverview(false);
        setOverviewLoadFailed(false);
      });
      return undefined;
    }

    let active = true;

    void (async () => {
      setLoadingOverview(true);
      setOverviewLoadFailed(false);
      try {
        const payload = await fetchMetaInboxOverview();
        if (!active) {
          return;
        }

        if (payload) {
          applyOverview(payload, { preserveDraftInputs: false });
          setOverviewLoadFailed(false);
        } else {
          setOverviewLoadFailed(true);
        }
      } catch {
        if (active) {
          setOverviewLoadFailed(true);
          setBanner('Could not load the Meta inbox overview.', 'error');
        }
      } finally {
        if (active) {
          setLoadingOverview(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [applyOverview, setBanner, user]);

  useEffect(() => {
    if (!initialOpenTarget?.screen) {
      return;
    }

    queueMicrotask(() => {
      setBanner(getReturnBanner(initialOpenTarget), 'success');
      void refreshOverview({ silent: true, preserveDraftInputs: false });
      onConsumeInitialTarget?.();
    });
  }, [initialOpenTarget, onConsumeInitialTarget, refreshOverview, setBanner]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleMetaReturn = (event) => {
      const target = event?.detail || null;
      setBanner(getReturnBanner(target), 'success');
      void refreshOverview({ silent: true, preserveDraftInputs: false });
    };

    const handleFocus = () => {
      if (user) {
        void refreshOverview({ silent: true });
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && user) {
        void refreshOverview({ silent: true });
      }
    };

    window.addEventListener(META_INBOX_OPEN_EVENT, handleMetaReturn);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener(META_INBOX_OPEN_EVENT, handleMetaReturn);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshOverview, setBanner, user]);

  const rawConnections = overview?.connections || (!user ? Object.keys(CHANNELS).map((channel) => createFallbackConnection(channel)) : []);
  const connections = mergeConnectionsWithLocal(rawConnections);
  const connectionMap = Object.fromEntries(connections.map((connection) => [connection.channel, connection]));
  const threads = useMemo(() => {
    const list = [...(overview?.conversations || [])];
    Object.entries(CHANNELS).forEach(([channel, config]) => {
      if (config.fallback) {
        const conn = connectionMap[channel];
        const val = conn?.status === 'ready' ? conn.display_name : '';
        if (val) {
          list.push({
            id: `fallback-${channel}`,
            channel: channel,
            participant_name: config.label === 'Telegram' ? `@${val}` : `${val}.slack.com`,
            last_message_at: new Date().toISOString(),
            preview: 'Manual fallback channel is ready.',
            unread_count: 0,
            can_send: false,
            manual_handoff: true,
          });
        }
      }
    });
    return list;
  }, [overview, connectionMap]);
  const activeThreadId = selectedThreadId && threads.some((thread) => thread.id === selectedThreadId)
    ? selectedThreadId
    : (threads[0]?.id || '');

  useEffect(() => {
    if (!activeThreadId || liveMessages[activeThreadId]) {
      return undefined;
    }
    if (String(activeThreadId).startsWith('fallback-')) {
      return undefined;
    }

    let active = true;
    void (async () => {
      try {
        const payload = await fetchMetaConversationMessages(activeThreadId);
        if (active && payload?.messages) {
          setLiveMessages((current) => ({
            ...current,
            [activeThreadId]: payload.messages.map((message) => ({
              id: message.id,
              direction: message.direction,
              text: message.text,
              meta: formatRelativeTime(message.sent_at),
            })),
          }));
        }
      } catch {
        if (active) {
          setLiveMessages((current) => ({
            ...current,
            [activeThreadId]: [],
          }));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [activeThreadId, liveMessages]);

  const selectedThread = threads.find((thread) => thread.id === activeThreadId) || null;
  const selectedMessages = useMemo(() => {
    if (!selectedThread) return [];
    if (CHANNELS[selectedThread.channel]?.fallback) {
      return fallbackMessages[selectedThread.id] || [];
    }
    return liveMessages[activeThreadId] || [];
  }, [selectedThread, activeThreadId, liveMessages, fallbackMessages]);
  const draft = activeThreadId ? (draftsByThread[activeThreadId] || '') : '';
  const app = overview?.app || null;
  const connectedCount = connections.filter((connection) => connection.status !== 'disconnected').length;
  const readyCount = connections.filter((connection) => connection.status === 'ready').length;
  const inboxState = !user
    ? 'Partial / setup needed'
    : loadingOverview && !overview
      ? 'Partial / setup needed'
      : overviewLoadFailed
        ? 'Partial / setup needed'
      : overview?.status === 'live'
        ? 'Live'
        : overview?.status === 'partial'
          ? 'Partial / setup needed'
          : 'No live data yet';

  const updateForm = (channel, key, value) => {
    setForms((current) => ({
      ...current,
      [channel]: {
        ...current[channel],
        [key]: value,
      },
    }));
  };

  const handleSelectionChange = (channel, key, value) => {
    const connection = connectionMap[channel] || createFallbackConnection(channel);

    if ((channel === 'instagram' || channel === 'messenger') && key === 'page_id') {
      const selectedPage = (connection.selection_options?.pages || []).find((page) => page.id === value);
      setForms((current) => ({
        ...current,
        [channel]: {
          ...current[channel],
          page_id: value,
          instagram_account_id: channel === 'instagram'
            ? (selectedPage?.instagram_business_account_id || '')
            : current[channel]?.instagram_account_id || '',
        },
      }));
      return;
    }

    if (channel === 'whatsapp' && key === 'business_account_id') {
      const selectedAccount = (connection.selection_options?.business_accounts || []).find((account) => account.id === value);
      const phoneNumbers = selectedAccount?.phone_numbers || [];
      setForms((current) => ({
        ...current,
        whatsapp: {
          ...current.whatsapp,
          business_account_id: value,
          phone_number_id: phoneNumbers.length === 1 ? phoneNumbers[0].id : '',
        },
      }));
      return;
    }

    updateForm(channel, key, value);
  };

  const handleAuthorize = async (channel) => {
    setBusyKey(`authorize-${channel}`);
    try {
      const payload = await fetchMetaAuthorizeUrl(channel);

      if (!payload?.auth_url) {
        setBanner(payload?.error || 'Meta authorization URL could not be created.', 'error');
        return;
      }

      await openExternalUrl(payload.auth_url);
      setBanner(`Opened Meta authorization for ${CHANNELS[channel].label}. eXplore will refresh this card when you return.`, 'success');
    } catch {
      setBanner(`Could not start ${CHANNELS[channel].label} authorization right now.`, 'error');
    } finally {
      setBusyKey('');
    }
  };

  const handleSaveConnection = async (channel) => {
    if (CHANNELS[channel].fallback) {
      setBusyKey(`save-${channel}`);
      try {
        const local = loadLocalConnections();
        local[channel] = forms[channel];
        localStorage.setItem('explore-manual-connections', JSON.stringify(local));
        await refreshOverview({ preserveDraftInputs: true });
        setBanner(`${CHANNELS[channel].label} fallback configuration saved.`, 'success');
      } catch (err) {
        setBanner(`Could not save ${CHANNELS[channel].label} right now.`, 'error');
      } finally {
        setBusyKey('');
      }
      return;
    }

    setBusyKey(`save-${channel}`);
    try {
      const payload = await saveMetaConnection(channel, forms[channel]);

      if (!payload?.connection) {
        setBanner(payload?.error || `Could not save ${CHANNELS[channel].label}.`, 'error');
        return;
      }

      await refreshOverview({ preserveDraftInputs: false });

      if (payload.connection.can_send) {
        setBanner(`${CHANNELS[channel].label} is ready for live sending.`, 'success');
        return;
      }

      if (payload.connection.setup_state === 'selection_required') {
        setBanner(`${CHANNELS[channel].label} saved. Finish the guided selection to make it live.`, 'success');
        return;
      }

      setBanner(`${CHANNELS[channel].label} details saved.`, 'success');
    } catch {
      setBanner(`Could not save ${CHANNELS[channel].label} right now.`, 'error');
    } finally {
      setBusyKey('');
    }
  };

  const handleDisconnect = async (channel) => {
    if (CHANNELS[channel].fallback) {
      setBusyKey(`disconnect-${channel}`);
      try {
        const local = loadLocalConnections();
        delete local[channel];
        localStorage.setItem('explore-manual-connections', JSON.stringify(local));
        setForms((current) => {
          const next = { ...current };
          next[channel] = {};
          CHANNELS[channel].fields.forEach((f) => { next[channel][f.key] = ''; });
          return next;
        });
        await refreshOverview({ preserveDraftInputs: true });
        setBanner(`${CHANNELS[channel].label} disconnected.`, 'muted');
      } catch (err) {
        setBanner(`Could not disconnect ${CHANNELS[channel].label} right now.`, 'error');
      } finally {
        setBusyKey('');
      }
      return;
    }

    setBusyKey(`disconnect-${channel}`);
    try {
      const payload = await disconnectMetaConnection(channel);

      if (!payload?.success) {
        setBanner(payload?.error || `Could not disconnect ${CHANNELS[channel].label}.`, 'error');
        return;
      }

      setLiveMessages({});
      await refreshOverview({ preserveDraftInputs: false });
      setBanner(`${CHANNELS[channel].label} disconnected.`, 'muted');
    } catch {
      setBanner(`Could not disconnect ${CHANNELS[channel].label} right now.`, 'error');
    } finally {
      setBusyKey('');
    }
  };

  const handleSend = async () => {
    const nextDraft = draft.trim();
    if (!nextDraft || !selectedThread) {
      return;
    }

    if (CHANNELS[selectedThread.channel]?.fallback) {
      setBusyKey('send-live');
      try {
        await navigator.clipboard.writeText(nextDraft);
        const messageId = `msg_${Date.now()}`;
        const newMsg = {
          id: messageId,
          direction: 'outbound',
          text: nextDraft,
          meta: formatRelativeTime(new Date()),
        };
        setFallbackMessages((current) => ({
          ...current,
          [selectedThread.id]: [...(current[selectedThread.id] || []), newMsg],
        }));
        setDraftsByThread((current) => ({
          ...current,
          [selectedThread.id]: '',
        }));
        setBanner('Message copied to clipboard! Opening external communication app.', 'success');

        const config = CHANNELS[selectedThread.channel];
        const conn = connectionMap[selectedThread.channel];
        const val = conn?.status === 'ready' ? conn.display_name : '';
        const targetUrl = val ? `${config.appUrl}${val}` : config.webUrl;
        await openExternalUrl(targetUrl);
      } catch (err) {
        setBanner('Could not copy message or open app.', 'error');
      } finally {
        setBusyKey('');
      }
      return;
    }

    if (!selectedThread.can_send) {
      setBanner('This thread is read-only until its channel is fully ready.', 'muted');
      return;
    }

    setBusyKey('send-live');
    try {
      const payload = await sendMetaConversationMessage(selectedThread.id, nextDraft);

      if (!payload?.success) {
        setBanner(payload?.error || 'Live send failed.', 'error');
        return;
      }

      setDraftsByThread((current) => ({
        ...current,
        [selectedThread.id]: '',
      }));
      setLiveMessages((current) => {
        const next = { ...current };
        delete next[selectedThread.id];
        return next;
      });
      await refreshOverview({ silent: true });
      setBanner('Message sent through the live Meta connection.', 'success');
    } catch {
      setBanner('Live send failed.', 'error');
    } finally {
      setBusyKey('');
    }
  };

  const canAuthorize = Boolean(
    user
      && app?.auth_ready
      && app?.login_config_ready
      && app?.backend_public_url_ready
  );

  const renderGuidedSetup = (channel, connection) => {
    if (channel === 'instagram' || channel === 'messenger') {
      const pages = connection?.selection_options?.pages || [];
      if (!pages.length) {
        return null;
      }

      const selectedPage = pages.find((page) => page.id === (forms[channel]?.page_id || '')) || null;

      return (
        <div className="meta-selection-stack">
          <label className="meta-connection-field">
            <span>{channel === 'instagram' ? 'Linked Facebook Page' : 'Managed Facebook Page'}</span>
            <select
              value={forms[channel]?.page_id || ''}
              onChange={(event) => handleSelectionChange(channel, 'page_id', event.target.value)}
            >
              <option value="">Select a Page</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name || page.id}
                </option>
              ))}
            </select>
          </label>

          {channel === 'instagram' && selectedPage && (
            <div className="meta-selection-summary">
              {selectedPage.instagram_username
                ? `Linked Instagram account: @${selectedPage.instagram_username}`
                : 'This Facebook Page does not report a linked Instagram business account yet.'}
            </div>
          )}
        </div>
      );
    }

    if (channel === 'whatsapp') {
      const businessAccounts = connection?.selection_options?.business_accounts || [];
      if (!businessAccounts.length) {
        return null;
      }

      const selectedAccount = businessAccounts.find(
        (account) => account.id === (forms.whatsapp?.business_account_id || ''),
      ) || null;
      const phoneNumbers = selectedAccount?.phone_numbers || [];

      return (
        <div className="meta-selection-stack">
          <label className="meta-connection-field">
            <span>WhatsApp business account</span>
            <select
              value={forms.whatsapp?.business_account_id || ''}
              onChange={(event) => handleSelectionChange('whatsapp', 'business_account_id', event.target.value)}
            >
              <option value="">Select an account</option>
              {businessAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.business_name || account.name || account.id}
                </option>
              ))}
            </select>
          </label>

          <label className="meta-connection-field">
            <span>Phone number</span>
            <select
              value={forms.whatsapp?.phone_number_id || ''}
              onChange={(event) => handleSelectionChange('whatsapp', 'phone_number_id', event.target.value)}
              disabled={!selectedAccount}
            >
              <option value="">{selectedAccount ? 'Select a phone number' : 'Choose an account first'}</option>
              {phoneNumbers.map((phoneNumber) => (
                <option key={phoneNumber.id} value={phoneNumber.id}>
                  {phoneNumber.display_phone_number || phoneNumber.verified_name || phoneNumber.id}
                </option>
              ))}
            </select>
          </label>

          {selectedAccount && !phoneNumbers.length && (
            <div className="meta-selection-summary">
              This business account did not return any phone numbers from Meta yet.
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const renderConversationPlaceholder = () => {
    if (!user) {
      return (
        <div className="meta-conversation-placeholder">
          <strong>Sign in to load the live inbox.</strong>
          <span>The Meta connection state, thread list, and sending controls stay locked until your account is available.</span>
        </div>
      );
    }

    if (loadingOverview && !overview) {
      return (
        <div className="meta-conversation-placeholder">
          <strong>Loading live inbox status...</strong>
          <span>Checking app credentials, channel setup, and existing conversations now.</span>
        </div>
      );
    }

    if (overviewLoadFailed && !overview) {
      return (
        <div className="meta-conversation-placeholder">
          <strong>Live inbox state could not be loaded.</strong>
          <span>Reconnect the backend or sign in again before treating any Meta channel state here as current.</span>
        </div>
      );
    }

    if (overview?.status === 'unavailable') {
      return (
        <div className="meta-conversation-placeholder">
          <strong>Meta app credentials are still missing.</strong>
          <span>Finish the backend Meta env setup before this inbox can go live on your phone.</span>
        </div>
      );
    }

    if ((overview?.app?.setup_required_count || 0) > 0 || connectedCount > readyCount) {
      return (
        <div className="meta-conversation-placeholder">
          <strong>Finish channel setup to unlock live threads.</strong>
          <span>Use the channel cards to choose the right Page, business account, or phone number, then webhook deliveries will create the first threads here.</span>
        </div>
      );
    }

    return (
      <div className="meta-conversation-placeholder">
        <strong>Ready, but no conversations yet.</strong>
        <span>Live threads begin when a webhook delivery arrives or when you send after the channel is ready.</span>
      </div>
    );
  };

  return (
    <div className="meta-inbox page-enter">
      <div className="container">
        <section className="meta-inbox-hero">
          <div className="meta-inbox-toolbar">
            <button type="button" className="meta-inline-button" onClick={onBack}>
              <ArrowLeftIcon size={18} />
              Back to eXplore
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className="meta-pill meta-pill-muted">{readyCount}/3 live channels</span>
              <span className={`status-pill ${inboxState === 'Live' ? 'is-live' : inboxState === 'Partial / setup needed' ? 'is-partial' : 'is-empty'}`}>
                Inbox status: {inboxState}
              </span>
            </div>
          </div>

          <div className="meta-inbox-hero-copy">
            <div>
              <span className="meta-eyebrow">Unified inbox state</span>
              <h1 className="meta-inbox-title">Instagram, Messenger, and WhatsApp in one accountable inbox.</h1>
              <p className="meta-inbox-subtitle">
                Connect each channel, verify resource selection, and only then treat the thread rail as live.
                This screen no longer shows synthetic conversations.
              </p>
            </div>

            <div className="meta-inbox-summary">
              <span className="meta-summary-label">Meta readiness</span>
              <strong>{getOverviewHeadline({ user, loadingOverview, overview })}</strong>
              <p>{getOverviewDescription({ user, loadingOverview, overview })}</p>

              {user && app && (
                <div className="meta-app-state-grid">
                  <div className="meta-app-state-item">
                    <span>OAuth</span>
                    <strong>{app.auth_ready ? 'Ready' : 'Missing'}</strong>
                  </div>
                  <div className="meta-app-state-item">
                    <span>Login config</span>
                    <strong>{app.login_config_ready ? 'Ready' : 'Missing'}</strong>
                  </div>
                  <div className="meta-app-state-item">
                    <span>Webhook</span>
                    <strong>{app.webhook_ready ? 'Ready' : 'Missing'}</strong>
                  </div>
                  <div className="meta-app-state-item">
                    <span>Secret</span>
                    <strong>{app.secret_ready ? 'Ready' : 'Missing'}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>

          {statusMessage && (
            <div className={`meta-flash ${statusTone === 'error' ? 'is-error' : statusTone === 'success' ? 'is-success' : ''}`}>
              {statusMessage}
            </div>
          )}

          {!user && (
            <div className="meta-signin-note">
              Sign in to save Meta channel setup, load live threads, and send replies from your phone.
            </div>
          )}

          {user && overviewLoadFailed && !overview && (
            <div className="meta-signin-note">
              The live Meta overview is unavailable right now. eXplore will not fabricate disconnected channels until the backend responds again.
            </div>
          )}

          <div className="meta-channel-grid">
            {(!user || overview) && Object.entries(CHANNELS).map(([channel, config]) => {
              const connection = connectionMap[channel] || createFallbackConnection(channel);
              const saveLabel = connection.setup_state === 'selection_required'
                ? 'Finish setup'
                : connection.status === 'ready'
                  ? 'Save changes'
                  : 'Save setup';
              const advancedIsOpen = Boolean(advancedOpen[channel]);

              return (
                <article key={channel} className={`meta-channel-card ${config.toneClass}`}>
                  <div className="meta-channel-card-top">
                    <span className="meta-channel-mark">{config.label.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <h2>{config.label}</h2>
                      <p>{config.headline}</p>
                    </div>
                  </div>

                  <div className="meta-connection-status">
                    <span className={`meta-channel-pill ${config.toneClass}`}>{formatStatusLabel(connection.status)}</span>
                    {connection.access_token_masked && <span className="meta-token-mask">{connection.access_token_masked}</span>}
                  </div>

                  <p className="meta-channel-requirement">{config.description}</p>
                  <p className="meta-connection-missing">{describeConnectionState(connection, config)}</p>

                  <div className="meta-connection-meta">
                    <strong>{connection.manual_handoff_ready ? 'Manual handoff ready' : connection.can_send ? 'Send enabled' : 'Send disabled until ready'}</strong>
                    <span>{formatActivityLabel('Last webhook', connection.last_webhook_at)}</span>
                    <span>{formatActivityLabel('Last sync', connection.last_sync_at)}</span>
                  </div>
                  {connection.capabilities?.limitation && (
                    <p className="meta-connection-missing">{connection.capabilities.limitation}</p>
                  )}

                  {renderGuidedSetup(channel, connection)}

                  <div className="meta-connection-actions">
                    {config.fallback ? (
                      <button
                        type="button"
                        className="meta-inline-button"
                        onClick={() => {
                          const val = connection?.status === 'ready' ? connection.display_name : '';
                          const targetUrl = val ? `${config.appUrl}${val}` : config.webUrl;
                          void openExternalUrl(targetUrl);
                        }}
                      >
                        Launch App
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="meta-inline-button"
                        onClick={() => handleAuthorize(channel)}
                        disabled={!canAuthorize || busyKey === `authorize-${channel}`}
                      >
                        {busyKey === `authorize-${channel}`
                          ? 'Opening...'
                          : connection.status === 'disconnected'
                            ? 'Connect with Meta'
                            : 'Reconnect with Meta'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="meta-inline-button"
                      onClick={() => handleSaveConnection(channel)}
                      disabled={!user || busyKey === `save-${channel}`}
                    >
                      {busyKey === `save-${channel}` ? 'Saving...' : saveLabel}
                    </button>
                    <button
                      type="button"
                      className="meta-inline-button"
                      onClick={() => handleDisconnect(channel)}
                      disabled={!user || connection.status === 'disconnected' || busyKey === `disconnect-${channel}`}
                    >
                      {busyKey === `disconnect-${channel}` ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>

                  {config.fallback ? (
                    <div className="meta-connection-fields" style={{ marginTop: '12px' }}>
                      {config.fields.map((field) => (
                        <label key={field.key} className="meta-connection-field">
                          <span>{field.label}</span>
                          <input
                            type="text"
                            value={forms[channel]?.[field.key] || ''}
                            onChange={(event) => updateForm(channel, field.key, event.target.value)}
                            placeholder={field.placeholder}
                            autoComplete="off"
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="meta-advanced-toggle"
                        onClick={() => {
                          setAdvancedOpen((current) => ({
                            ...current,
                            [channel]: !current[channel],
                          }));
                        }}
                      >
                        {advancedIsOpen ? 'Hide advanced setup' : 'Show advanced setup'}
                      </button>

                      {advancedIsOpen && (
                        <div className="meta-advanced-panel">
                          <p className="meta-advanced-copy">
                            Use these raw fields only when Meta OAuth could not discover the exact resource you need or you are doing admin recovery work.
                          </p>
                          <div className="meta-connection-fields">
                            {config.fields.map((field) => (
                              <label key={field.key} className="meta-connection-field">
                                <span>{field.label}</span>
                                <input
                                  type={field.secret ? 'password' : 'text'}
                                  value={forms[channel]?.[field.key] || ''}
                                  onChange={(event) => updateForm(channel, field.key, event.target.value)}
                                  placeholder={field.placeholder}
                                  autoComplete="off"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="meta-inbox-layout">
          <aside className="meta-thread-rail">
            <div className="meta-thread-rail-header">
              <div>
                <h2>Live threads</h2>
                <p>
                  {threads.length
                    ? 'Webhook arrivals and outbound sends are listed here.'
                    : 'Threads appear only after real Meta activity.'}
                </p>
              </div>
              <span className="meta-count">{threads.length}</span>
            </div>

            <div className="meta-thread-search">
              <SearchIcon size={16} />
              <span>Search live threads when they arrive</span>
            </div>

            {!threads.length && <div className="meta-empty">No live conversations yet.</div>}

            <div className="meta-thread-list">
              {threads.map((thread) => {
                const channel = CHANNELS[thread.channel];
                const isActive = thread.id === activeThreadId;

                return (
                  <button
                    key={thread.id}
                    type="button"
                    className={`meta-thread-card ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <div className="meta-thread-avatar">{getInitials(thread.participant_name)}</div>
                    <div className="meta-thread-content">
                      <div className="meta-thread-title-row">
                        <strong>{thread.participant_name}</strong>
                        <span>{formatRelativeTime(thread.last_message_at)}</span>
                      </div>
                      <span className={`meta-channel-pill ${channel.toneClass}`}>{channel.label}</span>
                      <p>{thread.preview}</p>
                    </div>
                    <div className="meta-thread-side">
                      {thread.unread_count > 0 && <span className="meta-unread-pill">{thread.unread_count}</span>}
                      <span>{thread.manual_handoff ? 'Manual handoff' : thread.can_send ? 'Ready' : 'Read-only'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="meta-conversation-panel">
            {selectedThread ? (
              <>
                <header className="meta-conversation-header">
                  <div className="meta-conversation-person">
                    <div className="meta-thread-avatar large">{getInitials(selectedThread.participant_name)}</div>
                    <div>
                      <h2>{selectedThread.participant_name}</h2>
                      <p>{CHANNELS[selectedThread.channel].fallback ? 'Manual fallback chat' : 'Live Meta conversation'}</p>
                    </div>
                  </div>
                  <div className="meta-conversation-badges">
                    <span className={`meta-channel-pill ${CHANNELS[selectedThread.channel].toneClass}`}>
                      {CHANNELS[selectedThread.channel].label}
                    </span>
                    <span className="meta-pill meta-pill-muted">
                      {selectedThread.manual_handoff ? 'manual handoff' : selectedThread.can_send ? 'send enabled' : 'read-only'}
                    </span>
                  </div>
                </header>

                <div className={`meta-conversation-banner ${CHANNELS[selectedThread.channel].fallback ? 'is-fallback-banner' : ''}`}>
                  {CHANNELS[selectedThread.channel].fallback ? (
                    <>
                      <strong>Manual Fallback Chat (Clipboard & Launch)</strong>
                      <span>
                        eXplore does not run backend sync for this channel. Writing a message and clicking &quot;Copy &amp; Open App&quot; will automatically copy your text to the clipboard and launch the communication app.
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>
                        {selectedThread.can_send
                          ? 'This thread is live and can send through the backend.'
                          : 'This thread stays read-only until the matching channel is fully ready.'}
                      </strong>
                      <span>
                        {selectedThread.can_send
                          ? 'Replies below go through the connected Meta channel.'
                          : 'Complete the channel setup on the left before this conversation can send outbound messages.'}
                      </span>
                    </>
                  )}
                </div>

                <div className="meta-message-stream">
                  {selectedMessages.length > 0 ? selectedMessages.map((message) => (
                    <article key={message.id} className={`meta-message ${message.direction}`}>
                      <p>{message.text}</p>
                      <span>{message.meta}</span>
                    </article>
                  )) : (
                    <div className="meta-empty">
                      {CHANNELS[selectedThread.channel].fallback
                        ? 'No message history has been copied for this manual chat yet. Type a message below to start.'
                        : 'No live message history has been loaded for this thread yet.'}
                    </div>
                  )}
                </div>

                <div className="meta-composer">
                  <div className="meta-composer-input">
                    <label htmlFor="meta-live-reply" className="meta-composer-label">
                      {CHANNELS[selectedThread.channel].fallback ? 'Compose manual message' : 'Reply through the connected backend'}
                    </label>
                    <input
                      id="meta-live-reply"
                      value={draft}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraftsByThread((current) => ({
                          ...current,
                          [activeThreadId]: value,
                        }));
                      }}
                      placeholder={`Reply to ${selectedThread.participant_name}`}
                      disabled={(!selectedThread.can_send && !selectedThread.manual_handoff) || busyKey === 'send-live'}
                    />
                  </div>
                  <button
                    type="button"
                    className="meta-send-button"
                    onClick={handleSend}
                    disabled={(!selectedThread.can_send && !selectedThread.manual_handoff) || busyKey === 'send-live'}
                  >
                    {busyKey === 'send-live'
                      ? 'Processing...'
                      : CHANNELS[selectedThread.channel].fallback
                        ? 'Copy & Open App'
                        : 'Send live'}
                  </button>
                </div>
              </>
            ) : (
              renderConversationPlaceholder()
            )}
          </div>
        </section>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .meta-channel-card.is-telegram .meta-channel-mark {
          background: rgba(0, 136, 204, 0.16) !important;
          color: #0088cc !important;
        }
        .meta-channel-pill.is-telegram {
          background: rgba(0, 136, 204, 0.16) !important;
          color: #0088cc !important;
        }
        .meta-channel-card.is-slack .meta-channel-mark {
          background: rgba(74, 21, 75, 0.16) !important;
          color: #4a154b !important;
        }
        .meta-channel-pill.is-slack {
          background: rgba(74, 21, 75, 0.16) !important;
          color: #4a154b !important;
        }
        .meta-conversation-banner.is-fallback-banner {
          background: rgba(237, 242, 247, 0.5) !important;
          border-left: 4px solid var(--text-secondary) !important;
          color: var(--text-primary) !important;
        }
      ` }} />
    </div>
  );
}
