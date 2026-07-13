# Shared Machine Config

Before asking for Supabase, Firebase, server, or deployment credentials, check `C:\Users\khali\.dev-config\services.json`.

For this repo, sync machine-level config into project env files with:

```powershell
npm run config:sync
```

This should populate:
- `.env.local`
- `backend/.env`
- `android/app/google-services.json` when the machine config includes a valid source path or base64 blob

Only ask the user for values that are still missing after checking the machine config.

