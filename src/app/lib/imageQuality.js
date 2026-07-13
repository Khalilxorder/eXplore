const BBC_STANDARD_PATTERN = /(https:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/)(\d+)(\/.*)$/i;
const BBC_IMAGE_PATTERN = /(https:\/\/ichef\.bbci\.co\.uk\/images\/ic\/)(\d+)x(\d+)(\/.*)$/i;
const GOOGLE_IMAGE_PATTERN = /(https:\/\/[^/]*googleusercontent\.com\/.+?=)([^#\s]+)$/i;
const YOUTUBE_QUALITY_PATTERN = /(https:\/\/i\d?\.ytimg\.com\/vi\/[^/]+\/)(hqdefault|mqdefault|sddefault)(\.[a-z]+)?$/i;

function clampTargetWidth(value, fallback = 960) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.max(640, Math.round(numeric));
}

function parseGoogleImageFlags(flagString = '') {
  return String(flagString || '')
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function estimateImageWidth(url = '') {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return 0;
  }

  const bbcStandardMatch = normalizedUrl.match(BBC_STANDARD_PATTERN);
  if (bbcStandardMatch?.[2]) {
    return Number(bbcStandardMatch[2]) || 0;
  }

  const bbcImageMatch = normalizedUrl.match(BBC_IMAGE_PATTERN);
  if (bbcImageMatch?.[2]) {
    return Number(bbcImageMatch[2]) || 0;
  }

  const googleMatch = normalizedUrl.match(GOOGLE_IMAGE_PATTERN);
  if (googleMatch?.[2]) {
    const widthFlag = parseGoogleImageFlags(googleMatch[2]).find((flag) => /^w\d+$/i.test(flag));
    if (widthFlag) {
      return Number(widthFlag.slice(1)) || 0;
    }
  }

  if (YOUTUBE_QUALITY_PATTERN.test(normalizedUrl)) {
    return /maxresdefault/i.test(normalizedUrl) ? 1280 : 480;
  }

  return 0;
}

export function isLikelyLowQualityImageUrl(url = '', minWidth = 640) {
  const estimatedWidth = estimateImageWidth(url);
  return estimatedWidth > 0 && estimatedWidth < Number(minWidth || 640);
}

export function promoteImageUrlQuality(url = '', options = {}) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return '';
  }

  const targetWidth = clampTargetWidth(options.targetWidth, 960);

  if (BBC_STANDARD_PATTERN.test(normalizedUrl)) {
    return normalizedUrl.replace(BBC_STANDARD_PATTERN, (_, prefix, width, suffix) => {
      const nextWidth = Math.max(Number(width) || 0, targetWidth);
      return `${prefix}${nextWidth}${suffix}`;
    });
  }

  if (BBC_IMAGE_PATTERN.test(normalizedUrl)) {
    return normalizedUrl.replace(BBC_IMAGE_PATTERN, (_, prefix, width, height, suffix) => {
      const currentWidth = Number(width) || 0;
      const currentHeight = Number(height) || 0;
      const nextWidth = Math.max(currentWidth, targetWidth);
      const ratio = currentWidth > 0 && currentHeight > 0 ? (currentHeight / currentWidth) : (9 / 16);
      const nextHeight = Math.max(1, Math.round(nextWidth * ratio));
      return `${prefix}${nextWidth}x${nextHeight}${suffix}`;
    });
  }

  if (GOOGLE_IMAGE_PATTERN.test(normalizedUrl)) {
    return normalizedUrl.replace(GOOGLE_IMAGE_PATTERN, (_, prefix, flags) => {
      const nextFlags = parseGoogleImageFlags(flags)
        .filter((flag) => !/^w\d+$/i.test(flag))
        .concat(`w${targetWidth}`);
      return `${prefix}${nextFlags.join('-')}`;
    });
  }

  if (YOUTUBE_QUALITY_PATTERN.test(normalizedUrl)) {
    return normalizedUrl.replace(YOUTUBE_QUALITY_PATTERN, '$1maxresdefault$3');
  }

  return normalizedUrl;
}
