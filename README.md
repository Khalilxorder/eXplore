# eXplore

An Android-first personal intelligence filter that ranks meaningful content, lets users save and organize it, and runs a high-priority radar for major AI releases plus serious Iran/Qatar risk developments.

## Current architecture

| Layer | Runtime |
|---|---|
| Web UI | Next.js 16 App Router |
| Android shell | Capacitor Android |
| API | Fastify 5 |
| Auth | Supabase Auth bearer tokens |
| Local data bridge | SQLite via `better-sqlite3` |
| Canonical production data target | Supabase Postgres |
| AI analysis | Gemini or OpenAI |
| Push delivery | Firebase Cloud Messaging |
| Local alert fallback | Capacitor local notifications + native Android worker |

Notes:
- `DATA_BACKEND=sqlite` is the current local-dev bridge.
- Supabase/Postgres is the intended production source of truth.
- Android is the only mobile target in scope right now.

## Local development

### Shared machine config first

If this machine already has shared credentials, sync them first:

```bash
cd C:\Users\khali\Desktop\eXPLORE
npm run config:sync
```

Central machine config path:
- `C:\Users\khali\.dev-config\services.json`

Open that file quickly with:

```bash
npm run config:open
```

### 1. Frontend

```bash
cd C:\Users\khali\Desktop\eXPLORE
npm install
npm run dev
```

Frontend dev server: `http://localhost:3000`

### 2. Backend

```bash
cd C:\Users\khali\Desktop\eXPLORE\backend
npm install
copy .env.example .env
npm run dev
```

Backend dev server: `http://localhost:8080`

For higher Gemini throughput later, add extra keys as `GOOGLE_AI_API_KEY_1` through `GOOGLE_AI_API_KEY_5` in either:
- `C:\Users\khali\.dev-config\services.json` under `projects.explore.backendEnv`
- or `C:\Users\khali\Desktop\eXPLORE\backend\.env`

Then run:

```bash
cd C:\Users\khali\Desktop\eXPLORE
npm run config:sync
```

### 2c. One-command local launch

```bash
cd C:\Users\khali\Desktop\eXPLORE
npm run dev:stack
```

This syncs machine config, starts the backend with the embedded alert and discovery workers in the background, and runs the frontend in the current terminal.

### 2b. Docker beta stack

```bash
cd C:\Users\khali\Desktop\eXPLORE
docker compose up --build
```

The frontend container now serves the exported `out/` build and proxies `/api` to the Fastify backend, which matches the app's static-export plus Android runtime model.
In Docker or hosted beta mode, the alert dispatcher runs as a dedicated `push-worker` service and the YouTube-first Best Feed runs as a dedicated `discovery-worker` service.

### 3. Android live reload on a phone

```bash
cd C:\Users\khali\Desktop\eXPLORE
npm run android:live
```

Use three terminals during Android development:
- root: `npm run dev`
- `backend`: `npm run dev`
- root: `npm run android:live`

This points the Android app at the live Next.js dev server on your LAN so UI changes refresh on the phone without rebuilding the APK each time. Your phone and computer must be on the same Wi-Fi.

### 4. Android APK builds

Debug APK:

```bash
cd C:\Users\khali\Desktop\eXPLORE\android
.\gradlew.bat assembleDebug
```

Signed release APK:

```bash
cd C:\Users\khali\Desktop\eXPLORE
npm run android:release
```

The release build creates a local signing keystore the first time and writes:
- `android/keystore.properties`
- `android/app/explore-release.keystore`

It also produces both a sideloadable APK and a Play Store-ready AAB:
- `android/app/build/outputs/apk/release/app-release.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

Automatic updates for a friend require the AAB path, not the APK path. Upload the AAB to Google Play Console and add your friend to an Internal testing or Closed testing track. Once they install from the Play Store, future uploads with a higher version code update automatically.

Before each Play Console upload, bump the app version in `package.json` so the Android version code increases.

Those files stay local and are ignored by git.

## Environment variables

### Frontend `.env`

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_MOBILE_APP_SCHEME=explore
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Backend `backend/.env`

```env
PORT=8080
POSTGRES_URL=postgresql://user:password@localhost:5432/explore
REDIS_URL=redis://localhost:6379
DATA_BACKEND=sqlite

SUPABASE_URL=
SUPABASE_ANON_KEY=

YOUTUBE_API_KEY=
ALLOW_DEV_MOCKS=false

AI_PROVIDER=auto
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
GOOGLE_AI_API_KEY=
GOOGLE_GEMINI_API_KEY=
GOOGLE_AI_API_KEYS=
GOOGLE_AI_API_KEY_1=
GOOGLE_AI_API_KEY_2=
GOOGLE_AI_API_KEY_3=
GOOGLE_AI_API_KEY_4=
GOOGLE_AI_API_KEY_5=
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_TEMPLATE_MODEL=gemini-2.5-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001

FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_JSON=
PRIORITY_RADAR_DIRECT_FEEDS=
```

Important behavior:
- Missing YouTube or AI credentials now fail loudly unless `ALLOW_DEV_MOCKS=true`.
- Authenticated user routes require a valid Supabase bearer token.
- Android push delivery requires Firebase credentials plus `google-services.json` in `android/app/`.
- Hosted static builds should use same-origin `/api` proxying instead of the old `.next/standalone` server layout.

## High-priority radar

The app supports two notification paths:

1. Production path: FCM push to signed-in Android devices
2. Local fallback: browser/native local notifications plus the Android radar worker

Priority radar only alerts on:
- major AI launches, upgrades, or meaningful additions
- Elevated, High, or Critical Iran/Qatar war-related developments

User-specific notification APIs:
- `GET /api/v1/preferences/notifications`
- `PUT /api/v1/preferences/notifications`
- `POST /api/v1/devices/push-token`

Alert dispatch worker:

```bash
cd C:\Users\khali\Desktop\eXPLORE\backend
npm run worker:alerts
```

Local SQLite mode now embeds the continuous alert loop inside `server.js` by default through `EMBED_ALERT_WORKER=true`.
Dedicated worker mode is still used for Docker or hosted beta deploys.

Best Feed discovery worker:

```bash
cd C:\Users\khali\Desktop\eXPLORE\backend
npm run worker:discovery
```

The Best Feed is YouTube-first and is built from:
- tracked channels
- recurring topic monitors
- source health and freshness tracking
- ranking against your template, hierarchy goal, and interaction history

Discovery management APIs:
- `GET /api/v1/discovery/status`
- `POST /api/v1/discovery/refresh`
- `GET /api/v1/discovery/youtube/channels`
- `POST /api/v1/discovery/youtube/channels`
- `PUT /api/v1/discovery/youtube/channels/:id`
- `GET /api/v1/discovery/youtube/monitors`
- `POST /api/v1/discovery/youtube/monitors`
- `PUT /api/v1/discovery/youtube/monitors/:id`
- `GET /api/v1/discovery/sources/health`

## Ingestion and AI behavior

- YouTube ingest uses the YouTube Data API for metadata.
- Public transcripts are fetched from the watch page when available.
- Transcript failures now surface through `transcript_status` and `ingest_status`.
- AI analysis records provider, model, and failure metadata.
- Missing provider keys no longer silently return fake production content.
- Template and hierarchy routes share the same user identity path, so a signed-in user's template, trajectory lens, and feed ranking stay aligned.

Key content states:
- `queued`
- `processing`
- `partial`
- `ready`
- `failed`

## Quality gates

Run these before shipping changes:

```bash
cd C:\Users\khali\Desktop\eXPLORE
npm run lint
npm run build

cd C:\Users\khali\Desktop\eXPLORE\backend
node --check server.js

cd C:\Users\khali\Desktop\eXPLORE\android
.\gradlew.bat assembleDebug
```

## Roadmap status

- [x] Phase 1 - Design system and frontend shell
- [x] Phase 2 - Core backend APIs and ranking flows
- [x] Phase 3 - Frontend/backend integration
- [ ] Phase 4 - Complete real ingest plus transcript plus AI pipeline
- [ ] Phase 5 - Full Supabase/Postgres-backed authenticated data model
- [ ] Phase 6 - Repeatable production deploy and release process

The codebase is closer to the target state than the original MVP, but it is still in a bridge phase:
- auth is real at the API boundary
- user-scoped routes are no longer hardcoded to `user_1`
- SQLite is still the active runtime bridge for much of local development
- Supabase migration artifacts now live in `backend/supabase/migrations`

## Release checklist

- Fill in Supabase URL and anon key in both frontend and backend env files
- Provision Supabase Postgres and apply `backend/supabase/migrations`
- Set `DATA_BACKEND=postgres` only after the runtime adapter work is complete
- Add `google-services.json` to `android/app/`
- Set `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_JSON`
- Verify FCM push on a physical Android device
- Verify `GET /api/v1/readiness` reports the expected live or partial states before shipping
- For Docker or hosted web, serve the exported `out/` build and proxy `/api` to Fastify
- Verify sign-in, save, subscription, family, referral, and notification flows
- Run lint, build, backend syntax check, and Android assemble
- Build the APK only after the live reload build is no longer needed

## Repository layout

```text
eXplore/
|-- src/app/                  Next.js UI
|-- android/                  Capacitor Android project
|-- backend/server.js         Fastify API
|-- backend/worker.js         Content ingestion worker
|-- backend/pushWorker.js     Alert push dispatcher
|-- backend/discoveryWorker.js YouTube-first Best Feed worker
|-- backend/schema.sqlite.sql SQLite bridge schema
|-- backend/schema.sql        Postgres schema + migration source
|-- backend/supabase/         Supabase config and migrations
|-- scripts/run-android-live.ps1
```

