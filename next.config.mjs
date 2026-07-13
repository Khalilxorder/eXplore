import crypto from 'node:crypto';
import os from 'node:os';

const explicitBuildId = String(process.env.EXPLORE_BUILD_ID || '').trim();
const explicitBuildTime = String(process.env.EXPLORE_BUILD_TIME || '').trim();
const packageVersion = String(process.env.npm_package_version || '0.0.0').trim();
const fallbackBuildSeed = `${packageVersion}:${explicitBuildTime || new Date().toISOString()}:${process.pid}`;
const fallbackBuildId = `explore-${crypto.createHash('sha1').update(fallbackBuildSeed).digest('hex').slice(0, 12)}`;
const localDevOrigins = Array.from(new Set([
  'localhost',
  '127.0.0.1',
  os.hostname(),
  ...Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address),
])).filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: localDevOrigins,
  generateBuildId: async () => explicitBuildId || fallbackBuildId,
  env: {
    NEXT_PUBLIC_BUILD_ID: explicitBuildId || fallbackBuildId,
    NEXT_PUBLIC_BUILD_TIME: explicitBuildTime,
    NEXT_PUBLIC_BUILD_VERSION: packageVersion,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: 'ichef.bbci.co.uk' },
      { protocol: 'https', hostname: 'news.files.bbci.co.uk' },
      { protocol: 'https', hostname: 'i.guim.co.uk' },
      { protocol: 'https', hostname: 'assets.guim.co.uk' },
      { protocol: 'https', hostname: 'static01.nyt.com' },
      { protocol: 'https', hostname: 'apnews.com' },
      { protocol: 'https', hostname: 'www.apnews.com' },
      { protocol: 'https', hostname: 'www.theguardian.com' },
      { protocol: 'https', hostname: 'www.reuters.com' },
    ],
  },
  // Capacitor needs trailing slashes for file:// routing
  trailingSlash: true,
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
