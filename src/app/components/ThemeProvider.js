'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react';
import {
  applyAmbientTheme,
  buildAmbientThemeState,
  fetchBudapestAmbientSnapshot,
  loadCachedAmbientSnapshot,
} from '../lib/ambientTheme';

const ThemeContext = createContext({
  theme: 'light',
  themeState: null,
  themePreference: 'ambient',
  setThemePreference: () => {},
});

const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const SOLAR_TICK_MS = 60 * 1000;

export function ThemeProvider({ children }) {
  const [themePreference, setThemePreferenceState] = useState('ambient');

  // Load initial theme preference from local storage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('explore-theme-preference');
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemePreferenceState(stored);
      }
    }
  }, []);

  const [snapshot, setSnapshot] = useState(() => loadCachedAmbientSnapshot());
  const [tick, setTick] = useState(0);

  // Derive themeState from snapshot, themePreference, and time tick
  const themeState = useMemo(() => {
    // Reference tick to satisfy eslint exhaustive-deps since buildAmbientThemeState reads time dynamically
    const _t = tick;
    return buildAmbientThemeState(snapshot, themePreference);
  }, [snapshot, themePreference, tick]);

  useLayoutEffect(() => {
    applyAmbientTheme(themeState);
  }, [themeState]);

  const setThemePreference = useCallback((pref) => {
    setThemePreferenceState(pref);
    if (typeof window !== 'undefined') {
      localStorage.setItem('explore-theme-preference', pref);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const refreshWeather = async ({ forceRefresh = false } = {}) => {
      try {
        const nextSnapshot = await fetchBudapestAmbientSnapshot({
          signal: controller.signal,
          forceRefresh,
        });

        if (!active) {
          return;
        }

        setSnapshot(nextSnapshot);
      } catch {
        // Ignore error, keep existing snapshot
      }
    };

    void refreshWeather();

    const solarTimer = window.setInterval(() => {
      if (!active) {
        return;
      }
      setTick((t) => t + 1);
    }, SOLAR_TICK_MS);

    const weatherTimer = window.setInterval(() => {
      void refreshWeather({ forceRefresh: true });
    }, WEATHER_REFRESH_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshWeather();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      controller.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(solarTimer);
      window.clearInterval(weatherTimer);
    };
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme: themeState?.mode || 'light',
        themeState,
        themePreference,
        setThemePreference,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
