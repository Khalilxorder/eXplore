'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { postChat } from '../lib/api';
import { SendIcon, SparklesIcon, TrashIcon, XIcon } from './Icons';

const STORAGE_KEY = 'explore-ai-chat-v1';

function loadMessages() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch (error) {
    return [];
  }
}

function saveMessages(messages) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  } catch (error) {
    // Chat remains usable when local storage is unavailable.
  }
}

function buildContextPrompt(context = {}) {
  if (context.prefilledQuestion) return context.prefilledQuestion;
  return [
    'Explain why this matters to me.',
    context.title ? `Title: ${context.title}` : '',
    context.source ? `Source: ${context.source}` : '',
    context.summary ? `Context: ${context.summary}` : '',
    context.url ? `Link: ${context.url}` : '',
  ].filter(Boolean).join('\n');
}

function MessageBody({ text = '' }) {
  return String(text)
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph, index) => <p key={index}>{paragraph}</p>);
}

export default function AiChatPanel({
  isOpen,
  onClose,
  initialContext = null,
  onContextConsumed,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seededContextRef = useRef('');
  const endRef = useRef(null);

  useEffect(() => {
    setMessages(loadMessages());
  }, []);

  useEffect(() => {
    saveMessages(messages);
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const ask = useCallback(async (question) => {
    const text = String(question || '').trim();
    if (!text || busy) return;
    const userMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage].slice(-20);
    setMessages(nextMessages);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const result = await postChat(nextMessages, 'news', {
        mode: 'solo',
        modelPreference: 'auto',
      });
      const reply = String(result?.reply || '').trim();
      if (!reply) throw new Error('The assistant returned an empty response.');
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: reply,
          provider: result?.provider || '',
          model: result?.model || '',
        },
      ].slice(-40));
    } catch (requestError) {
      setError(requestError.message || 'The assistant could not respond.');
    } finally {
      setBusy(false);
    }
  }, [busy, messages]);

  useEffect(() => {
    if (!isOpen || !initialContext) return;
    const key = JSON.stringify(initialContext);
    if (seededContextRef.current === key) return;
    seededContextRef.current = key;
    const prompt = buildContextPrompt(initialContext);
    onContextConsumed?.();
    void ask(prompt);
  }, [ask, initialContext, isOpen, onContextConsumed]);

  const handleSubmit = (event) => {
    event.preventDefault();
    void ask(input);
  };

  const clearChat = () => {
    setMessages([]);
    setError('');
    saveMessages([]);
  };

  return (
    <>
      {isOpen ? <div className="ai-panel-backdrop" onClick={onClose} aria-hidden="true" /> : null}
      <aside
        className={`explore-ai-panel ${isOpen ? 'explore-ai-panel--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="eXplore AI"
        aria-hidden={!isOpen}
      >
        <header className="explore-ai-header">
          <div>
            <SparklesIcon size={18} />
            <strong>eXplore AI</strong>
          </div>
          <div>
            <button type="button" className="btn-icon btn-ghost" onClick={clearChat} aria-label="Clear chat" title="Clear chat">
              <TrashIcon size={18} />
            </button>
            <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Close AI chat" title="Close">
              <XIcon size={19} />
            </button>
          </div>
        </header>

        <div className="explore-ai-messages" aria-live="polite">
          {!messages.length ? (
            <div className="explore-ai-empty">
              <SparklesIcon size={24} />
              <p>Ask about an event, source, topic, or decision.</p>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`explore-ai-message explore-ai-message--${message.role}`}>
              <MessageBody text={message.content} />
              {message.role === 'assistant' && (message.provider || message.model) ? (
                <span>{[message.provider, message.model].filter(Boolean).join(' · ')}</span>
              ) : null}
            </article>
          ))}
          {busy ? (
            <div className="explore-ai-thinking">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {error ? <p className="explore-ai-error" role="alert">{error}</p> : null}
          <div ref={endRef} />
        </div>

        <form className="explore-ai-composer" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            placeholder="Ask eXplore..."
            aria-label="Message eXplore AI"
          />
          <button type="submit" className="btn-icon btn-primary" disabled={!input.trim() || busy} aria-label="Send">
            <SendIcon size={19} />
          </button>
        </form>
      </aside>
    </>
  );
}

export function AiChatToggleButton({ onClick, isOpen }) {
  return (
    <button
      type="button"
      className={`explore-ai-toggle ${isOpen ? 'explore-ai-toggle--open' : ''}`}
      onClick={onClick}
      aria-label={isOpen ? 'Close AI chat' : 'Open AI chat'}
      title={isOpen ? 'Close AI chat' : 'Ask eXplore AI'}
    >
      {isOpen ? <XIcon size={20} /> : <SparklesIcon size={20} />}
    </button>
  );
}
