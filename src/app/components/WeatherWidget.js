'use client';

import { useEffect, useState } from 'react';

/* Weather condition code → emoji + label */
function parseWeatherCode(code) {
  if (code === 0)               return { emoji: '☀️', label: 'Clear' };
  if (code <= 2)                return { emoji: '🌤', label: 'Partly cloudy' };
  if (code === 3)               return { emoji: '☁️', label: 'Overcast' };
  if (code <= 49)               return { emoji: '🌫', label: 'Fog' };
  if (code <= 57)               return { emoji: '🌦', label: 'Drizzle' };
  if (code <= 67)               return { emoji: '🌧', label: 'Rain' };
  if (code <= 77)               return { emoji: '❄️', label: 'Snow' };
  if (code <= 82)               return { emoji: '🌦', label: 'Showers' };
  if (code <= 86)               return { emoji: '🌨', label: 'Snow showers' };
  if (code <= 99)               return { emoji: '⛈', label: 'Thunderstorm' };
  return { emoji: '🌡', label: 'Weather' };
}

const CACHE_KEY   = 'explore-weather-cache';
const CACHE_TTL   = 30 * 60 * 1000; // 30 min

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > CACHE_TTL) return null;
    return obj;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, ts: Date.now() }));
  } catch { /* quota */ }
}

export default function WeatherWidget() {
  const [state, setState] = useState(null); // { temp, code, city }
  const [status, setStatus] = useState('idle'); // idle | loading | ok | denied | error

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const schedule = (fn) => {
      queueMicrotask(() => {
        if (!cancelled) fn();
      });
    };

    const cached = readCache();
    if (cached?.temp !== undefined) {
      schedule(() => {
        setState(cached);
        setStatus('ok');
      });
      return () => {
        cancelled = true;
      };
    }

    schedule(() => setStatus('loading'));

    if (!navigator.geolocation) {
      schedule(() => setStatus('error'));
      return () => {
        cancelled = true;
      };
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          const [wx, geo] = await Promise.all([
            fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=celsius&wind_speed_unit=kmh&forecast_days=1`
            ).then((r) => r.json()),
            fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
            ).then((r) => r.json()),
          ]);

          const temp = Math.round(wx?.current?.temperature_2m ?? 0);
          const code = wx?.current?.weather_code ?? 0;
          const city =
            geo?.address?.city ||
            geo?.address?.town ||
            geo?.address?.village ||
            geo?.address?.county ||
            '';

          const payload = { temp, code, city };
          writeCache(payload);
          if (cancelled) return;
          setState(payload);
          setStatus('ok');
        } catch {
          if (cancelled) return;
          setStatus('error');
        }
      },
      () => {
        if (cancelled) return;
        setStatus('denied');
      },
      { timeout: 8000, maximumAge: CACHE_TTL }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="weather-widget weather-widget--loading" aria-label="Loading weather">
        <span className="weather-widget__spinner" aria-hidden="true" />
      </div>
    );
  }

  if (status === 'denied' || status === 'error' || !state) {
    return null; // silent fail — don't clutter the top bar
  }

  const { emoji, label } = parseWeatherCode(state.code);
  const locationLabel = state.city ? ` · ${state.city}` : '';

  return (
    <div
      className="weather-widget"
      title={`${label}${locationLabel} — ${state.temp}°C`}
      aria-label={`Weather: ${label}, ${state.temp}°C${locationLabel}`}
      role="status"
    >
      <span className="weather-widget__emoji" aria-hidden="true">{emoji}</span>
      <span className="weather-widget__temp">{state.temp}°</span>
    </div>
  );
}
