const DEFAULT_SITE_URL = 'https://explore-two-rho.vercel.app';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeSiteUrl(value) {
  const trimmed = trimTrailingSlash(value);

  if (!trimmed) {
    return DEFAULT_SITE_URL;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return DEFAULT_SITE_URL;
  }

  return trimmed;
}

export function getSiteUrl() {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
}

export function getSiteUrlForPath(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getSiteUrl()}${normalizedPath}`;
}
