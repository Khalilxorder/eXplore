import { resolveApiBase } from './api';

function normalizeText(value) {
  return String(value || '').trim();
}

function parseUrlSafely(value) {
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

function resolveAbsoluteImageUrl(value) {
  const imageUrl = normalizeText(value);
  if (!imageUrl) {
    return '';
  }

  if (/^(?:https?:)?\/\//i.test(imageUrl) || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
    return imageUrl;
  }

  const apiBase = normalizeText(resolveApiBase());
  if (!apiBase || apiBase.startsWith('/')) {
    return imageUrl;
  }

  const parsedApiBase = parseUrlSafely(apiBase);
  if (!parsedApiBase) {
    return `${apiBase.replace(/\/+$/, '')}${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;
  }

  let basePath = parsedApiBase.pathname.replace(/\/+$/, '');
  if (basePath.endsWith('/api')) {
    basePath = basePath.slice(0, -4);
  }

  return `${parsedApiBase.origin}${basePath}${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;
}

function normalizeVisualMeaning(visualMeaning) {
  if (!visualMeaning || typeof visualMeaning !== 'object') {
    return null;
  }

  const imageUrl = normalizeText(visualMeaning.imageUrl);
  const label = normalizeText(visualMeaning.label);
  const prompt = normalizeText(visualMeaning.prompt);
  const status = normalizeText(visualMeaning.status);

  if (!imageUrl && !label && !prompt && !status) {
    return null;
  }

  return {
    imageUrl,
    label,
    prompt,
    status,
  };
}

export function resolveVisualMeaning(item, overrideVisualMeaning = null) {
  return normalizeVisualMeaning(overrideVisualMeaning) || normalizeVisualMeaning(item?.visualMeaning) || null;
}

export function resolveVisualMeaningImageSource(item, overrideVisualMeaning = null, { allowThumbnailFallback = true } = {}) {
  const resolvedVisualMeaning = resolveVisualMeaning(item, overrideVisualMeaning);
  const thumbnail = normalizeText(item?.thumbnail);
  const isWritten = String(item?.channelType || '').toLowerCase() === 'written';

  if (isWritten) {
    return resolveAbsoluteImageUrl(resolvedVisualMeaning?.imageUrl || '') || (allowThumbnailFallback ? thumbnail : '');
  }

  return thumbnail || resolvedVisualMeaning?.imageUrl || '';
}

export function resolveVisualMeaningTitle(item, overrideVisualMeaning = null) {
  const resolvedVisualMeaning = resolveVisualMeaning(item, overrideVisualMeaning);
  return resolvedVisualMeaning?.label || normalizeText(item?.title);
}

export function resolveVisualMeaningCopy(item, overrideVisualMeaning = null) {
  const resolvedVisualMeaning = resolveVisualMeaning(item, overrideVisualMeaning);
  return resolvedVisualMeaning?.prompt
    || normalizeText(item?.summary)
    || normalizeText(item?.reason)
    || normalizeText(item?.title);
}

export function hasVisualMeaningImage(item, overrideVisualMeaning = null) {
  return Boolean(resolveVisualMeaning(item, overrideVisualMeaning)?.imageUrl);
}
