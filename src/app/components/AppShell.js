'use client';
import { BellIcon, CompassIcon, UserIcon, MessagesBubbleIcon, SparklesIcon } from './Icons';
import WeatherWidget from './WeatherWidget';

function ChevronLeftIcon() {
  return (
    <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1 1 9l8 8" />
    </svg>
  );
}

const TABS = [
  { id: 'explore',  label: 'Feed',     Icon: CompassIcon },
  { id: 'messages', label: 'Messages', Icon: MessagesBubbleIcon },
  { id: 'you',      label: 'You',      Icon: UserIcon },
];

const ROOT_SCREENS = new Set([
  'home',
  'videos',
  'culture',
  'opportunities',
  'scientist-tool',
  'nobel-prizes',
  'digest',
  'written-news',
  'topics',
  'search',
  'preferences',
  'messages',
  'mail',
  'shared-experience',
]);

export default function AppShell({
  children,
  activeTab = 'explore',
  title = 'eXplore',
  onTabChange,
  onBack,
  onHomePress,
  screen = 'home',
  shellVariant = 'default',
  radarActive = false,
  onOpenRadar,
  onAskAi,
  chatOpen = false,
}) {
  const isSubScreen = !ROOT_SCREENS.has(screen);
  const showBack = isSubScreen && typeof onBack === 'function';

  return (
    <div
      className={`app-shell ${shellVariant === 'inbox' ? 'inbox-shell' : ''}`}
      data-shell-variant={shellVariant}
      data-screen={screen}
      data-has-back={showBack ? 'true' : 'false'}
    >
      <div className="ambient-scene" aria-hidden="true">
        <div className="ambient-scene__sky" />
        <div className="ambient-scene__clouds" />
        <div className="ambient-scene__rain" />
        <div className="ambient-scene__flash" />
        <div className="ambient-scene__grid" />
      </div>

      <header className={`top-bar ${showBack ? 'has-back' : 'has-root'}`}>
        {/* Left: back button or wordmark */}
        <div className="top-bar-left">
          {showBack ? (
            <button
              type="button"
              className="top-bar-back"
              onClick={onBack}
              aria-label="Go back"
            >
              <ChevronLeftIcon />
              <span className="top-bar-back-label">Back</span>
            </button>
          ) : (
            <button
              type="button"
              className="top-bar-wordmark"
              onClick={onHomePress}
              aria-label="Go home"
              style={{ background: 'none', border: 'none', padding: 0, margin: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
            >
              <span>eXplore</span>
            </button>
          )}
        </div>

        {/* Center: page title */}
        <div className="top-bar-center">
          <span className="top-bar-title">{title}</span>
        </div>

        {/* Right: weather + profile avatar */}
        <div className="top-bar-right" style={{ gap: '6px' }}>
          <WeatherWidget />
          <button
            type="button"
            className={`shell-ai-button ${chatOpen ? 'active' : ''}`}
            onClick={onAskAi}
            aria-label="Ask AI"
            title="Chat with eXplore AI"
            style={{ position: 'relative' }}
          >
            <SparklesIcon size={18} />
          </button>
          <button
            type="button"
            className="shell-radar-button"
            onClick={onOpenRadar}
            aria-label="Priority alerts"
          >
            <BellIcon size={18} />
            {radarActive ? <span className="shell-radar-dot" aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            id="shell-messages-button"
            className="shell-messages-button"
            onClick={() => onTabChange?.('messages')}
            aria-label="Messages"
          >
            <MessagesBubbleIcon size={18} />
          </button>
          <button
            type="button"
            className="shell-profile-button"
            onClick={() => onTabChange?.('you')}
            aria-label="Profile"
          >
            <UserIcon size={18} />
          </button>
        </div>
      </header>

      <main className="main-content">
        {children}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              className={`nav-item ${active ? 'active' : ''}`}
              type="button"
              onClick={() => onTabChange?.(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
            >
              {active && <span className="nav-indicator" aria-hidden="true" />}
              <Icon size={22} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
