import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.join(projectRoot, 'backend');
const testEnv = {
  ...process.env,
  AI_PROVIDER: 'auto',
  LLM_PROVIDER: 'mock',
  EMBEDDING_PROVIDER: 'mock',
  ALLOW_DEV_MOCKS: 'false',
  OPENAI_API_KEY: '',
  GOOGLE_AI_API_KEY: '',
  GOOGLE_GEMINI_API_KEY: '',
  GOOGLE_AI_API_KEYS: '',
  YOUTUBE_API_KEY: '',
  YOUTUBE_API_KEYS: '',
  GEMINI_KEY_POOL_FILE: path.join(projectRoot, '.codex-run', 'no-gemini-key-pool-for-tests.json'),
};

for (let index = 1; index <= 100; index += 1) {
  testEnv[`GOOGLE_AI_API_KEY_${index}`] = '';
  testEnv[`GOOGLE_GEMINI_API_KEY_${index}`] = '';
  testEnv[`GEMINI_API_KEY_${index}`] = '';
}

for (let index = 1; index <= 10; index += 1) {
  testEnv[`YOUTUBE_API_KEY_${index}`] = '';
}

const result = spawnSync(process.execPath, ['--test'], {
  cwd: backendRoot,
  env: testEnv,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`Backend test runner failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
