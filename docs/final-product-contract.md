# eXplore Final Product Contract

This document defines the exact, unambiguous criteria for what "done" means for each first-class area in the eXplore application. It serves as the authoritative boundary for the Direct Goal Match completion.

---

## 1. News

*   **Expected User Action:** User opens the app to the **Feed** tab. They can view ranked event cards, see why an event is shown, filter by priority (`Watch`, `Important`, `Direct`), and provide feedback.
*   **Expected Output:** An event-first (not feed-first) stream. Each item is a structured `event` object featuring:
    *   A visual cue (image or source favicon).
    *   A clean title.
    *   A 3-word meaning/takeaway.
    *   Priority indicator (`Watch`, `Important`, `Direct`).
    *   Source evidence & trust indicators (e.g., `Rank`, `Trust`, `Fresh`, `Why`).
    *   A clear "Why is this here?" explanation.
    *   Action button.
    *   Feedback buttons ("Why is this here?", "Never show this type").
*   **Required Backend Route:** 
    *   `GET /api/v1/template` (fetch ranked feed based on template rules)
    *   `POST /api/v1/interactions` (record feedback/dismissals)
*   **Required Database Table:** 
    *   `content_items` (stores ingested news/events)
    *   `interaction_events` (stores impressions, dwell, explicit feedback)
*   **Required Phone/Web Behavior:** 
    *   **Phone:** Bottom nav shows `Feed`. Top has horizontally scrollable exploration chips (News, Videos, Culture, Jobs, Scientist, Nobel, Digest, Written, Music, Mail).
    *   **Web:** Wider grid view with side-by-side console panels.
*   **Test Proof:** `npm run test:news-page` verifies the presence of event-only cards, visual cues, metrics, priority selectors, and the Claude Fable/Mythos ranking boost.

---

## 2. Notifications

*   **Expected User Action:** User configures priority rules for specific topics (e.g., "King Abdullah Schools"). They receive real-time push notifications on their phone for `Direct` priority events.
*   **Expected Output:** 
    *   `Watch`: Stored and ranked silently in the feed.
    *   `Important`: Pinned/top-ranked inside the app feed.
    *   `Direct`: Sends a real-time system notification (FCM on Android, Local Notification fallback).
    *   Each rule contains: topic, source list, trigger words, negative filters, freshness window, priority, reason, last checked time.
*   **Required Backend Route:**
    *   `GET /api/v1/devices/notification-status` (check token status)
    *   `POST /api/v1/devices/register` (register FCM token)
    *   `POST /api/v1/devices/preferences` (update notification preferences)
*   **Required Database Table:**
    *   `user_device_tokens` (registers devices and FCM tokens)
    *   `notification_rules` (stores structured watch/alert rules)
    *   `priority_alerts` (stores historical triggered alerts)
*   **Required Phone/Web Behavior:**
    *   **Phone:** Prompts for notification permission on first run. Receives push notification; tapping it opens the exact event detail screen.
    *   **Web:** Shows notification readiness status and lets user trigger test alerts.
*   **Test Proof:** `backend/test/pushDeliveryService.test.js` and `backend/test/alertRadarService.test.js` verify that alerts are correctly qualified and formatted. Phone proof registers token and logs successful FCM dispatch.

---

## 3. Messages

*   **Expected User Action:** User opens the **Messages** tab, searches for another user's handle, starts a chat, sends text/attachments, and receives real-time replies with typing indicators and read receipts.
*   **Expected Output:** A clean, 3-screen flow:
    1.  *Conversation List*: Active threads with search bar, pinned chats, and mute options.
    2.  *Active Chat*: Telegram-style message stream with compact header, fixed composer, and message options (reply, edit, delete).
    3.  *New Chat/Search*: Search for other users by handle.
*   **Required Backend Route:**
    *   `GET /api/v1/messages/conversations` (list threads)
    *   `GET /api/v1/messages/thread/:id` (fetch messages)
    *   `POST /api/v1/messages/send` (send message)
    *   `POST /api/v1/messages/readiness` (diagnostics check)
*   **Required Database Table:**
    *   `private_chat_handles` (user handles)
    *   `private_conversations` (chat threads)
    *   `private_messages` (individual messages)
*   **Required Phone/Web Behavior:**
    *   **Phone:** Full-screen layout. No exploration category bar, no oversized profile cards. Fixed bottom composer.
    *   **Web:** Split-pane view (thread list on left, active chat on right).
*   **Test Proof:** `npm run test:frontend` (runs `verify-private-messaging-ui.mjs`) and `backend/test/privateMessengerMigration.test.js` verify UI elements and database migrations. Multi-browser session test verifies two-way communication.

---

## 4. You / Profile

*   **Expected User Action:** User taps **You** tab to view their personal profile. They can view/edit their identity, goals, and interests, and view system diagnostics.
*   **Expected Output:** An organized, uncluttered profile screen with five editable groups:
    1.  *Life Narrative*: Highest-order interpretive frame (e.g., meaning-through-responsibility).
    2.  *Future Wish*: Personal North Star generated from onboarding/SELF.
    3.  *Current Goals*: Short-term goals with priority levels.
    4.  *Evidence From SELF*: Raw personality/cognitive style summary.
    5.  *Filters / Do-Not-Show*: Topics and sources to suppress.
*   **Required Backend Route:**
    *   `GET /api/v1/hierarchy` (fetch profile hierarchy)
    *   `POST /api/v1/hierarchy` (update profile hierarchy)
*   **Required Database Table:**
    *   `user_preference_profiles` (stores narrative, wish, and goals)
    *   `user_interests` & `user_goals` (individual mapped interests/goals)
*   **Required Phone/Web Behavior:**
    *   **Phone:** Bottom nav shows `You`. Contains settings, saved items, and rules.
    *   **Web:** Expanded dashboard showing all profile categories side-by-side.
*   **Test Proof:** `backend/test/hierarchy-and-template-routes.test.js` verifies the profile state can be retrieved and updated.

---

## 5. Rules

*   **Expected User Action:** User views or edits their adaptive rules under `You` -> `Rules`. They can add a rule like "Never show celebrity AI chatter" or "Prioritize official releases."
*   **Expected Output:** A simple card list of active rules. Rules are categorized into *Fixed* (immutable) and *Adaptive* (learned/editable).
*   **Required Backend Route:**
    *   `GET /api/v1/template` (fetches template rules)
    *   `POST /api/v1/template/refine` (add/modify rules)
*   **Required Database Table:**
    *   `user_adaptive_rules` (stores active rules and embeddings)
    *   `rule_versions` (stores history of rule updates)
*   **Required Phone/Web Behavior:** Simple, high-contrast list with "Delete" and "Refine" buttons.
*   **Test Proof:** `backend/test/template-system.test.js` verifies that rules are enforced during feed generation and that similar rules are merged instead of duplicated.

---

## 6. Sources

*   **Expected User Action:** User navigates to `You` -> `Sources` to see the registry of monitored sites, social channels, and feeds.
*   **Expected Output:** A structured list of sources grouped by category (AI, Regional Risk, Jobs, etc.). Each source shows:
    *   Status: `live`, `blocked`, `stale`, `official`.
    *   Last checked time.
    *   Trust score.
    *   Option to toggle (Enable/Disable/Exclude).
*   **Required Backend Route:**
    *   `GET /api/v1/sources/status` (readiness status)
    *   `POST /api/v1/sources/toggle` (enable/disable source)
*   **Required Database Table:**
    *   `content_sources` (stores registry of feeds and scraping endpoints)
*   **Required Phone/Web Behavior:**
    *   **Phone:** Scrollable list with status indicator dots (green/yellow/red).
    *   **Web:** Detailed grid with logs and raw scraping stats.
*   **Test Proof:** `backend/test/readiness-service.test.js` and `backend/test/sourcePacks.test.js` verify source status reporting and source pack toggling.

---

## 7. YouTube

*   **Expected User Action:** User selects the **Videos** tab in the Feed. They see highly personalized video recommendations.
*   **Expected Output:** An intelligent video lane. Videos are ranked by: deep fit, novelty, usefulness, credibility, and creator quality. Each video card displays:
    *   Thumbnail and duration.
    *   Channel name.
    *   "Why this video now" explanation.
    *   Category tag (AI, Culture, Psychology, etc.).
*   **Required Backend Route:**
    *   `GET /api/v1/discovery/youtube` (fetch ranked videos)
*   **Required Database Table:**
    *   `youtube_recommendations` (stores crawled and ranked videos)
*   **Required Phone/Web Behavior:** Full-width cards with inline video playback or direct link to YouTube app.
*   **Test Proof:** `backend/test/youtubeService.test.js` verifies YouTube scraper, transcript retrieval, and quota-based API key rotation.

---

## 8. Music / Xperience

*   **Expected User Action:** User opens the **Xperience** tab under `You`. They write a feeling, mood, or story (e.g., "driving through rain at night"), and the app reveals the closest matching songs.
*   **Expected Output:** A music discovery interface. Maps user input to hidden embedded songs using semantic embeddings. Displays matching songs with:
    *   Song title and artist.
    *   Match intensity score.
    *   Metadata: mood, symbolic pattern, season, memory type.
    *   Link to play on Spotify/Apple Music.
*   **Required Backend Route:**
    *   `POST /api/v1/experience/match` (match text to song embeddings)
*   **Required Database Table:**
    *   `music_tracks` (stores tracks, metadata, and embeddings)
*   **Required Phone/Web Behavior:** Night/romantic dark mode styling. Smooth micro-animations.
*   **Test Proof:** `backend/test/musicStatsImport.test.js` and `backend/test/xSuiteAndFormulation.test.js` verify experience service CRUD and matching logic.

---

## 9. Shared Experience

*   **Expected User Action:** User navigates to the **Shared** screen under `You`. They can collaborate with a brother or another account.
*   **Expected Output:** A shared workspace supporting:
    *   Shared video collections.
    *   Essays and notes under videos.
    *   Comments.
    *   Joint projects (goals, timeline, tasks).
    *   Uploaded voice recordings with automatic transcriptions.
*   **Required Backend Route:**
    *   `GET /api/v1/shared/projects` (list shared projects)
    *   `POST /api/v1/shared/interact` (add comment or update task)
*   **Required Database Table:**
    *   `shared_workspaces` (workspace definitions)
    *   `shared_items` (videos, recordings, notes)
    *   `shared_comments` (discussion thread)
*   **Required Phone/Web Behavior:** Real-time updates when a collaborator adds a comment or updates a task.
*   **Test Proof:** `backend/test/xSuiteAndFormulation.test.js` verifies shared experience data structures and collaboration routes.

---

## 10. Jobs

*   **Expected User Action:** User views the **Jobs** section inside the **Jobs** tab. They see filtered and ranked career opportunities.
*   **Expected Output:** Deduplicated job listings. Filter categories: Hungary, Remote, AI/Research, Visa-Friendly, Internships. Each card shows:
    *   Fit score.
    *   Deadline.
    *   Country/Location.
    *   Official source link.
    *   "Why relevant" description linked to the user's goals.
*   **Required Backend Route:**
    *   `GET /api/v1/opportunities/jobs` (fetch ranked jobs)
*   **Required Database Table:**
    *   `job_opportunities` (stores crawled jobs)
*   **Required Phone/Web Behavior:** Clean list view with quick-apply and save buttons.
*   **Test Proof:** `backend/test/opportunitiesService.test.js` verifies job ranking against user profile.

---

## 11. Scholarships

*   **Expected User Action:** User views the **Scholarships** section inside the **Jobs** tab. They see filtered academic funding opportunities.
*   **Expected Output:** Fully funded scholarships (Europe, Jordan, Hungary, DAAD, AI/CS) with official links only. Duplicate or expired listings are filtered out. Cards display:
    *   Funding level (fully funded, partial).
    *   Country.
    *   Deadline.
    *   Fit reason.
*   **Required Backend Route:**
    *   `GET /api/v1/opportunities/scholarships` (fetch ranked scholarships)
*   **Required Database Table:**
    *   `scholarship_opportunities` (stores crawled scholarships)
*   **Required Phone/Web Behavior:** High-contrast deadline countdowns and clean tags.
*   **Test Proof:** `backend/test/opportunitiesService.test.js` verifies scholarship retrieval and filtering.

---

## 12. Culture

*   **Expected User Action:** User taps **Culture** in the Feed. They see curated essays, philosophical discussions, and historical context.
*   **Expected Output:** Clean reading layout focusing on long-term value, Jordan Peterson themes, and biblical/mythic frameworks.
*   **Required Backend Route:**
    *   `GET /api/v1/culture` (fetch cultural items)
*   **Required Database Table:**
    *   `culture_items` (stores curated cultural content)
*   **Required Phone/Web Behavior:** Reader-optimized text layout, adjustable font sizes, night-mode support.
*   **Test Proof:** `backend/test/hierarchy-and-template-routes.test.js` verifies cultural content retrieval.

---

## 13. Leaders

*   **Expected User Action:** User views updates from specific people of interest (e.g., AI lab directors, regional specialists) under the Feed.
*   **Expected Output:** A filtered list of recent statements, tweets, or papers by tracked leaders.
*   **Required Backend Route:**
    *   `GET /api/v1/template` (filters items matching `peopleOfInterest`)
*   **Required Database Table:**
    *   `content_items` (filtered by author/source)
*   **Required Phone/Web Behavior:** Compact feed cards with "Leader" badges.
*   **Test Proof:** Tested via template-driven feed tests in `backend/test/template-system.test.js`.

---

## 14. Search

*   **Expected User Action:** User taps the **Search** icon in the header or navigates to Search under **You**. They type a query to find news, videos, or opportunities.
*   **Expected Output:** Hybrid search results (combining SQLite FTS5 text search and vector semantic search) with clear explanations of why matches are relevant.
*   **Required Backend Route:**
    *   `GET /api/v1/search` (execute hybrid search)
*   **Required Database Table:**
    *   `content_items` & `content_item_embeddings`
*   **Required Phone/Web Behavior:**
    *   **Phone:** Quick-access overlay.
    *   **Web:** Side-by-side search inputs and filter panels.
*   **Test Proof:** `backend/test/recommenderCore.test.js` verifies semantic search and TF-IDF fallback.

---

## 15. Saved

*   **Expected User Action:** User saves an event, video, or job. They can view all saved items under `You` -> `Saved`.
*   **Expected Output:** A library screen showing saved items grouped by category, with options to add notes or organize into collections.
*   **Required Backend Route:**
    *   `GET /api/v1/interactions/saved` (fetch saved items)
    *   `POST /api/v1/interactions/save` (toggle save status)
*   **Required Database Table:**
    *   `interaction_events` (where `event_type = 'save'`)
*   **Required Phone/Web Behavior:** Offline-first access to saved text.
*   **Test Proof:** `backend/test/recommenderCore.test.js` verifies saving and interaction events.

---

## 16. Admin

*   **Expected User Action:** Developer/Admin accesses `/admin` (or `You` -> `Admin`) to monitor system status.
*   **Expected Output:** A comprehensive diagnostics dashboard displaying:
    *   Gemini API key pool health (key counts, active keys, cooldowns).
    *   Scraper status and last run times.
    *   Database size and SQLite/Postgres mode.
    *   FCM push delivery logs.
    *   System readiness checklist.
*   **Required Backend Route:**
    *   `GET /api/v1/readiness` (system readiness status)
    *   `GET /api/v1/admin/diagnostics` (detailed key pool and database stats)
*   **Required Database Table:** All tables (reads metadata).
*   **Required Phone/Web Behavior:** Hidden behind a "Diagnostics" button in the `You` tab.
*   **Test Proof:** `backend/test/readiness-service.test.js` verifies readiness metrics and API key pool diagnostics.
