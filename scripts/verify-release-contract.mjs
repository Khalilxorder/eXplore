import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const migration = read('backend/supabase/migrations/20260713_intelligence_spine.sql');
const server = read('backend/server.js');
const appShell = read('src/app/components/AppShell.js');
const buildMeta = JSON.parse(read('out/__explore_build.json'));
const androidBuildMeta = JSON.parse(read('android/app/src/main/assets/public/__explore_build.json'));

assert.ok(buildMeta.buildId, 'web build metadata must contain a build id');
assert.ok(androidBuildMeta.buildId, 'Android asset metadata must contain a build id');
assert.equal(
  androidBuildMeta.buildId,
  buildMeta.buildId,
  'Android assets must be synced from the same web build before a release can pass.',
);
assert.ok(exists('backend/supabase/migrations/20260713_intelligence_spine.sql'), 'intelligence migration must exist');
assert.match(migration, /enable row level security/i, 'hosted intelligence tables must enable RLS');
assert.match(migration, /auth\.uid\(\)/i, 'hosted intelligence policies must scope rows to auth.uid');
assert.match(migration, /user_theory_evidence/i, 'hosted theory evidence table must exist');
assert.match(migration, /source_web_evidence/i, 'hosted Source Web evidence table must exist');
assert.match(server, /\/api\/v1\/readiness/, 'release must expose readiness evidence');
assert.match(server, /\/api\/v1\/messages\/readiness/, 'release must expose messaging readiness evidence');
assert.match(appShell, /ROOT_SCREENS[\s\S]*topics/, 'release navigation must expose Topics');

console.log(`release-contract: web_build=${buildMeta.buildId}, android_build=${androidBuildMeta.buildId}, android_match=${buildMeta.buildId === androidBuildMeta.buildId}, migration=present, rls=present, readiness=present`);
