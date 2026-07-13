import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request as createRequest } from 'node:http';
import path from 'node:path';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const BUILD_META_FILE = '__explore_build.json';
const NO_STORE_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const STATIC_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://*.supabase.co; connect-src 'self' https://*.supabase.co https://*.supabase.in https://api.openai.com https://generativelanguage.googleapis.com https://api.open-meteo.com wss:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; manifest-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
};

function createBuildId() {
  const compactTime = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `explore-${compactTime}-${randomUUID().slice(0, 8)}`;
}

function getBuildModeArgs(argv = []) {
  const separatorIndex = argv.indexOf('--');
  const exportDirArg = separatorIndex === -1 ? (argv[1] || 'out') : (argv[1] || 'out');
  const rawCommandParts = separatorIndex === -1 ? ['next', 'build', '--webpack'] : argv.slice(separatorIndex + 1);
  const commandParts = rawCommandParts.length === 1
    ? String(rawCommandParts[0] || '').trim().split(/\s+/).filter(Boolean)
    : rawCommandParts;
  return {
    exportDir: path.resolve(process.cwd(), exportDirArg || 'out'),
    commandParts,
  };
}

async function writeBuildMeta(exportDir, metadata) {
  await mkdir(exportDir, { recursive: true });
  await writeFile(path.join(exportDir, BUILD_META_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function loadBuildMeta(exportDir) {
  try {
    const raw = await readFile(path.join(exportDir, BUILD_META_FILE), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runCommand(command, args, env) {
  const commandName = String(command || '').trim().toLowerCase();
  const isWindows = process.platform === 'win32';
  let spawnCommand = command;
  let spawnArgs = args;

  if (commandName === 'next') {
    if (isWindows) {
      spawnCommand = 'cmd.exe';
      spawnArgs = ['/d', '/s', '/c', 'npx', 'next', ...args];
    } else {
      spawnCommand = process.execPath;
      spawnArgs = [path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), ...args];
    }
  }

  return new Promise((resolve) => {
    const result = spawnSync(spawnCommand, spawnArgs, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      shell: false,
    });

    if (result.error) {
      resolve(1);
      return;
    }

    resolve(Number(result.status) || 0);
  });
}

async function directoryExists(filePath) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isDirectory();
  } catch {
    return false;
  }
}

async function runBuildMode(argv = []) {
  const { exportDir, commandParts } = getBuildModeArgs(argv);
  if (!commandParts.length) {
    throw new Error('Build mode requires a command to run after "--".');
  }

  const backupDir = `${exportDir}.previous`;
  const hadExistingExport = await directoryExists(exportDir);
  await rm(backupDir, { recursive: true, force: true });
  if (hadExistingExport) {
    await rename(exportDir, backupDir);
  }

  const buildId = String(process.env.EXPLORE_BUILD_ID || '').trim() || createBuildId();
  const builtAt = String(process.env.EXPLORE_BUILD_TIME || '').trim() || new Date().toISOString();
  const env = {
    ...process.env,
    EXPLORE_BUILD_ID: buildId,
    EXPLORE_BUILD_TIME: builtAt,
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_BUILD_TIME: builtAt,
    EXPLORE_RELEASE_CHANNEL: String(process.env.EXPLORE_RELEASE_CHANNEL || 'local-static').trim(),
  };

  console.log(`Building Explore export with build id ${buildId}`);
  const exitCode = await runCommand(commandParts[0], commandParts.slice(1), env);
  if (exitCode !== 0) {
    if (hadExistingExport && await directoryExists(backupDir)) {
      await rm(exportDir, { recursive: true, force: true });
      await rename(backupDir, exportDir);
    }
    process.exit(exitCode);
  }

  await writeBuildMeta(exportDir, {
    app: 'eXPLORE',
    packageName: process.env.npm_package_name || 'temp-explore',
    packageVersion: process.env.npm_package_version || '0.0.0',
    buildId,
    builtAt,
    exportDir: path.relative(process.cwd(), exportDir) || '.',
    nodeVersion: process.version,
  });

  await rm(backupDir, { recursive: true, force: true });

  console.log(`Wrote build metadata to ${path.join(exportDir, BUILD_META_FILE)}`);
}

async function fileExists(filePath) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile();
  } catch {
    return false;
  }
}

function isWithinRoot(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

async function resolveFilePath(rootDir, requestPath) {
  const url = new URL(requestPath, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname || '/');
  const safePath = pathname.replace(/^\/+/, '');
  const candidates = pathname.endsWith('/')
    ? [path.join(rootDir, safePath, 'index.html')]
    : [
        safePath ? path.join(rootDir, safePath) : null,
        path.join(rootDir, `${safePath}.html`),
        path.join(rootDir, safePath, 'index.html'),
      ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (!isWithinRoot(rootDir, normalized)) {
      continue;
    }

    if (await fileExists(normalized)) {
      return normalized;
    }
  }

  return path.join(rootDir, '404.html');
}

function getCacheControl(filePath) {
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath);
  if (
    extension === '.html'
    || baseName === BUILD_META_FILE
    || baseName === 'manifest.json'
    || baseName === 'sw.js'
    || /^workbox-.*\.js$/i.test(baseName)
  ) {
    return NO_STORE_CACHE_CONTROL;
  }

  return IMMUTABLE_CACHE_CONTROL;
}

function proxyApiRequest(req, res) {
  const proxyHost = process.env.PROXY_API_HOST || '127.0.0.1';
  const proxyPort = Number(process.env.PROXY_API_PORT || 8080);
  const proxyRequest = createRequest(
    {
      host: proxyHost,
      port: proxyPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: `${proxyHost}:${proxyPort}`,
      },
    },
    (proxyResponse) => {
      const headers = { ...proxyResponse.headers };
      res.writeHead(proxyResponse.statusCode || 502, headers);
      proxyResponse.pipe(res);
    }
  );

  proxyRequest.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Backend proxy unavailable' }));
  });

  req.pipe(proxyRequest);
}

async function startServer() {
  const rootDir = path.resolve(process.cwd(), process.argv[2] || 'out');
  const port = Number(process.env.PORT || process.argv[3] || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const buildMeta = await loadBuildMeta(rootDir);

  if (buildMeta?.buildId) {
    console.log(`Serving Explore build ${buildMeta.buildId} from ${rootDir}`);
  } else {
    console.warn(`Serving Explore from ${rootDir} without ${BUILD_META_FILE}; stale export issues may be harder to spot.`);
  }

  createServer(async (req, res) => {
    const requestPath = req.url || '/';
    const requestBuildMeta = (await loadBuildMeta(rootDir)) || buildMeta;

    if (requestPath.startsWith('/api/')) {
      proxyApiRequest(req, res);
      return;
    }

    const filePath = await resolveFilePath(rootDir, requestPath);

    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const extension = path.extname(filePath);
      const mimeType = MIME_TYPES[extension] || 'application/octet-stream';
      const headers = {
        ...STATIC_SECURITY_HEADERS,
        'Content-Type': mimeType,
        'Cache-Control': getCacheControl(filePath),
      };

      if (requestBuildMeta?.buildId) {
        headers['X-Explore-Build-Id'] = String(requestBuildMeta.buildId);
      }
      if (requestBuildMeta?.builtAt) {
        headers['X-Explore-Built-At'] = String(requestBuildMeta.builtAt);
      }
      if (requestBuildMeta?.packageVersion) {
        headers['X-Explore-Version'] = String(requestBuildMeta.packageVersion);
      }
      if (path.basename(filePath) === 'sw.js') {
        headers['Service-Worker-Allowed'] = '/';
      }

      res.writeHead(filePath.endsWith('404.html') ? 404 : 200, headers);
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500);
      res.end('Internal server error');
    }
  }).listen(port, host, () => {
    console.log(`Serving Explore from ${rootDir} at http://${host}:${port}`);
  });
}

if (process.argv[2] === 'build') {
  await runBuildMode(process.argv.slice(2));
} else {
  await startServer();
}
