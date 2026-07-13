import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const screen = readFileSync('src/app/components/MessagingHubScreen.js', 'utf8');
const api = readFileSync('src/app/lib/api.js', 'utf8');
const shell = readFileSync('src/app/page.js', 'utf8');
const appShell = readFileSync('src/app/components/AppShell.js', 'utf8');
const css = readFileSync('src/app/globals.css', 'utf8');

const requiredScreenMarkers = [
  ['account gate', 'Sign In First'],
  ['private profile handle', 'Choose your handle.'],
  ['copy handle action', 'Copy my handle'],
  ['new chat action', 'New chat'],
  ['username search', 'Search username'],
  ['conversation search', 'Search messages'],
  ['reply action', 'Reply'],
  ['copy action', 'Copy'],
  ['edit action', 'Edit'],
  ['delete action', 'Delete'],
  ['load older messages', 'Load earlier'],
  ['file attachment button', 'Attach file'],
  ['image attachment button', 'Attach image'],
  ['voice note button', 'Record voice note'],
  ['typing indicator', 'typing...'],
  ['read receipt state', 'DoubleCheckIcon'],
  ['pin chat action', 'Pin chat'],
  ['mute chat action', 'Mute chat'],
  ['archive chat action', 'Archive chat'],
  ['private push dispatch', 'notifyPrivateMessage'],
  ['browser foreground notification', 'sendPriorityNotification'],
  ['message realtime subscription', 'subscribeToPrivateMessages'],
  ['typing realtime subscription', 'subscribeToPrivateTyping'],
  ['messaging readiness card', 'Messaging proof'],
  ['readiness blockers toggle', 'private-readiness-toggle'],
  ['readiness refresh', 'fetchPrivateMessagingReadiness'],
  ['phone alerts setup', 'Enable phone alerts'],
  ['native push registration', 'registerDeviceForPush'],
  ['backend push token registration', 'registerPushToken'],
  ['notification preference enablement', 'updateNotificationPreferences'],
  ['first-run connection guide', 'Start with a handle'],
];

for (const [label, marker] of requiredScreenMarkers) {
  assert.ok(screen.includes(marker), `Messaging UI missing ${label}: ${marker}`);
}

assert.match(
  api,
  /export async function fetchPrivateMessagingReadiness\(\)[\s\S]*\/api\/v1\/messages\/readiness/,
  'API client must expose private messaging readiness.',
);

assert.match(
  appShell,
  /id:\s*'messages'[\s\S]*label:\s*'Messages'[\s\S]*shell-messages-button[\s\S]*onTabChange\?\.\('messages'\)/,
  'App shell must expose Messages outside the exploration category row.',
);

assert.match(
  appShell,
  /const TABS = \[[\s\S]*id:\s*'explore'[\s\S]*label:\s*'Feed'[\s\S]*id:\s*'messages'[\s\S]*label:\s*'Messages'[\s\S]*id:\s*'you'[\s\S]*label:\s*'You'[\s\S]*\];/,
  'Bottom navigation must be limited to Feed, Messages, and You.',
);

assert.doesNotMatch(
  appShell,
  /const TABS = \[[\s\S]*id:\s*'search'[\s\S]*\];/,
  'Search must not appear in the bottom navigation.',
);

assert.doesNotMatch(
  appShell,
  /const TABS = \[[\s\S]*id:\s*'saved'[\s\S]*\];/,
  'Saved must not appear in the bottom navigation; keep it under You.',
);

assert.doesNotMatch(
  shell,
  /EXPLORE_SECTION_ITEMS[\s\S]*label:\s*'Messages'/,
  'Messages must not appear in the exploration category row.',
);

const requiredCssMarkers = [
  '.private-chat-layout',
  '.private-thread-rail',
  '.private-conversation-panel',
  '.private-message-stream',
  '.private-composer',
  '.private-readiness-card',
  '.private-new-chat-button',
  '.private-empty-guide',
  '.private-chat-layout.is-conversation-open .private-thread-rail',
  '.private-chat-layout:not(.is-conversation-open) .private-conversation-panel',
];

for (const marker of requiredCssMarkers) {
  assert.ok(css.includes(marker), `Messaging CSS missing marker: ${marker}`);
}

console.log(JSON.stringify({
  passed: true,
  checked: {
    uiMarkers: requiredScreenMarkers.length,
    cssMarkers: requiredCssMarkers.length,
    apiReadiness: true,
    shellMessages: true,
  },
}, null, 2));
