'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import UnifiedInboxScreen from './UnifiedInboxScreen';
import MailIntelligenceScreen from './MailIntelligenceScreen';

function MailIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
import {
  ArrowLeftIcon,
  ArchiveIcon,
  BellOffIcon,
  CheckIcon,
  CopyIcon,
  DoubleCheckIcon,
  EditIcon,
  ImageIcon,
  LockIcon,
  MicIcon,
  MoreVerticalIcon,
  PaperclipIcon,
  PinIcon,
  RefreshIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  SmileIcon,
  TrashIcon,
  XIcon,
} from './Icons';
import {
  createPrivateConversation,
  deletePrivateMessage,
  editPrivateMessage,
  fetchPrivateChatProfile,
  fetchPrivateConversations,
  fetchPrivateMessages,
  markPrivateConversationRead,
  savePrivateChatProfile,
  searchPrivateChatProfiles,
  sendPrivateMessage,
  subscribeToPrivateMessages,
  subscribeToPrivateTyping,
  updatePrivateConversationPreference,
  uploadPrivateAttachment,
  validatePrivateUsername,
} from '../lib/privateMessenger';
import {
  fetchPrivateMessagingReadiness,
  notifyPrivateMessage,
  registerPushToken,
  updateNotificationPreferences,
} from '../lib/api';
import { sendPriorityNotification } from '../lib/notifications';
import { registerDeviceForPush } from '../lib/pushNotifications';

const MESSAGE_SEARCH_THRESHOLD = 2;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MESSAGE_PAGE_SIZE = 200;
const PRIVATE_DRAFTS_KEY = 'explore-private-chat-drafts';
const EMOJI_CHOICES = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F525}', '\u{1F64F}', '\u2728', '\u{1F389}', '\u{1F60A}'];

function getMessagingReadinessLabel(readiness) {
  if (!readiness) {
    return 'Checking';
  }
  if (readiness.status === 'live') {
    return 'Live';
  }
  if (readiness.status === 'partial') {
    return 'Needs proof';
  }
  return 'Blocked';
}

function getMessagingReadinessTone(readiness) {
  if (!readiness) {
    return 'checking';
  }
  return readiness.status === 'live' ? 'live' : readiness.status === 'partial' ? 'partial' : 'blocked';
}

function loadPrivateDrafts() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const stored = JSON.parse(localStorage.getItem(PRIVATE_DRAFTS_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function persistPrivateDrafts(drafts = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const savedEntries = Object.entries(drafts)
    .filter(([conversationId, text]) => conversationId && String(text || '').trim())
    .slice(-50);
  localStorage.setItem(PRIVATE_DRAFTS_KEY, JSON.stringify(Object.fromEntries(savedEntries)));
}

function initials(label = '') {
  return String(label || 'PX')
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'PX';
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateLabel(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function formatConversationStamp(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return formatTime(value);
  }
  return formatDate(value);
}

function getProfileLabel(profile) {
  return profile?.displayName || profile?.username || 'Private user';
}

function Avatar({ profile: avatarProfile, large = false }) {
  const label = getProfileLabel(avatarProfile);
  return avatarProfile?.avatarUrl ? (
    <img
      className={`meta-thread-avatar ${large ? 'large' : ''}`}
      src={avatarProfile.avatarUrl}
      alt=""
    />
  ) : (
    <span className={`meta-thread-avatar ${large ? 'large' : ''}`}>{initials(label)}</span>
  );
}

function MessageState({ status }) {
  if (status === 'sending') {
    return <span className="private-message-state is-sending">...</span>;
  }
  if (status === 'read') {
    return <DoubleCheckIcon size={14} className="private-message-state is-read" />;
  }
  if (status === 'sent') {
    return <CheckIcon size={14} className="private-message-state" />;
  }
  return null;
}

export default function MessagingHubScreen({
  onBack,
  onRequireAuth,
  initialOpenTarget = null,
  onConsumeInitialTarget,
}) {
  const { user, loading, hasSupabase } = useAuth();
  const [mode, setMode] = useState('mail');
  const [profile, setProfile] = useState(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ username: '', displayName: '' });
  const [profileBusy, setProfileBusy] = useState(false);
  const [showNewAccountWarning, setShowNewAccountWarning] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageBusy, setMessageBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [drafts, setDrafts] = useState(loadPrivateDrafts);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatus] = useState('');
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [activeActionMessageId, setActiveActionMessageId] = useState('');
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [pushSetupBusy, setPushSetupBusy] = useState(false);
  const [activeScreen, setActiveScreen] = useState('list'); // 'list', 'chat', 'search'
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const streamRef = useRef(null);
  const draftRef = useRef(null);
  const userSearchRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const typingChannelRef = useRef(null);
  const typingStopTimerRef = useRef(null);

  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (!user?.created_at) {
      setShowNewAccountWarning(false);
      return;
    }

    const createdAt = new Date(user.created_at).getTime();
    setShowNewAccountWarning(Number.isFinite(createdAt) && Date.now() - createdAt < 120000);
  }, [user?.created_at]);

  const selectedConversation = useMemo(() => (
    conversations.find((conversation) => conversation.id === selectedId) || conversations[0] || null
  ), [conversations, selectedId]);

  const selectedConversationId = selectedConversation?.id || '';
  const draft = drafts[selectedConversationId] || '';
  const setDraft = useCallback((value) => {
    if (!selectedConversationId) {
      return;
    }
    setDrafts((current) => {
      const previous = current[selectedConversationId] || '';
      const next = typeof value === 'function' ? value(previous) : value;
      return {
        ...current,
        [selectedConversationId]: next,
      };
    });
  }, [selectedConversationId]);
  const conversationVisible = Boolean(selectedConversationId) && (isDesktop || mobileConversationOpen);

  const selectedConversationIdRef = useRef(selectedConversationId);
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const conversationVisibleRef = useRef(conversationVisible);
  useEffect(() => {
    conversationVisibleRef.current = conversationVisible;
  }, [conversationVisible]);

  const refreshReadiness = useCallback(async () => {
    try {
      const nextReadiness = await fetchPrivateMessagingReadiness();
      setReadiness(nextReadiness || null);
    } catch {
      setReadiness({
        status: 'unavailable',
        message: 'Messaging readiness could not be checked.',
        blockers: ['The backend readiness endpoint is not reachable from this client.'],
      });
    }
  }, []);

  useEffect(() => {
    void refreshReadiness();
  }, [refreshReadiness, user?.id]);
  const visibleMessages = useMemo(() => {
    const normalizedQuery = conversationSearch.trim().toLowerCase();
    if (!conversationSearchOpen || normalizedQuery.length < MESSAGE_SEARCH_THRESHOLD) {
      return messages;
    }
    return messages.filter((message) => (
      String(message.text || '').toLowerCase().includes(normalizedQuery)
      || String(message.attachment?.name || '').toLowerCase().includes(normalizedQuery)
    ));
  }, [conversationSearch, conversationSearchOpen, messages]);
  const displayedMessages = useMemo(() => {
    let lastLabel = '';
    return visibleMessages.flatMap((message) => {
      const label = formatDateLabel(message.createdAt);
      const items = [];
      if (label && label !== lastLabel) {
        items.push({ id: `date-${message.id}`, type: 'date', label });
        lastLabel = label;
      }
      items.push(message);
      return items;
    });
  }, [visibleMessages]);
  const archivedCount = useMemo(() => (
    conversations.filter((conversation) => conversation.isArchived).length
  ), [conversations]);
  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().replace(/^@+/, '').toLowerCase();
    const scopedConversations = normalizedQuery
      ? conversations
      : conversations.filter((conversation) => Boolean(conversation.isArchived) === showArchived);
    if (!normalizedQuery) {
      return scopedConversations;
    }
    return scopedConversations.filter((conversation) => (
      String(conversation.profile?.username || '').toLowerCase().includes(normalizedQuery)
      || String(getProfileLabel(conversation.profile)).toLowerCase().includes(normalizedQuery)
      || String(conversation.latestMessage?.text || '').toLowerCase().includes(normalizedQuery)
    ));
  }, [conversations, query, showArchived]);

  useEffect(() => {
    persistPrivateDrafts(drafts);
  }, [drafts]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const syncDesktop = () => setIsDesktop(media.matches);
    syncDesktop();
    media.addEventListener('change', syncDesktop);
    return () => media.removeEventListener('change', syncDesktop);
  }, []);

  useEffect(() => {
    if (!mobileConversationOpen || isDesktop) {
      return undefined;
    }

    window.history.pushState({ ...window.history.state, privateChatOpen: true }, '');
    const closeConversation = () => {
      setMobileConversationOpen(false);
      setActiveScreen('list');
    };
    window.addEventListener('popstate', closeConversation);
    return () => window.removeEventListener('popstate', closeConversation);
  }, [isDesktop, mobileConversationOpen]);

  const refreshConversations = useCallback(async ({ preserveSelection = true } = {}) => {
    if (!user?.id || !profile) {
      setConversations([]);
      return [];
    }

    setConversationBusy(true);
    try {
      const nextConversations = await fetchPrivateConversations(user.id);
      setConversations(nextConversations);
      if (!preserveSelection || !selectedId || !nextConversations.some((conversation) => conversation.id === selectedId)) {
        setSelectedId(nextConversations[0]?.id || '');
      }
      return nextConversations;
    } catch (error) {
      setStatus(error?.message || 'Private chats could not be loaded.');
      return [];
    } finally {
      setConversationBusy(false);
    }
  }, [profile, selectedId, user?.id]);

  useEffect(() => {
    if (!initialOpenTarget?.screen) {
      return;
    }
    if (initialOpenTarget.screen === 'private-chat') {
      setMode('private');
      if (initialOpenTarget.conversationId) {
        setSelectedId(initialOpenTarget.conversationId);
        setMobileConversationOpen(true);
        setActiveScreen('chat');
      }
      onConsumeInitialTarget?.();
      return;
    }
    if (initialOpenTarget.screen === 'meta-inbox') {
      setMode('channels');
    } else {
      setMode('private');
    }
    onConsumeInitialTarget?.();
  }, [initialOpenTarget, onConsumeInitialTarget]);

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setProfile(null);
      setProfileChecked(false);
      setProfileDraft({ username: '', displayName: '' });
      return undefined;
    }

    setProfileChecked(false);
    void (async () => {
      try {
        const nextProfile = await fetchPrivateChatProfile(user.id);
        if (!active) return;
        setProfile(nextProfile);
        setProfileDraft({
          username: nextProfile?.username || '',
          displayName: nextProfile?.displayName || user.user_metadata?.full_name || user.email?.split('@')[0] || '',
        });
        setProfileChecked(true);
      } catch (error) {
        if (active) {
          setStatus(error?.message || 'Profile could not be loaded.');
          setProfileChecked(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!profile || !user?.id) {
      return undefined;
    }

    void refreshConversations({ preserveSelection: false });
    return subscribeToPrivateMessages({
      userId: user.id,
      onChange: (payload) => {
        void refreshConversations();
        if (selectedConversationIdRef.current) {
          void fetchPrivateMessages(selectedConversationIdRef.current, user.id, { limit: MESSAGE_PAGE_SIZE })
            .then((nextMessages) => {
              setMessages(nextMessages);
              setHasOlderMessages(nextMessages.length >= MESSAGE_PAGE_SIZE);
              if (conversationVisibleRef.current) {
                void markPrivateConversationRead(selectedConversationIdRef.current, user.id).catch(() => {});
              }
            })
            .catch(() => {});
        }

        // Trigger browser notification if incoming message and tab is backgrounded / different conversation active
        if (payload?.eventType === 'INSERT' && payload.new && payload.new.sender_id !== user.id) {
          const isBackground = typeof document !== 'undefined' && document.visibilityState !== 'visible';
          const isDifferentChat = !conversationVisibleRef.current || selectedConversationIdRef.current !== payload.new.conversation_id;
          
          if (isBackground || isDifferentChat) {
            const senderId = payload.new.sender_id;
            const convo = conversationsRef.current.find(c => c.profile?.userId === senderId);
            const senderName = convo ? (convo.profile?.displayName || convo.profile?.username) : 'Someone';
            
            void sendPriorityNotification({
              title: `Message from ${senderName}`,
              body: payload.new.body || 'Sent an attachment',
              data: { conversationId: payload.new.conversation_id }
            });
          }
        }
      },
      onStatus: ({ status: realtimeStatus }) => {
        if (realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT') {
          setStatus('Live updates disconnected. Refresh chats to reconnect.');
        }
      },
    });
  }, [conversationVisible, profile, refreshConversations, selectedConversationId, user?.id]);

  useEffect(() => {
    let active = true;
    if (!selectedConversationId || !user?.id) {
      setMessages([]);
      return undefined;
    }

    setMessageBusy(true);
    void (async () => {
      try {
        const nextMessages = await fetchPrivateMessages(selectedConversationId, user.id, { limit: MESSAGE_PAGE_SIZE });
        if (!active) return;
        setMessages(nextMessages);
        setHasOlderMessages(nextMessages.length >= MESSAGE_PAGE_SIZE);
        setReplyTarget(null);
        setEditingMessage(null);
        if (conversationVisible) {
          void markPrivateConversationRead(selectedConversationId, user.id).catch(() => {});
        }
      } catch (error) {
        if (active) {
          setStatus(error?.message || 'Messages could not be loaded.');
        }
      } finally {
        if (active) {
          setMessageBusy(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [conversationVisible, selectedConversationId, user?.id]);

  useEffect(() => {
    setActiveActionMessageId('');
    setIsOtherTyping(false);
    if (!conversationVisible || !selectedConversationId || !user?.id) {
      return undefined;
    }

    const typingChannel = subscribeToPrivateTyping({
      conversationId: selectedConversationId,
      userId: user.id,
      onTyping: (isTyping) => setIsOtherTyping(isTyping),
    });
    typingChannelRef.current = typingChannel;

    return () => {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
      typingChannel.send(false);
      typingChannel.unsubscribe();
      if (typingChannelRef.current === typingChannel) {
        typingChannelRef.current = null;
      }
    };
  }, [conversationVisible, selectedConversationId, user?.id]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages, selectedConversationId]);

  useEffect(() => {
    let active = true;
    if (!profile || !user?.id || query.trim().length < 2) {
      setResults([]);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setSearchBusy(true);
      void searchPrivateChatProfiles(query, user.id)
        .then((nextResults) => {
          if (active) setResults(nextResults);
        })
        .catch((error) => {
          if (active) setStatus(error?.message || 'Search failed.');
        })
        .finally(() => {
          if (active) setSearchBusy(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [profile, query, user?.id]);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    const { username, valid } = validatePrivateUsername(profileDraft.username);
    if (!valid) {
      setStatus('Use 3-24 lowercase letters, numbers, or underscores.');
      return;
    }

    setProfileBusy(true);
    try {
      const nextProfile = await savePrivateChatProfile({
        userId: user.id,
        username,
        displayName: profileDraft.displayName || username,
        avatarUrl: user.user_metadata?.avatar_url || '',
      });
      setProfile(nextProfile);
      setProfileDraft({ username: nextProfile.username, displayName: nextProfile.displayName });
      setStatus('');
    } catch (error) {
      setStatus(error?.message || 'Profile could not be saved.');
    } finally {
      setProfileBusy(false);
    }
  };

  const handleStartConversation = async (otherUserId) => {
    if (!user?.id) return;
    setConversationBusy(true);
    try {
      const conversationId = await createPrivateConversation(user.id, otherUserId);
      await refreshConversations();
      setSelectedId(conversationId);
      setMobileConversationOpen(true);
      setActiveScreen('chat');
      setQuery('');
      setResults([]);
      setStatus('');
    } catch (error) {
      setStatus(error?.message || 'Conversation could not be created.');
    } finally {
      setConversationBusy(false);
    }
  };

  const handleNewChatFocus = () => {
    setActiveScreen('search');
    setSearchTouched(true);
    setShowArchived(false);
    requestAnimationFrame(() => userSearchRef.current?.focus());
  };

  const handleCopyPrivateHandle = async () => {
    if (!profile?.username) {
      return;
    }

    const handle = `@${profile.username}`;
    try {
      await navigator.clipboard?.writeText(handle);
      setStatus(`Copied ${handle}.`);
    } catch {
      setStatus(`Your handle is ${handle}.`);
    }
  };

  const handleEnableMessageNotifications = async () => {
    setPushSetupBusy(true);
    setStatus('');
    try {
      const pushResult = await registerDeviceForPush();
      if (pushResult?.ok && pushResult.token) {
        const deviceResult = await registerPushToken({
          token: pushResult.token,
          platform: pushResult.platform || pushResult.state?.platform || 'android',
          device_id: pushResult.device_id || '',
          app_version: pushResult.app_version || '',
        });
        if (!deviceResult?.success) {
          throw new Error(deviceResult?.message || 'Phone token could not be saved.');
        }
      } else if (pushResult && !pushResult.ok) {
        const unsupported = pushResult.state?.platform === 'web'
          || pushResult.state?.isNative === false
          || /not supported|unsupported/i.test(pushResult.message || '');
        if (unsupported) {
          setStatus('Phone alerts require the installed Android app. Web chat still works.');
          await refreshReadiness();
          setReadinessOpen(false);
          return;
        }
        throw new Error(pushResult.message || 'Phone registration did not complete.');
      }

      await updateNotificationPreferences({
        alerts_enabled: true,
        push_enabled: true,
      });
      setStatus('Message notifications are being checked on this phone.');
      await refreshReadiness();
      setReadinessOpen(true);
    } catch (error) {
      setStatus(error?.message || 'Message notifications could not be enabled.');
      await refreshReadiness();
      setReadinessOpen(true);
    } finally {
      setPushSetupBusy(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !selectedConversationId || !user?.id || sendBusy) return;
    typingChannelRef.current?.send(false);

    if (editingMessage) {
      setSendBusy(true);
      setStatus('');
      try {
        await editPrivateMessage({ messageId: editingMessage.id, body: text });
        setMessages((current) => current.map((message) => (
          message.id === editingMessage.id
            ? { ...message, text, rawText: text, editedAt: new Date().toISOString() }
            : message
        )));
        setDraft('');
        setEditingMessage(null);
        await refreshConversations();
      } catch (error) {
        setStatus(error?.message || 'Message could not be edited.');
      } finally {
        setSendBusy(false);
      }
      return;
    }

    await sendMessagePayload({ text });
  };

  const sendMessagePayload = async ({ text = '', attachment = null, failedId = '' }) => {
    const normalizedText = String(text || '').trim();
    if ((!normalizedText && !attachment?.path) || !selectedConversationId || !user?.id || sendBusy) return;

    const pendingId = `pending-${Date.now()}`;
    setDraft('');
    setSendBusy(true);
    setStatus('');
    setEmojiOpen(false);
    setMessages((current) => {
      const pendingMessage = {
        id: failedId || pendingId,
        conversationId: selectedConversationId,
        senderId: user.id,
        direction: 'outbound',
        text: normalizedText || attachment?.name || 'Attachment',
        replyToMessageId: replyTarget?.id || '',
        replyTo: replyTarget ? {
          id: replyTarget.id,
          senderId: replyTarget.senderId,
          direction: replyTarget.direction,
          text: replyTarget.deletedAt ? 'Deleted message' : (replyTarget.text || replyTarget.attachment?.name || 'Attachment'),
          attachmentName: replyTarget.attachment?.name || '',
        } : null,
        attachment,
        createdAt: new Date().toISOString(),
        deliveryStatus: 'sending',
      };
      return failedId
        ? current.map((message) => (message.id === failedId ? pendingMessage : message))
        : [...current, pendingMessage];
    });
    try {
      const sent = await sendPrivateMessage({
        conversationId: selectedConversationId,
        senderId: user.id,
        body: normalizedText,
        attachment,
        replyToMessageId: replyTarget?.id || '',
      });
      if (sent) {
        setMessages((current) => current.map((message) => (
          message.id === (failedId || pendingId)
            ? { ...sent, replyTo: sent.replyTo || message.replyTo, deliveryStatus: 'sent' }
            : message
        )));
        void notifyPrivateMessage({
          conversationId: selectedConversationId,
          messageId: sent.id,
        }).catch(() => {});
        await refreshConversations();
        void refreshReadiness();
        setReplyTarget(null);
      }
    } catch (error) {
      setMessages((current) => current.map((message) => (
        message.id === (failedId || pendingId) ? { ...message, deliveryStatus: 'failed' } : message
      )));
      setStatus(error?.message || 'Message could not be sent.');
    } finally {
      setSendBusy(false);
      if (draftRef.current) {
        draftRef.current.style.height = 'auto';
      }
    }
  };

  const handleRetryMessage = (message) => {
    void sendMessagePayload({
      text: message.text,
      attachment: message.attachment,
      failedId: message.id,
    });
  };

  const handleLoadOlderMessages = async () => {
    const before = messages[0]?.createdAt;
    if (!before || !selectedConversationId || !user?.id || olderBusy) return;
    setOlderBusy(true);
    setStatus('');
    try {
      const olderMessages = await fetchPrivateMessages(selectedConversationId, user.id, {
        before,
        limit: MESSAGE_PAGE_SIZE,
      });
      setMessages((current) => {
        const existingIds = new Set(current.map((message) => message.id));
        return [...olderMessages.filter((message) => !existingIds.has(message.id)), ...current];
      });
      setHasOlderMessages(olderMessages.length >= MESSAGE_PAGE_SIZE);
    } catch (error) {
      setStatus(error?.message || 'Older messages could not be loaded.');
    } finally {
      setOlderBusy(false);
    }
  };

  const handleReplyToMessage = (message) => {
    if (message.deletedAt) return;
    setReplyTarget(message);
    setEditingMessage(null);
    setActiveActionMessageId('');
    draftRef.current?.focus();
  };

  const handleEditMessage = (message) => {
    if (message.direction !== 'outbound' || message.deletedAt) return;
    setEditingMessage(message);
    setReplyTarget(null);
    setActiveActionMessageId('');
    setDraft(message.text || '');
    requestAnimationFrame(() => {
      if (draftRef.current) {
        draftRef.current.focus();
        draftRef.current.style.height = 'auto';
        draftRef.current.style.height = `${Math.min(draftRef.current.scrollHeight, 132)}px`;
      }
    });
  };

  const handleDeleteMessage = async (message) => {
    if (message.direction !== 'outbound' || message.deletedAt) return;
    setActiveActionMessageId('');
    setStatus('');
    try {
      await deletePrivateMessage({ messageId: message.id });
      setMessages((current) => current.map((item) => (
        item.id === message.id
          ? { ...item, text: '', deletedAt: new Date().toISOString(), editedAt: item.editedAt || '' }
          : item
      )));
      await refreshConversations();
      void refreshReadiness();
    } catch (error) {
      setStatus(error?.message || 'Message could not be deleted.');
    }
  };

  const handleCopyMessage = async (message) => {
    const text = message.deletedAt ? '' : (message.text || message.attachment?.name || '');
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      setActiveActionMessageId('');
      setStatus('Copied.');
    } catch {
      setStatus('Could not copy this message.');
    }
  };

  const handleConversationPreference = async (key, value) => {
    if (!selectedConversationId || !user?.id || !activeConversation) return;
    setChatMenuOpen(false);
    setStatus('');
    try {
      await updatePrivateConversationPreference({
        conversationId: selectedConversationId,
        userId: user.id,
        patch: {
          isPinned: activeConversation.isPinned,
          isMuted: activeConversation.isMuted,
          isArchived: activeConversation.isArchived,
          [key]: value,
        },
      });
      await refreshConversations({ preserveSelection: key !== 'isArchived' });
      if (key === 'isArchived') {
        setMobileConversationOpen(false);
        setActiveScreen('list');
      }
    } catch (error) {
      setStatus(error?.message || 'Chat setting could not be updated.');
    }
  };

  const clearComposerMode = () => {
    setReplyTarget(null);
    setEditingMessage(null);
    if (editingMessage) {
      setDraft('');
      typingChannelRef.current?.send(false);
    }
  };

  const handleAttachment = async (file) => {
    if (!file || !selectedConversationId || !user?.id) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setStatus('Files must be 25 MB or smaller.');
      return;
    }

    setAttachmentBusy(true);
    setStatus('');
    try {
      const attachment = await uploadPrivateAttachment({
        conversationId: selectedConversationId,
        senderId: user.id,
        file,
      });
      await sendMessagePayload({ attachment });
    } catch (error) {
      setStatus(error?.message || 'Attachment could not be sent.');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const handleVoiceNote = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Voice notes are not supported on this device.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        if (!blob.size) return;
        void handleAttachment(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' }));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setStatus('Microphone access was not allowed.');
    }
  };

  const insertEmoji = (emoji) => {
    setDraft((current) => `${current}${emoji}`);
    setEmojiOpen(false);
    draftRef.current?.focus();
  };

  const closeMobileConversation = () => {
    setActiveScreen('list');
    if (!isDesktop && window.history.state?.privateChatOpen) {
      window.history.back();
      return;
    }
    setMobileConversationOpen(false);
  };

  const handleDraftChange = (event) => {
    const nextDraft = event.target.value;
    setDraft(nextDraft);
    typingChannelRef.current?.send(Boolean(nextDraft.trim()));
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
    }
    typingStopTimerRef.current = window.setTimeout(() => {
      typingChannelRef.current?.send(false);
      typingStopTimerRef.current = null;
    }, 1200);
    const textarea = event.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  };

  const profileForm = (
    <div className="private-profile-form">
      <label>
        <span>Username</span>
        <input
          value={profileDraft.username}
          onChange={(event) => setProfileDraft((current) => ({ ...current, username: event.target.value }))}
          placeholder="khalil"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </label>
      <label>
        <span>Name</span>
        <input
          value={profileDraft.displayName}
          onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))}
          placeholder="Khalil"
        />
      </label>
      {status ? <p className="private-status">{status}</p> : null}
      <button type="button" className="private-primary-button" disabled={profileBusy} onClick={handleSaveProfile}>
        {profileBusy ? 'Saving...' : profile ? 'Save' : 'Continue'}
      </button>
    </div>
  );

  const modeBar = (
    <div className="messaging-modebar">
      <button
        type="button"
        className={`messaging-mode-button ${mode === 'mail' ? 'active' : ''}`}
        onClick={() => setMode('mail')}
      >
        <MailIcon size={16} />
        Mail
      </button>
      <button
        type="button"
        className={`messaging-mode-button ${mode === 'private' ? 'active' : ''}`}
        onClick={() => setMode('private')}
      >
        <LockIcon size={16} />
        Private
      </button>
      <button
        type="button"
        className={`messaging-mode-button ${mode === 'channels' ? 'active' : ''}`}
        onClick={() => setMode('channels')}
      >
        <SettingsIcon size={16} />
        Channels
      </button>
    </div>
  );

  if (mode === 'mail') {
    return (
      <div className="messaging-shell">
        {modeBar}
        <MailIntelligenceScreen onBack={onBack} />
      </div>
    );
  }

  if (mode === 'channels') {
    if (!user) {
      return (
        <div className="messaging-shell">
          {modeBar}
          <div className="meta-conversation-placeholder">
            <strong>Sign In First</strong>
            <span>Channels are tied to your eXplore account.</span>
            {typeof onRequireAuth === 'function' ? (
              <button type="button" className="private-primary-button" onClick={onRequireAuth}>
                Sign in
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <div className="messaging-shell">
        {modeBar}
        <UnifiedInboxScreen
          onBack={onBack}
          initialOpenTarget={initialOpenTarget}
          onConsumeInitialTarget={onConsumeInitialTarget}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="messaging-shell">
        <div className="meta-conversation-placeholder">
          <strong>Opening Messages</strong>
          <span>Loading your signed-in eXplore account.</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="messaging-shell">
        {modeBar}
        <div className="meta-conversation-placeholder">
          <strong>Sign In First</strong>
          <span>Private messages are tied to your eXplore account.</span>
          {typeof onRequireAuth === 'function' ? (
            <button type="button" className="private-primary-button" onClick={onRequireAuth}>
              Sign in
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!hasSupabase) {
    return (
      <div className="messaging-shell">
        <div className="meta-conversation-placeholder">
          <strong>Messaging Unavailable</strong>
          <span>Supabase is required for private chat persistence and realtime delivery.</span>
        </div>
      </div>
    );
  }

  if (!profileChecked) {
    return (
      <div className="messaging-shell">
        <div className="meta-conversation-placeholder">
          <strong>Opening chats</strong>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="messaging-shell">
        <section className="private-profile-gate">
          {showNewAccountWarning && (
            <div className="auth-alert-banner warning" style={{
              background: 'var(--warning-light)',
              border: '1px solid var(--warning)',
              color: 'var(--warning)',
              padding: '12px 16px',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '20px',
              fontSize: '0.9rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              lineHeight: 1.4
            }}>
              <strong style={{ fontWeight: 700 }}>New Account Registered</strong>
              <span>You have signed up with a new Google account/email. If you intended to log in to an existing account, please sign out and sign in with your correct credentials.</span>
            </div>
          )}
          <div className="private-profile-copy">
            <span className="meta-eyebrow">Private identity</span>
            <h1>Choose your handle.</h1>
            <p>Other users can find this username inside eXplore.</p>
          </div>
          {profileForm}
        </section>
      </div>
    );
  }

  const activeConversation = selectedConversation;
  const activeProfile = activeConversation?.profile || null;

  return (
    <div className="messaging-shell">
      {status ? <div className="private-status private-status--toast">{status}</div> : null}

      {(activeScreen === 'list' || isDesktop) && modeBar}

      <section className={`private-chat-layout ${mobileConversationOpen ? 'is-conversation-open' : ''}`}>
        <aside className="private-thread-rail">
          {activeScreen === 'search' ? (
            <div className="private-search-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="private-thread-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="private-mobile-back"
                    onClick={() => {
                      setActiveScreen('list');
                      setQuery('');
                      setResults([]);
                    }}
                    aria-label="Back to chats"
                    style={{ display: 'grid' }}
                  >
                    <ArrowLeftIcon size={18} />
                  </button>
                  <h2>New Chat</h2>
                </div>
              </div>

              <div className="private-search-box" style={{ marginTop: '12px' }}>
                <SearchIcon size={16} />
                <input
                  ref={userSearchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => setSearchTouched(true)}
                  placeholder="Search username"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>

              <div className="private-search-results-container" style={{ flex: 1, overflowY: 'auto' }}>
                {results.length > 0 && (
                  <div className="private-search-results">
                    {results.map((result) => (
                      <button
                        key={result.userId}
                        type="button"
                        className="private-result-card"
                        onClick={() => void handleStartConversation(result.userId)}
                        disabled={conversationBusy}
                      >
                        <Avatar profile={result} />
                        <span>
                          <strong>{getProfileLabel(result)}</strong>
                          <small>@{result.username}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {searchBusy ? (
                  <div className="meta-empty">Searching usernames.</div>
                ) : null}

                {!searchBusy && searchTouched && query.trim().length >= 2 && results.length === 0 ? (
                  <div className="meta-empty">No user found for @{query.trim().replace(/^@+/, '').toLowerCase()}.</div>
                ) : null}

                {!searchBusy && !query.trim() && !conversationBusy && conversations.length === 0 && !results.length ? (
                  <div className="private-empty-guide">
                    <strong>Start with a handle</strong>
                    <span>Copy @{profile.username}, share it with others, then search their eXplore handle here.</span>
                    <button type="button" className="private-primary-button" onClick={handleCopyPrivateHandle}>
                      Copy my handle
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="private-list-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="private-thread-header">
                <div>
                  <span className="meta-eyebrow">Private chats</span>
                  <h2>@{profile.username}</h2>
                </div>
                <div className="private-thread-actions">
                  <span className="meta-count">{conversations.length}</span>
                  <button
                    type="button"
                    className="private-icon-button"
                    onClick={handleCopyPrivateHandle}
                    aria-label="Copy my private handle"
                    title="Copy my private handle"
                  >
                    <CopyIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="private-primary-button private-new-chat-button"
                    onClick={handleNewChatFocus}
                  >
                    New chat
                  </button>
                  <button
                    type="button"
                    className="private-icon-button"
                    onClick={() => void refreshConversations()}
                    aria-label="Refresh chats"
                  >
                    <RefreshIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="private-icon-button"
                    onClick={() => setSettingsOpen((current) => !current)}
                    aria-label="Edit private profile"
                  >
                    <SettingsIcon size={17} />
                  </button>
                </div>
              </div>

              {settingsOpen ? (
                <div className="private-settings-panel" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <strong>Private profile</strong>
                  {profileForm}
                  
                  {/* Diagnostics Button to toggle proof panel */}
                  <button
                    type="button"
                    className="private-primary-button private-diagnostics-button"
                    onClick={() => setShowDiagnostics((current) => !current)}
                    style={{ marginTop: '8px', width: '100%', minHeight: '34px', background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  >
                    {showDiagnostics ? 'Hide Diagnostics' : 'Diagnostics'}
                  </button>

                  {showDiagnostics && (
                    <section className={`private-readiness-card is-${getMessagingReadinessTone(readiness)}`} style={{ marginTop: 'var(--space-base)' }}>
                      <div>
                        <span className="meta-eyebrow">Messaging proof</span>
                        <strong>{getMessagingReadinessLabel(readiness)}</strong>
                        <p>{readiness?.message || 'Checking private chat, realtime, device, and push readiness.'}</p>
                      </div>
                      <div className="private-readiness-actions">
                        <button
                          type="button"
                          className="private-readiness-toggle"
                          onClick={() => void handleEnableMessageNotifications()}
                          disabled={pushSetupBusy}
                        >
                          {pushSetupBusy ? 'Checking phone' : 'Enable phone alerts'}
                        </button>
                        <button type="button" className="private-icon-button" onClick={() => void refreshReadiness()} aria-label="Refresh messaging readiness">
                          <RefreshIcon size={16} />
                        </button>
                        {Array.isArray(readiness?.blockers) && readiness.blockers.length ? (
                          <button type="button" className="private-readiness-toggle" onClick={() => setReadinessOpen((current) => !current)}>
                            {readinessOpen ? 'Hide' : 'Show'} blockers
                          </button>
                        ) : null}
                      </div>
                      {readinessOpen && Array.isArray(readiness?.blockers) && readiness.blockers.length ? (
                        <ul className="private-readiness-blockers">
                          {readiness.blockers.slice(0, 5).map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  )}
                </div>
              ) : null}

              {/* A quick search entry point that transitions to Screen 3 */}
              <div
                className="private-search-box"
                style={{ marginTop: '12px', cursor: 'pointer' }}
                onClick={handleNewChatFocus}
              >
                <SearchIcon size={16} />
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', flex: 1 }}>Search username</div>
              </div>

              {archivedCount > 0 || showArchived ? (
                <button
                  type="button"
                  className={`private-archive-toggle ${showArchived ? 'active' : ''}`}
                  onClick={() => setShowArchived((current) => !current)}
                >
                  <ArchiveIcon size={16} />
                  <span>{showArchived ? 'Chats' : 'Archived'}</span>
                  <small>{showArchived ? conversations.length - archivedCount : archivedCount}</small>
                </button>
              ) : null}

              <div className="meta-thread-list" style={{ flex: 1, overflowY: 'auto' }}>
                {filteredConversations.map((conversation) => {
                  const isActive = conversation.id === activeConversation?.id;
                  const profileLabel = getProfileLabel(conversation.profile);
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      className={`meta-thread-card ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedId(conversation.id);
                        setMobileConversationOpen(true);
                        setActiveScreen('chat');
                      }}
                    >
                      <Avatar profile={conversation.profile} />
                      <span className="meta-thread-content">
                        <span className="meta-thread-title-row">
                          <strong>{profileLabel}</strong>
                          <span>{formatConversationStamp(conversation.updatedAt)}</span>
                        </span>
                        <p>{conversation.latestMessage?.text || `@${conversation.profile.username}`}</p>
                      </span>
                      <span className="meta-thread-side">
                        {conversation.isPinned ? <PinIcon size={14} className="meta-thread-preference-icon" /> : null}
                        {conversation.isMuted ? <BellOffIcon size={14} className="meta-thread-preference-icon" /> : null}
                        {conversation.unreadCount > 0 ? (
                          <span className="meta-unread-pill">{conversation.unreadCount}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <div className="private-conversation-panel meta-conversation-panel">
          {activeConversation ? (
            <>
              <header className="meta-conversation-header">
                <div className="meta-conversation-person">
                  <button
                    type="button"
                    className="private-mobile-back"
                    onClick={closeMobileConversation}
                    aria-label="Back to chats"
                  >
                    <ArrowLeftIcon size={18} />
                  </button>
                  <Avatar profile={activeProfile} large />
                  <div>
                    <h2>{getProfileLabel(activeProfile)}</h2>
                    <p className={isOtherTyping ? 'is-typing' : ''}>
                      {isOtherTyping ? 'typing...' : `@${activeProfile?.username || 'private_user'}`}
                    </p>
                  </div>
                </div>
                <div className="private-conversation-actions">
                  <button
                    type="button"
                    className="private-icon-button"
                    onClick={() => {
                      setConversationSearchOpen((current) => !current);
                      setConversationSearch('');
                    }}
                    aria-label="Search messages"
                  >
                    <SearchIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="private-icon-button"
                    onClick={() => setChatMenuOpen((current) => !current)}
                    aria-label="Chat menu"
                    aria-expanded={chatMenuOpen}
                  >
                    <MoreVerticalIcon size={18} />
                  </button>
                  {chatMenuOpen ? (
                    <div className="private-chat-menu">
                      <strong>@{activeProfile?.username || 'private_user'}</strong>
                      <button type="button" onClick={() => {
                        setConversationSearchOpen(true);
                        setChatMenuOpen(false);
                      }}>
                        <SearchIcon size={15} />
                        Search messages
                      </button>
                      <button type="button" onClick={() => void handleConversationPreference('isPinned', !activeConversation.isPinned)}>
                        <PinIcon size={15} />
                        {activeConversation.isPinned ? 'Unpin chat' : 'Pin chat'}
                      </button>
                      <button type="button" onClick={() => void handleConversationPreference('isMuted', !activeConversation.isMuted)}>
                        <BellOffIcon size={15} />
                        {activeConversation.isMuted ? 'Unmute chat' : 'Mute chat'}
                      </button>
                      <button type="button" onClick={() => void handleConversationPreference('isArchived', !activeConversation.isArchived)}>
                        <ArchiveIcon size={15} />
                        {activeConversation.isArchived ? 'Return to chats' : 'Archive chat'}
                      </button>
                      {!isDesktop ? (
                        <button type="button" onClick={() => {
                          setChatMenuOpen(false);
                          closeMobileConversation();
                        }}>
                          <ArrowLeftIcon size={15} />
                          Back to chats
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </header>

              {conversationSearchOpen ? (
                <div className="private-message-search">
                  <SearchIcon size={16} />
                  <input
                    value={conversationSearch}
                    onChange={(event) => setConversationSearch(event.target.value)}
                    placeholder="Search messages"
                    autoFocus
                  />
                </div>
              ) : null}

              <div className="private-message-stream meta-message-stream" ref={streamRef}>
                {messageBusy && messages.length === 0 ? (
                  <div className="meta-empty">Loading conversation.</div>
                ) : null}
                {!messageBusy && messages.length === 0 ? (
                  <div className="private-empty-guide private-empty-guide--conversation">
                    <strong>First message</strong>
                    <span>Send text, image, file, or voice. Replies, edits, read receipts, and phone alerts are active when the readiness card is live.</span>
                  </div>
                ) : null}
                {hasOlderMessages && messages.length > 0 && !conversationSearchOpen ? (
                  <button
                    type="button"
                    className="private-load-older"
                    onClick={handleLoadOlderMessages}
                    disabled={olderBusy}
                  >
                    {olderBusy ? 'Loading...' : 'Load earlier'}
                  </button>
                ) : null}
                {!messageBusy && messages.length > 0 && visibleMessages.length === 0 ? (
                  <div className="meta-empty">No matching messages.</div>
                ) : null}
                {displayedMessages.map((message) => (
                  message.type === 'date' ? (
                    <div key={message.id} className="private-date-separator">{message.label}</div>
                  ) : (
                    <article key={message.id} className={`meta-message ${message.direction} ${message.deliveryStatus ? `is-${message.deliveryStatus}` : ''} ${message.deletedAt ? 'is-deleted' : ''}`}>
                      {!message.deletedAt ? (
                        <button
                          type="button"
                          className="private-message-menu-trigger"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveActionMessageId((current) => current === message.id ? '' : message.id);
                          }}
                          aria-label="Message actions"
                          aria-expanded={activeActionMessageId === message.id}
                          title="Message actions"
                        >
                          <MoreVerticalIcon size={16} />
                        </button>
                      ) : null}
                      {activeActionMessageId === message.id ? (
                        <div className="private-message-actions" onClick={(event) => event.stopPropagation()}>
                          <button type="button" onClick={() => handleReplyToMessage(message)}>
                            <ReplyIcon size={15} />
                            <span>Reply</span>
                          </button>
                          <button type="button" onClick={() => void handleCopyMessage(message)}>
                            <CopyIcon size={15} />
                            <span>Copy</span>
                          </button>
                          {message.direction === 'outbound' ? (
                            <>
                              <button type="button" onClick={() => handleEditMessage(message)}>
                                <EditIcon size={15} />
                                <span>Edit</span>
                              </button>
                              <button type="button" className="is-danger" onClick={() => void handleDeleteMessage(message)}>
                                <TrashIcon size={15} />
                                <span>Delete</span>
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {message.replyTo ? (
                        <button
                          type="button"
                          className="private-reply-preview"
                          onClick={() => {
                            document.getElementById(`private-message-${message.replyTo.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                          }}
                        >
                          <strong>{message.replyTo.direction === 'outbound' ? 'You' : getProfileLabel(activeProfile)}</strong>
                          <span>{message.replyTo.text}</span>
                        </button>
                      ) : null}
                      <p id={`private-message-${message.id}`}>
                        {message.deletedAt ? 'Deleted message' : message.text}
                      </p>
                      {message.attachment?.url ? (
                        message.attachment.type.startsWith('image/') ? (
                          <a href={message.attachment.url} target="_blank" rel="noreferrer" className="private-message-attachment">
                            <img src={message.attachment.url} alt={message.attachment.name} />
                          </a>
                        ) : message.attachment.type.startsWith('audio/') ? (
                          <audio className="private-message-audio" controls src={message.attachment.url} preload="metadata" />
                        ) : (
                          <a href={message.attachment.url} target="_blank" rel="noreferrer" className="private-message-file">
                            <PaperclipIcon size={16} />
                            <span>{message.attachment.name}</span>
                          </a>
                        )
                      ) : null}
                      <span>
                        {formatTime(message.createdAt)}
                        {message.editedAt && !message.deletedAt ? <em>edited</em> : null}
                        {message.direction === 'outbound' ? (
                          message.deliveryStatus === 'failed' ? (
                            <button
                              type="button"
                              className="private-retry-button"
                              onClick={() => handleRetryMessage(message)}
                            >
                              <RefreshIcon size={13} />
                              Retry
                            </button>
                          ) : (
                            <MessageState status={message.deliveryStatus} />
                          )
                        ) : null}
                      </span>
                    </article>
                  )
                ))}
              </div>

              <div className="private-composer meta-composer">
                {replyTarget || editingMessage ? (
                  <div className="private-composer-context">
                    <span>
                      <strong>{editingMessage ? 'Editing' : 'Replying'}</strong>
                      {editingMessage
                        ? (editingMessage.text || 'Message')
                        : (replyTarget?.text || replyTarget?.attachment?.name || 'Attachment')}
                    </span>
                    <button type="button" onClick={clearComposerMode} aria-label="Cancel composer mode">
                      <XIcon size={16} />
                    </button>
                  </div>
                ) : null}
                <input
                  ref={fileInputRef}
                  className="private-hidden-input"
                  type="file"
                  onChange={(event) => {
                    void handleAttachment(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <input
                  ref={imageInputRef}
                  className="private-hidden-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    void handleAttachment(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="private-composer-icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attachmentBusy}
                  aria-label="Attach file"
                >
                  <PaperclipIcon size={20} />
                </button>
                <button
                  type="button"
                  className="private-composer-icon private-image-button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={attachmentBusy}
                  aria-label="Attach image"
                >
                  <ImageIcon size={20} />
                </button>
                <div className="meta-composer-input">
                  <textarea
                    ref={draftRef}
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    rows={1}
                    placeholder={`Message ${getProfileLabel(activeProfile)}`}
                    maxLength={4000}
                  />
                  <button
                    type="button"
                    className="private-emoji-button"
                    onClick={() => setEmojiOpen((current) => !current)}
                    aria-label="Choose emoji"
                  >
                    <SmileIcon size={19} />
                  </button>
                  {emojiOpen ? (
                    <div className="private-emoji-menu">
                      {EMOJI_CHOICES.map((emoji) => (
                        <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {draft.trim() ? (
                  <button
                    type="button"
                    className="private-send-button"
                    onClick={handleSend}
                    disabled={sendBusy}
                    aria-label="Send message"
                  >
                    <SendIcon size={20} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`private-send-button ${recording ? 'is-recording' : ''}`}
                    onClick={handleVoiceNote}
                    disabled={attachmentBusy}
                    aria-label={recording ? 'Stop voice note' : 'Record voice note'}
                  >
                    <MicIcon size={20} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="meta-conversation-placeholder">
              <strong>Select a chat.</strong>
              <span>Press New chat, search a handle, then send the first message.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
