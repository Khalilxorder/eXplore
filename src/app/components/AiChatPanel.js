'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { postChat } from '../lib/api';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';

/**
 * Floating bottom-center AI chat panel — ChatGPT-style.
 * Toggle pill sits above the bottom nav. Panel pops up from it.
 *
 * All AI calls go through postChat() from lib/api, which attaches the
 * Supabase Bearer token automatically, so track_topic / avoid_topic
 * mutations write to the signed-in user's workspace instead of 'guest'.
 */

// ── localStorage key ──────────────────────────────────────────────────
const STORAGE_KEY = 'explore-ai-chats';
const EXPLORE_FEED_REFRESH_EVENT = 'explore-feed-refresh';

// ── Helpers ──────────────────────────────────────────────────────────
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadChatState() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveChatState(state) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable — ignore
  }
}

function getLocalChatFallback() {
  const saved = loadChatState();
  if (saved?.conversations?.length) {
    const activeConversationId = saved.conversations.find((c) => c.id === saved.activeConversationId)
      ? saved.activeConversationId
      : saved.conversations[0].id;
    return { conversations: saved.conversations, activeConversationId };
  }

  const first = createConversation();
  return { conversations: [first], activeConversationId: first.id };
}

function isMissingAiChatSchemaError(error) {
  const code = String(error?.code || '');
  const message = [
    error?.message,
    error?.details,
    error?.hint,
  ].filter(Boolean).join(' ').toLowerCase();

  return code === 'PGRST205'
    || message.includes('ai_chats')
    || message.includes('ai_messages')
    || message.includes('schema cache');
}

function syncFeedAfterChatAction(payload = {}) {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (!['track_topic', 'avoid_topic'].includes(action) || typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(EXPLORE_FEED_REFRESH_EVENT));
}

function buildTitle(content = '') {
  const text = String(content || '').trim();
  if (!text) return 'New conversation';
  const words = text.split(/\s+/);
  const short = words.slice(0, 7).join(' ');
  return short.length < text.length ? `${short}…` : short;
}

function createConversation() {
  return {
    id: uuid(),
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    messages: [],
  };
}

// ── Icons ──────────────────────────────────────────────────────────────
function ChatIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SparkleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 L13.5 9 L20 10.5 L13.5 12 L12 19 L10.5 12 L4 10.5 L10.5 9 Z" />
    </svg>
  );
}

function ChevronDownIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SendIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function TrashIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function MenuIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

// ── Typing indicator ───────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="ai-typing-dots" aria-label="AI is thinking">
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────
function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`ai-msg-row ${isUser ? 'ai-msg-row--user' : 'ai-msg-row--bot'}`}>
      {!isUser && (
        <div className="ai-msg-avatar" aria-hidden="true">
          <span>✦</span>
        </div>
      )}
      <div className={`ai-msg-bubble ${isUser ? 'ai-msg-bubble--user' : 'ai-msg-bubble--bot'}`}>
        <p className="ai-msg-text">{message.content}</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────
// initialContext: optional { title, summary, source, url } — pre-seeds a new
// conversation focused on that specific news item.
export default function AiChatPanel({ isOpen, onClose, initialContext = null, onContextConsumed }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeContext, setActiveContext] = useState(null); // tracks current page context label
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [useLocalChatStorage, setUseLocalChatStorage] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const schemaFallbackLoggedRef = useRef(false);
  const { user } = useAuth();

  // ── Initialise from Supabase / localStorage ──────────────────────────
  useEffect(() => {
    let active = true;

    if (!user) {
      // Guest mode: load from localStorage
      setUseLocalChatStorage(true);
      const fallback = getLocalChatFallback();
      setConversations(fallback.conversations);
      setActiveId(fallback.activeConversationId);
      return;
    }

    // Authenticated mode: load from Supabase
    setUseLocalChatStorage(false);
    setLoading(true);
    void (async () => {
      try {
        // 1. Check and migrate any guest chats first
        const guestState = loadChatState();
        if (guestState?.conversations?.length) {
          for (const guestConv of guestState.conversations) {
            try {
              const { error: chatInsErr } = await supabase
                .from('ai_chats')
                .insert({
                  id: guestConv.id,
                  user_id: user.id,
                  title: guestConv.title,
                  created_at: guestConv.createdAt
                });

              if (chatInsErr) throw chatInsErr;

              if (guestConv.messages?.length) {
                const messageInserts = guestConv.messages.map(m => ({
                  chat_id: guestConv.id,
                  role: m.role,
                  content: m.content
                }));
                const { error: messageInsertError } = await supabase.from('ai_messages').insert(messageInserts);
                if (messageInsertError) throw messageInsertError;
              }
            } catch (migErr) {
              if (isMissingAiChatSchemaError(migErr)) {
                throw migErr;
              }
              console.error('Failed to migrate guest conversation', guestConv.id, migErr);
            }
          }
          // Clear local guest cache
          localStorage.removeItem(STORAGE_KEY);
        }

        // 2. Fetch all chats and messages from Supabase
        const { data: chats, error: chatsError } = await supabase
          .from('ai_chats')
          .select('*')
          .order('created_at', { ascending: false });

        if (chatsError) throw chatsError;

        const { data: messages, error: msgsError } = await supabase
          .from('ai_messages')
          .select('*')
          .order('created_at', { ascending: true });

        if (msgsError) throw msgsError;

        if (!active) return;

        if (chats && chats.length > 0) {
          const loadedConvs = chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            createdAt: chat.created_at,
            messages: (messages || [])
              .filter(m => m.chat_id === chat.id)
              .map(m => ({ role: m.role, content: m.content }))
          }));
          setConversations(loadedConvs);
          setActiveId(loadedConvs[0].id);
        } else {
          // No chats found in database and nothing migrated. Create a first clean chat.
          const first = createConversation();
          const { error: firstChatError } = await supabase
            .from('ai_chats')
            .insert({ id: first.id, user_id: user.id, title: first.title, created_at: first.createdAt });
          if (firstChatError) throw firstChatError;
          setConversations([first]);
          setActiveId(first.id);
        }
      } catch (err) {
        if (!active) return;
        const fallback = getLocalChatFallback();
        setUseLocalChatStorage(true);
        setConversations(fallback.conversations);
        setActiveId(fallback.activeConversationId);
        if (isMissingAiChatSchemaError(err)) {
          if (!schemaFallbackLoggedRef.current) {
            schemaFallbackLoggedRef.current = true;
            console.info('AI chat Supabase tables are not deployed; using local chat storage.');
          }
        } else {
          console.error('Failed to load AI chats from Supabase; using local chat storage', err);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user]);

  // ── Pre-seed a conversation when a news item context is injected ──────
  useEffect(() => {
    if (!initialContext || !isOpen) return;

    const { title, summary, source, prefilledQuestion } = initialContext;

    // Store the context label for the banner
    setActiveContext(title || 'this article');

    // If a chip question was tapped, use that directly; otherwise auto-summarise
    const userQuestion = prefilledQuestion
      ? prefilledQuestion
      : `Please summarize and explain this article:`;

    const seedText = [
      userQuestion,
      !prefilledQuestion && title ? `Title: ${title}` : null,
      !prefilledQuestion && source ? `Source: ${source}` : null,
      !prefilledQuestion && summary ? `Content: ${summary}` : null,
      prefilledQuestion && title ? `(Article: "${title.slice(0, 80)}")` : null,
    ].filter(Boolean).join('\n');

    const newConv = {
      ...createConversation(),
      title: buildTitle(prefilledQuestion || title || 'Article summary'),
      messages: [{ role: 'user', content: seedText }],
    };

    if (user && !useLocalChatStorage) {
      void supabase
        .from('ai_chats')
        .insert({ id: newConv.id, user_id: user.id, title: newConv.title, created_at: newConv.createdAt })
        .then(() => {
          setTimeout(() => { void triggerAutoReply(newConv, seedText); }, 120);
        })
        .catch((err) => {
          if (isMissingAiChatSchemaError(err)) {
            setUseLocalChatStorage(true);
          } else {
            console.error('Failed to save article chat to Supabase', err);
          }
          setTimeout(() => { void triggerAutoReply(newConv, seedText); }, 120);
        });
    } else {
      setTimeout(() => { void triggerAutoReply(newConv, seedText); }, 120);
    }

    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newConv.id);
    setInput('');
    setSidebarOpen(false);

    // Tell parent we consumed the context so it can clear it
    onContextConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContext, isOpen, useLocalChatStorage, user]);

  // ── Persist on every state change (Guest mode only) ────────────────
  useEffect(() => {
    if (!conversations.length || (user && !useLocalChatStorage)) return;
    saveChatState({ conversations, activeConversationId: activeId });
  }, [conversations, activeId, user, useLocalChatStorage]);

  // ── Auto-scroll ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [conversations, activeId, loading, isOpen]);

  // ── Focus input when panel opens ───────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen]);

  // ── Derived active conversation ────────────────────────────────────
  const activeConversation = conversations.find((c) => c.id === activeId) || conversations[0];

  // ── Auto-reply helper (used when context is pre-seeded) ────────────
  const triggerAutoReply = useCallback(async (conv, seedText) => {
    setLoading(true);
    setError('');
    const convId = conv.id;

    if (user && !useLocalChatStorage) {
      try {
        const { error: seedError } = await supabase
          .from('ai_messages')
          .insert({ chat_id: convId, role: 'user', content: seedText });
        if (seedError) throw seedError;
      } catch (err) {
        if (isMissingAiChatSchemaError(err)) {
          setUseLocalChatStorage(true);
        } else {
          console.error('Failed to save seed message to Supabase', err);
        }
      }
    }

    try {
      const data = await postChat([{ role: 'user', content: seedText }], 'news');
      if (!data) throw new Error('No response from server.');
      const replyText = String(data?.reply || '').trim();
      if (!replyText) throw new Error('Empty response');
      syncFeedAfterChatAction(data);

      if (user && !useLocalChatStorage) {
        try {
          const { error: replyError } = await supabase
            .from('ai_messages')
            .insert({ chat_id: convId, role: 'assistant', content: replyText });
          if (replyError) throw replyError;
        } catch (err) {
          if (isMissingAiChatSchemaError(err)) {
            setUseLocalChatStorage(true);
          } else {
            console.error('Failed to save auto reply to Supabase', err);
          }
        }
      }

      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id
            ? { ...c, messages: [...c.messages, { role: 'assistant', content: replyText }] }
            : c
        )
      );
    } catch (err) {
      setError(String(err?.message || 'Could not get a response. Type a follow-up question below.'));
    } finally {
      setLoading(false);
    }
  }, [user, useLocalChatStorage]);

  // ── Helpers ─────────────────────────────────────────────────────────
  const updateConversation = useCallback((id, updater) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? updater(c) : c))
    );
  }, []);

  const startNewConversation = useCallback(async () => {
    const next = createConversation();
    if (user && !useLocalChatStorage) {
      try {
        const { error: newChatError } = await supabase
          .from('ai_chats')
          .insert({ id: next.id, user_id: user.id, title: next.title, created_at: next.createdAt });
        if (newChatError) throw newChatError;
      } catch (err) {
        if (isMissingAiChatSchemaError(err)) {
          setUseLocalChatStorage(true);
        } else {
          console.error('Failed to save new chat to Supabase', err);
        }
      }
    }
    setConversations((prev) => [next, ...prev]);
    setActiveId(next.id);
    setSidebarOpen(false);
    setActiveContext(null);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [user, useLocalChatStorage]);

  const switchConversation = useCallback((id) => {
    setActiveId(id);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const deleteConversation = useCallback((id) => {
    if (user && !useLocalChatStorage) {
      void supabase
        .from('ai_chats')
        .delete()
        .eq('id', id)
        .then(({ error: deleteError }) => {
          if (deleteError) throw deleteError;
        })
        .catch((err) => {
          if (isMissingAiChatSchemaError(err)) {
            setUseLocalChatStorage(true);
          } else {
            console.error('Failed to delete chat from Supabase', err);
          }
        });
    }
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (!next.length) {
        const fresh = createConversation();
        if (user && !useLocalChatStorage) {
          void supabase
            .from('ai_chats')
            .insert({ id: fresh.id, user_id: user.id, title: fresh.title, created_at: fresh.createdAt })
            .then(({ error: replacementError }) => {
              if (replacementError) throw replacementError;
            })
            .catch((err) => {
              if (isMissingAiChatSchemaError(err)) {
                setUseLocalChatStorage(true);
              } else {
                console.error('Failed to save replacement chat to Supabase', err);
              }
            });
        }
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) {
        setActiveId(next[0].id);
      }
      return next;
    });
  }, [activeId, user, useLocalChatStorage]);

  // ── Send message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeConversation) return;

    setInput('');
    setError('');

    // Optimistically append user message
    const userMsg = { role: 'user', content: text };
    const convId = activeConversation.id;
    const isFirstMessage = activeConversation.messages.length === 0;
    const newTitle = isFirstMessage ? buildTitle(text) : activeConversation.title;

    if (user && !useLocalChatStorage) {
      try {
        if (isFirstMessage) {
          const { error: titleError } = await supabase
            .from('ai_chats')
            .update({ title: newTitle })
            .eq('id', convId);
          if (titleError) throw titleError;
        }
        const { error: userMessageError } = await supabase
          .from('ai_messages')
          .insert({ chat_id: convId, role: 'user', content: text });
        if (userMessageError) throw userMessageError;
      } catch (err) {
        if (isMissingAiChatSchemaError(err)) {
          setUseLocalChatStorage(true);
        } else {
          console.error('Failed to save user message to Supabase', err);
        }
      }
    }

    updateConversation(convId, (c) => {
      return {
        ...c,
        title: isFirstMessage ? newTitle : c.title,
        messages: [...c.messages, userMsg],
      };
    });

    setLoading(true);

    try {
      const allMessages = [...(activeConversation.messages || []), userMsg];
      const data = await postChat(allMessages, 'news');

      if (!data) {
        throw new Error('No response from the server. Check your connection and try again.');
      }

      const replyText = String(data?.reply || '').trim();

      if (!replyText) {
        throw new Error('The AI returned an empty response. Please try again.');
      }

      syncFeedAfterChatAction(data);

      if (user && !useLocalChatStorage) {
        try {
          const { error: assistantMessageError } = await supabase
            .from('ai_messages')
            .insert({ chat_id: convId, role: 'assistant', content: replyText });
          if (assistantMessageError) throw assistantMessageError;
        } catch (err) {
          if (isMissingAiChatSchemaError(err)) {
            setUseLocalChatStorage(true);
          } else {
            console.error('Failed to save assistant message to Supabase', err);
          }
        }
      }

      updateConversation(convId, (c) => ({
        ...c,
        messages: [...c.messages, { role: 'assistant', content: replyText }],
      }));
    } catch (err) {
      setError(String(err?.message || 'Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeConversation, updateConversation, user, useLocalChatStorage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }, [sendMessage]);

  // ── Nothing to render until client-side init ───────────────────────
  if (!activeConversation) return null;

  const messages = activeConversation.messages || [];

  // Quick-question chips shown in the empty state
  const defaultChips = [
    "What's the latest news today?",
    'What is eXplore and how does it work?',
    'What AI releases happened recently?',
    'What should I pay attention to right now?',
  ];

  return (
    <>
      {/* Backdrop — closes panel on outside tap */}
      {isOpen && (
        <div
          className="ai-panel-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* ── Floating panel ── */}
      <div
        className={`ai-chat-panel ${isOpen ? 'ai-chat-panel--open' : ''}`}
        role="dialog"
        aria-label="eXplore AI chat"
        aria-modal="true"
        aria-hidden={!isOpen}
      >
        {/* Sidebar slide-over */}
        {sidebarOpen && (
          <div
            className="ai-sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside className={`ai-chat-sidebar ${sidebarOpen ? 'ai-chat-sidebar--open' : ''}`}>
          <div className="ai-sidebar-header">
            <span className="ai-sidebar-title">History</span>
            <button
              type="button"
              className="ai-sidebar-new"
              onClick={startNewConversation}
              aria-label="New conversation"
              title="New conversation"
            >
              <PlusIcon />
            </button>
          </div>
          <ul className="ai-sidebar-list" role="listbox" aria-label="Conversation list">
            {conversations.map((conv) => (
              <li
                key={conv.id}
                className={`ai-sidebar-item ${conv.id === activeId ? 'ai-sidebar-item--active' : ''}`}
                role="option"
                aria-selected={conv.id === activeId}
              >
                <button
                  type="button"
                  className="ai-sidebar-item-btn"
                  onClick={() => switchConversation(conv.id)}
                >
                  <span className="ai-sidebar-item-title">{conv.title}</span>
                  <span className="ai-sidebar-item-date">
                    {new Date(conv.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </button>
                <button
                  type="button"
                  className="ai-sidebar-delete"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  aria-label={`Delete "${conv.title}"`}
                  title="Delete"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── Main chat area ── */}
        <div className="ai-chat-main">

          {/* Header */}
          <div className="ai-chat-header">
            <button
              type="button"
              className="ai-header-btn"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle history"
              title="History"
            >
              <MenuIcon />
            </button>

            <div className="ai-header-center">
              <SparkleIcon size={14} />
              <span className="ai-header-title">eXplore AI</span>
            </div>

            <div className="ai-header-right">
              <button
                type="button"
                className="ai-header-btn"
                onClick={startNewConversation}
                aria-label="New conversation"
                title="New chat"
              >
                <PlusIcon size={17} />
              </button>
              <button
                type="button"
                className="ai-header-btn"
                onClick={onClose}
                aria-label="Close chat"
                title="Close"
              >
                <ChevronDownIcon size={20} />
              </button>
            </div>
          </div>

          {/* Page context banner */}
          {activeContext && messages.length > 0 && (
            <div className="ai-context-banner">
              <span className="ai-context-banner-icon">📄</span>
              <span className="ai-context-banner-text">
                Discussing: {activeContext}
              </span>
              <button
                type="button"
                className="ai-header-btn"
                style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0 }}
                onClick={() => setActiveContext(null)}
                aria-label="Dismiss context"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="ai-chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
            {messages.length === 0 && !loading && (
              <div className="ai-chat-empty">
                <div className="ai-chat-empty-icon" aria-hidden="true">
                  <SparkleIcon size={32} />
                </div>
                <h2 className="ai-chat-empty-title">How can I help?</h2>
                <p className="ai-chat-empty-sub">
                  Ask about any article, the latest news, or anything on your mind.
                </p>
                <div className="ai-chat-prompts">
                  {defaultChips.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="ai-chat-prompt-chip"
                      onClick={() => {
                        setInput(prompt);
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={`${activeId}-${i}`} message={msg} />
            ))}

            {loading && (
              <div className="ai-msg-row ai-msg-row--bot">
                <div className="ai-msg-avatar" aria-hidden="true"><span>✦</span></div>
                <div className="ai-msg-bubble ai-msg-bubble--bot ai-msg-bubble--typing">
                  <TypingDots />
                </div>
              </div>
            )}

            {error && (
              <div className="ai-chat-error" role="alert">
                <span className="ai-chat-error-icon">⚠</span>
                {error}
              </div>
            )}

            <div ref={messagesEndRef} aria-hidden="true" />
          </div>

          {/* Input row */}
          <div className="ai-chat-input-row">
            <div className="ai-chat-input-wrap">
              <textarea
                ref={inputRef}
                id="ai-chat-input"
                className="ai-chat-input"
                placeholder="Ask anything…"
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-label="Chat message input"
                disabled={loading}
              />
              <button
                type="button"
                className={`ai-chat-send ${input.trim() && !loading ? 'ai-chat-send--active' : ''}`}
                onClick={() => void sendMessage()}
                disabled={!input.trim() || loading}
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            </div>
            <p className="ai-chat-disclaimer">eXplore AI can make mistakes. Verify important info.</p>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Floating pill toggle button ────────────────────────────────────────
// Sits bottom-center above the bottom nav. Hidden when panel is open.
export function AiChatToggleButton({ onClick, isOpen = false, hasUnread = false }) {
  return (
    <button
      type="button"
      id="ai-chat-toggle"
      className={`ai-chat-toggle-btn${isOpen ? ' ai-chat-toggle-btn--hidden' : ''}`}
      onClick={onClick}
      aria-label="Open AI chat"
      title="Chat with eXplore AI"
      aria-expanded={isOpen}
    >
      <SparkleIcon size={15} />
      <span>Ask AI</span>
      {hasUnread && <span className="ai-chat-toggle-dot" aria-hidden="true" />}
    </button>
  );
}
