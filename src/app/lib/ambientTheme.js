'use client';

const BUDAPEST_COORDINATES = {
  latitude: 47.4979,
  longitude: 19.0402,
};

export const BUDAPEST_TIMEZONE = 'Europe/Budapest';

const AMBIENT_CACHE_KEY = 'explore-budapest-ambient-v1';
const AMBIENT_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

const DEFAULT_SNAPSHOT = {
  timezone: BUDAPEST_TIMEZONE,
  fetchedAt: 0,
  current: {
    weather_code: 1,
    is_day: 1,
    rain: 0,
    showers: 0,
    precipitation: 0,
    cloud_cover: 18,
    temperature_2m: 18,
  },
  daily: {
    time: [],
    sunrise: [],
    sunset: [],
  },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, amount) {
  return start + ((end - start) * amount);
}

function hexToRgb(hex) {
  const normalized = String(hex || '').replace('#', '').trim();
  const expanded = normalized.length === 3
    ? normalized.split('').map((value) => `${value}${value}`).join('')
    : normalized;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function mixHex(first, second, amount) {
  const start = hexToRgb(first);
  const end = hexToRgb(second);
  const progress = clamp(amount, 0, 1);
  return {
    r: Math.round(lerp(start.r, end.r, progress)),
    g: Math.round(lerp(start.g, end.g, progress)),
    b: Math.round(lerp(start.b, end.b, progress)),
  };
}

function rgbToCss(rgb, alpha = 1) {
  const nextAlpha = clamp(alpha, 0, 1);
  if (nextAlpha >= 0.999) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${nextAlpha.toFixed(3)})`;
}

function mixColor(first, second, amount, alpha = 1) {
  return rgbToCss(mixHex(first, second, amount), alpha);
}

function solidColor(first, second, amount) {
  return rgbToCss(mixHex(first, second, amount), 1);
}

function parseLocalIsoMinutes(value, fallback) {
  if (typeof value !== 'string' || !value.includes('T')) {
    return fallback;
  }

  const time = value.split('T')[1] || '';
  const [hourText = '0', minuteText = '0'] = time.split(':');
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return fallback;
  }

  return (hour * 60) + minute;
}

function getBudapestNowParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUDAPEST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const bag = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }

  const year = Number.parseInt(bag.year, 10) || date.getUTCFullYear();
  const month = Number.parseInt(bag.month, 10) || 1;
  const day = Number.parseInt(bag.day, 10) || 1;
  const hour = Number.parseInt(bag.hour, 10) || 0;
  const minute = Number.parseInt(bag.minute, 10) || 0;
  const second = Number.parseInt(bag.second, 10) || 0;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minutesOfDay: (hour * 60) + minute + (second / 60),
  };
}

function getSeason(month) {
  if (month >= 3 && month <= 5) {
    return 'spring';
  }
  if (month >= 6 && month <= 8) {
    return 'summer';
  }
  if (month >= 9 && month <= 11) {
    return 'autumn';
  }
  return 'winter';
}

function resolveWeatherMood(current = {}) {
  const weatherCode = Number(current.weather_code ?? current.weatherCode ?? 0);
  const rainAmount = Math.max(
    Number(current.rain ?? 0) || 0,
    Number(current.showers ?? 0) || 0,
    Number(current.precipitation ?? 0) || 0,
  );
  const cloudCover = clamp(Number(current.cloud_cover ?? current.cloudCover ?? 0) || 0, 0, 100);
  const rainyCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
  const snowCodes = new Set([71, 73, 75, 77, 85, 86]);
  const cloudyCodes = new Set([1, 2, 3, 45, 48]);
  const thunderCodes = new Set([95, 96, 99]);
  const rainy = rainAmount >= 0.15 || rainyCodes.has(weatherCode) || thunderCodes.has(weatherCode);
  const snowy = snowCodes.has(weatherCode);
  const cloudy = rainy || cloudyCodes.has(weatherCode) || cloudCover >= 54;
  const thunder = thunderCodes.has(weatherCode);
  const rainIntensity = rainy
    ? clamp(Math.max(rainAmount / 2.4, thunder ? 0.72 : 0.42), 0.24, 1)
    : 0;
  const cloudiness = clamp(
    Math.max(
      cloudCover / 100,
      cloudy ? 0.56 : 0.08,
      rainy ? 0.72 : 0,
      thunder ? 0.88 : 0,
    ),
    0,
    1,
  );

  return {
    weatherCode,
    rainy,
    snowy,
    cloudy,
    thunder,
    rainIntensity,
    cloudiness,
  };
}

function resolveSolarWindow(snapshot, nowParts) {
  const times = Array.isArray(snapshot?.daily?.time) ? snapshot.daily.time : [];
  const sunrises = Array.isArray(snapshot?.daily?.sunrise) ? snapshot.daily.sunrise : [];
  const sunsets = Array.isArray(snapshot?.daily?.sunset) ? snapshot.daily.sunset : [];
  const todayIndex = Math.max(times.indexOf(nowParts.dateKey), 0);
  const sunrise = parseLocalIsoMinutes(sunrises[todayIndex], 6 * 60);
  const sunset = parseLocalIsoMinutes(sunsets[todayIndex], 18 * 60);
  const tomorrowSunrise = parseLocalIsoMinutes(sunrises[todayIndex + 1], sunrise + (24 * 60));
  return {
    sunrise,
    sunset,
    tomorrowSunrise: tomorrowSunrise <= 24 * 60 ? tomorrowSunrise + (24 * 60) : tomorrowSunrise,
  };
}

function getSolarSignals(snapshot, nowParts) {
  const { sunrise, sunset, tomorrowSunrise } = resolveSolarWindow(snapshot, nowParts);
  const minutesNow = nowParts.minutesOfDay;
  const dayLength = Math.max(sunset - sunrise, 1);
  const isDay = minutesNow >= sunrise && minutesNow < sunset;
  const dayProgress = isDay ? clamp((minutesNow - sunrise) / dayLength, 0, 1) : (minutesNow < sunrise ? 0 : 1);
  const daylight = isDay ? Math.sin(dayProgress * Math.PI) : 0;

  // Wider glow windows so dawn/dusk transitions are gradual, not abrupt
  const dawnGlow = clamp(1 - Math.abs(minutesNow - sunrise) / 100, 0, 1);
  const duskGlow = clamp(1 - Math.abs(minutesNow - sunset) / 110, 0, 1);

  let nightProgress = 0;
  if (!isDay) {
    if (minutesNow < sunrise) {
      const previousSunset = sunset - (24 * 60);
      nightProgress = clamp((minutesNow - previousSunset) / (sunrise - previousSunset), 0, 1);
    } else {
      nightProgress = clamp((minutesNow - sunset) / (tomorrowSunrise - sunset), 0, 1);
    }
  }

  const nightDepth = !isDay ? Math.sin(nightProgress * Math.PI) : 0;

  // Continuous arc: 0=east(sunrise) → 0.5=west(sunset) → 1=east(pre-dawn)
  // Day traces 0→0.5, night continues 0.5→1, so the orb never jumps.
  let orbitalProgress;
  if (isDay) {
    orbitalProgress = dayProgress * 0.5;
  } else if (minutesNow >= sunset) {
    const nightLength = Math.max(tomorrowSunrise - sunset, 1);
    orbitalProgress = 0.5 + (clamp((minutesNow - sunset) / nightLength, 0, 1) * 0.5);
  } else {
    const previousSunset = sunset - (24 * 60);
    const nightLength = Math.max(sunrise - previousSunset, 1);
    orbitalProgress = 0.5 + (clamp((minutesNow - previousSunset) / nightLength, 0, 1) * 0.5);
  }

  return {
    sunrise,
    sunset,
    isDay,
    dayProgress,
    daylight,
    dawnGlow,
    duskGlow,
    goldenHour: Math.max(dawnGlow, duskGlow),
    nightDepth,
    orbitalProgress,
  };
}

function getDefaultSnapshot() {
  const now = getBudapestNowParts();
  const sunriseHour = now.month >= 4 && now.month <= 8 ? '05:40' : now.month >= 9 && now.month <= 10 ? '06:15' : '07:10';
  const sunsetHour = now.month >= 5 && now.month <= 8 ? '19:55' : now.month >= 3 && now.month <= 4 ? '19:10' : now.month >= 9 && now.month <= 10 ? '18:15' : '16:05';

  return {
    ...DEFAULT_SNAPSHOT,
    daily: {
      time: [
        now.dateKey,
        now.dateKey,
      ],
      sunrise: [
        `${now.dateKey}T${sunriseHour}`,
        `${now.dateKey}T${sunriseHour}`,
      ],
      sunset: [
        `${now.dateKey}T${sunsetHour}`,
        `${now.dateKey}T${sunsetHour}`,
      ],
    },
  };
}

export function loadCachedAmbientSnapshot() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AMBIENT_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (Date.now() - (Number(parsed.fetchedAt) || 0) > AMBIENT_CACHE_MAX_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function persistAmbientSnapshot(snapshot) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(AMBIENT_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures.
  }
}

export async function fetchBudapestAmbientSnapshot({ signal, forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = loadCachedAmbientSnapshot();
    if (cached) {
      return cached;
    }
  }

  const searchParams = new URLSearchParams({
    latitude: String(BUDAPEST_COORDINATES.latitude),
    longitude: String(BUDAPEST_COORDINATES.longitude),
    timezone: BUDAPEST_TIMEZONE,
    forecast_days: '2',
    current: 'weather_code,is_day,rain,showers,precipitation,cloud_cover,temperature_2m',
    daily: 'sunrise,sunset',
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${searchParams.toString()}`, {
    method: 'GET',
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Weather lookup failed: ${response.status}`);
  }

  const payload = await response.json();
  const snapshot = {
    timezone: payload.timezone || BUDAPEST_TIMEZONE,
    fetchedAt: Date.now(),
    current: payload.current || DEFAULT_SNAPSHOT.current,
    daily: payload.daily || DEFAULT_SNAPSHOT.daily,
  };

  persistAmbientSnapshot(snapshot);
  return snapshot;
}

export function buildAmbientThemeState(snapshotInput, themePreference = 'ambient') {
  const snapshot = snapshotInput || getDefaultSnapshot();
  const nowParts = getBudapestNowParts();
  const season = getSeason(nowParts.month);
  const solar = getSolarSignals(snapshot, nowParts);
  const weather = resolveWeatherMood(snapshot.current);
  // lightBlend: 0=deep night → 1=peak midday
  // Dawn/dusk golden hour contributes up to 0.46 (was 0.28) for wide, gradual transitions
  const lightBlendBase = solar.isDay
    ? 0.58 + (solar.daylight * 0.42)
    : Math.max(solar.dawnGlow, solar.duskGlow) * 0.46;
  const lightBlend = clamp(lightBlendBase - (weather.cloudiness * 0.18) - (weather.rainIntensity * 0.12), 0.03, 1);
  const seasonGold = season === 'spring'
    ? 0.24
    : season === 'summer'
      ? 0.14
      : season === 'autumn'
        ? 0.18
        : 0.05;
  const warmth = clamp(seasonGold + (solar.goldenHour * 0.46) + (solar.daylight * 0.14), 0, 0.88);
  const pinkAccent = season === 'spring'
    ? clamp(0.2 + (solar.daylight * 0.36) + (solar.goldenHour * 0.2), 0.18, 0.78)
    : 0.08;
  const stormWeight = weather.thunder ? 0.82 : weather.rainy ? 0.42 : 0;

  const mode = (themePreference === 'light' || themePreference === 'dark')
    ? themePreference
    : (lightBlend > 0.38 ? 'light' : 'dark');
  const weatherMode = weather.thunder ? 'storm' : weather.rainy ? 'rain' : weather.cloudy ? 'cloud' : 'clear';
  // Clear starlit nights are perceptibly lighter than thick overcast ones
  const nightClearness = mode === 'dark' ? clamp(1 - weather.cloudiness, 0, 1) : 0;
  const interfaceBlend = mode === 'light'
    ? clamp(0.78 + (lightBlend * 0.22), 0.78, 1)
    : clamp((lightBlend * 0.42) + (nightClearness * 0.06), 0, 0.26);

  const daySurface = warmth > 0.46 ? '#FFF8F0' : '#FCF7F1';
  // Clear nights get a faint warm moonlit undertone; rainy nights are cooler blue-grey
  const nightSurface = weather.rainy ? '#0A1320' : (nightClearness > 0.6 ? '#0D1525' : '#0C1220');
  const surface = solidColor(nightSurface, daySurface, interfaceBlend);
  const surfaceElevated = solidColor('#111a2b', '#FFFCF8', clamp(interfaceBlend + 0.08, 0, 1));
  const surfaceMuted = solidColor('#152135', '#F4EBDD', clamp(interfaceBlend * 0.94, 0, 1));
  const bg = solidColor('#09111d', '#F5ECDE', interfaceBlend);
  const textPrimary = mode === 'light' ? '#16100B' : '#FFF9F0';
  const textSecondary = mode === 'light' ? '#3A3028' : '#E7EEF9';
  const textTertiary = mode === 'light' ? '#64564A' : '#B7C4D8';
  const border = mixColor('#8FA1C3', '#D2B28F', interfaceBlend, mode === 'light' ? 0.48 : 0.3);
  const borderStrong = mixColor('#AFC0DD', '#C39058', interfaceBlend, mode === 'light' ? 0.64 : 0.4);
  const accent = mode === 'light'
    ? solidColor('#8A4D10', '#A76619', clamp(warmth + 0.34, 0, 1))
    : solidColor('#8CB5FF', '#BFD4FF', clamp(lightBlend + 0.2, 0, 1));
  const accentHover = mode === 'light' ? '#70400F' : '#D6E4FF';
  const accentLight = mode === 'light'
    ? mixColor('#D89B5C', '#F2C991', warmth, 0.22)
    : mixColor('#84A6ED', '#D1DEFF', lightBlend, 0.18);
  const accentAlpha = mode === 'light'
    ? mixColor('#B66A17', '#DEA871', warmth, 0.16)
    : mixColor('#7EA8FF', '#BFD4FF', lightBlend, 0.14);
  const accentMedium = mode === 'light'
    ? mixColor('#A76619', '#D28836', warmth, 0.28)
    : mixColor('#78A0F0', '#BFD4FF', lightBlend, 0.24);
  const premium = mode === 'light'
    ? solidColor('#9D3478', '#C45E9F', clamp(pinkAccent + 0.18, 0, 1))
    : solidColor('#B4A7FF', '#E2D7FF', clamp(pinkAccent + 0.18, 0, 1));
  const premiumLight = mixColor('#A784F6', '#F1A8D6', clamp(pinkAccent + (interfaceBlend * 0.22), 0.18, 0.92), mode === 'light' ? 0.22 : 0.18);
  const success = mode === 'light' ? '#247A45' : '#87F5CB';
  const successLight = mode === 'light' ? 'rgba(56, 142, 90, 0.16)' : 'rgba(94, 208, 155, 0.18)';
  const warning = mode === 'light' ? '#99500D' : '#FFD293';
  const warningLight = mode === 'light' ? 'rgba(183, 101, 20, 0.16)' : 'rgba(228, 177, 96, 0.18)';
  const error = mode === 'light' ? '#B53324' : '#FF9A92';
  const errorLight = mode === 'light' ? 'rgba(198, 67, 49, 0.14)' : 'rgba(242, 122, 115, 0.18)';
  const borderSoft = mixColor('#A3B3D2', '#E1C1A0', interfaceBlend, mode === 'light' ? 0.28 : 0.14);
  const surfaceSoft = mixColor('#162235', '#FFF1D5', interfaceBlend, mode === 'light' ? 0.16 : 0.12);

  const shadowTint = mode === 'light' ? 'rgba(74, 44, 16, 0.12)' : 'rgba(0, 0, 0, 0.38)';
  const shadowHighlight = mode === 'light' ? 'rgba(255,255,255,0.52)' : 'rgba(255,255,255,0.04)';
  const shadowSm = `0 1px 2px ${shadowTint}, 0 1px 0 ${shadowHighlight} inset`;
  const shadowMd = `0 10px 26px ${shadowTint}, 0 1px 4px rgba(0,0,0,0.08)`;
  const shadowLg = `0 22px 54px ${shadowTint}, 0 6px 18px rgba(0,0,0,0.12)`;
  const shadowNav = mode === 'light'
    ? '0 -1px 0 rgba(96, 62, 24, 0.08), 0 -10px 28px rgba(74, 44, 16, 0.12)'
    : '0 -1px 0 rgba(255,255,255,0.04), 0 -12px 34px rgba(0,0,0,0.34)';

  const chromeBg = mixColor('#101827', '#FFF9F1', lightBlend, mode === 'light' ? 0.9 : 0.84);
  const chromeBgStrong = mixColor('#111B2D', '#FFFCF7', lightBlend, mode === 'light' ? 0.95 : 0.9);
  const chromeShadow = mode === 'light'
    ? '0 16px 36px rgba(112, 77, 28, 0.12), 0 1px 0 rgba(255,255,255,0.42) inset'
    : '0 18px 40px rgba(0,0,0,0.34), 0 1px 0 rgba(255,255,255,0.05) inset';

  // Orb arc: orbitalProgress 0→0.5 = day (east→west), 0.5→1 = night (west→east)
  // Same sine bell for height in both halves so the arc is visually continuous
  const arcPhase = solar.orbitalProgress <= 0.5
    ? solar.orbitalProgress * 2
    : (solar.orbitalProgress - 0.5) * 2;
  const orbHeightFraction = Math.sin(arcPhase * Math.PI);
  const orbPositionX = `${Math.round(8 + (solar.orbitalProgress * 84))}%`;
  const orbPositionY = solar.isDay
    ? `${Math.round(64 - (orbHeightFraction * 46))}%`
    : `${Math.round(68 - (orbHeightFraction * 24))}%`;
  const orbSize = solar.isDay
    ? `${Math.round(220 + (solar.daylight * 110))}px`
    : `${Math.round(160 + (nightClearness * 60) + (solar.nightDepth * 30))}px`;
  const orbColor = solar.isDay
    ? mixColor('#FFE1B8', '#FFF4D8', solar.daylight, clamp(0.72 - (weather.cloudiness * 0.2), 0.32, 0.84))
    : mixColor('#6E88B8', '#C4D4F0', solar.nightDepth, clamp(0.14 + (nightClearness * 0.3), 0.08, 0.46));

  // Sky gradient: bottom brightens first at dawn, top stays darkest longest — physically correct.
  // Clear nights: deep blue at top instead of flat black.
  const nightTopHex = nightClearness > 0.5 ? '#06112B' : '#040915';
  const skyTop    = solidColor(nightTopHex, '#D8C49A', clamp((lightBlend * 0.72) + (warmth * 0.14), 0, 1));
  const skyMid    = solidColor('#111D37',   '#F0E8D4', clamp((lightBlend * 0.92) + (warmth * 0.06), 0, 1));
  const skyBottom = solidColor('#162545',   '#FFFDF7', clamp( lightBlend + 0.18,                    0, 1));
  const horizon = mixColor('#2A365C', '#F3C17E', clamp(warmth + (solar.daylight * 0.18), 0.12, 1), 0.55);
  const seasonGlow = season === 'spring'
    ? mixColor('#C67AAF', '#FFD0E5', lightBlend, clamp(0.18 + (pinkAccent * 0.3), 0.18, 0.44))
    : season === 'autumn'
      ? mixColor('#8E5221', '#F0B36A', lightBlend, 0.24)
      : season === 'winter'
        ? mixColor('#9EC3F4', '#DCEBFF', lightBlend, 0.16)
        : mixColor('#E8BA7C', '#F6D59A', lightBlend, 0.16);
  const cloudGlow = mixColor('#2B3A5C', '#F7F1E2', lightBlend, clamp(0.08 + (weather.cloudiness * 0.12), 0.08, 0.22));
  const gridLine = mixColor('#2A3C63', '#D5B389', lightBlend, mode === 'light' ? 0.05 : 0.04);
  const gridLineSoft = mixColor('#2A3C63', '#FFFFFF', lightBlend, mode === 'light' ? 0.03 : 0.02);
  const vignette = mixColor('#000000', '#2B1200', warmth * 0.4, mode === 'light' ? 0.16 : 0.38);
  const rainOpacity = weather.rainy ? clamp(0.08 + (weather.rainIntensity * 0.22), 0.12, 0.32) : 0;
  const lightningPeak = weather.thunder
    ? '0.36'
    : weather.rainy
      ? '0.14'
      : '0';
  const lightningTail = weather.thunder
    ? '0.14'
    : weather.rainy
      ? '0.06'
      : '0';

  const themeColor = mode === 'light'
    ? solidColor('#E8D4B0', '#F4EEE1', lightBlend)
    : solidColor('#090F1A', '#1B2536', lightBlend);

  return {
    mode,
    season,
    weatherMode,
    snapshot,
    themeColor,
    meta: {
      sunriseMinutes: solar.sunrise,
      sunsetMinutes: solar.sunset,
      isDay: solar.isDay,
      temperatureC: Number(snapshot?.current?.temperature_2m ?? 0) || 0,
    },
    cssVariables: {
      '--bg': bg,
      '--surface': surface,
      '--surface-elevated': surfaceElevated,
      '--surface-muted': surfaceMuted,
      '--text-primary': textPrimary,
      '--text-secondary': textSecondary,
      '--text-tertiary': textTertiary,
      '--border': border,
      '--border-strong': borderStrong,
      '--border-soft': borderSoft,
      '--accent': accent,
      '--accent-hover': accentHover,
      '--accent-light': accentLight,
      '--accent-alpha': accentAlpha,
      '--accent-medium': accentMedium,
      '--accent-strong': mode === 'light' ? '#5C3308' : '#E8F0FF',
      '--premium': premium,
      '--premium-light': premiumLight,
      '--error': error,
      '--error-light': errorLight,
      '--success': success,
      '--success-light': successLight,
      '--warning': warning,
      '--warning-light': warningLight,
      '--surface-soft': surfaceSoft,
      '--shadow-sm': shadowSm,
      '--shadow-md': shadowMd,
      '--shadow-lg': shadowLg,
      '--shadow-nav': shadowNav,
      '--system-color-scheme': mode,
      '--chrome-bg': chromeBg,
      '--chrome-bg-strong': chromeBgStrong,
      '--chrome-shadow': chromeShadow,
      '--ambient-sky-top': skyTop,
      '--ambient-sky-mid': skyMid,
      '--ambient-sky-bottom': skyBottom,
      '--ambient-horizon': horizon,
      '--ambient-orb-color': orbColor,
      '--ambient-orb-x': orbPositionX,
      '--ambient-orb-y': orbPositionY,
      '--ambient-orb-size': orbSize,
      '--ambient-grid': gridLine,
      '--ambient-grid-soft': gridLineSoft,
      '--ambient-season-glow': seasonGlow,
      '--ambient-cloud-glow': cloudGlow,
      '--ambient-vignette': vignette,
      '--ambient-rain-opacity': String(rainOpacity),
      '--ambient-lightning-peak': lightningPeak,
      '--ambient-lightning-tail': lightningTail,
      '--ambient-storm-weight': String(stormWeight.toFixed(3)),
    },
  };
}

export function applyAmbientTheme(themeState) {
  if (typeof document === 'undefined' || !themeState) {
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-theme-mode', themeState.mode);
  root.setAttribute('data-weather-mode', themeState.weatherMode);
  root.setAttribute('data-season', themeState.season);

  const variables = themeState.cssVariables || {};
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }

  document.body.style.backgroundColor = themeState.themeColor;

  let metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) {
    metaThemeColor = document.createElement('meta');
    metaThemeColor.setAttribute('name', 'theme-color');
    document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.setAttribute('content', themeState.themeColor);
}

export function getFallbackAmbientThemeState(themePreference = 'ambient') {
  return buildAmbientThemeState(loadCachedAmbientSnapshot() || getDefaultSnapshot(), themePreference);
}
