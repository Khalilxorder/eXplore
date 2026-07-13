'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  PRIORITY_RADAR_EVENT,
  loadPriorityRadarSettings,
  runPriorityRadarCheck,
} from '../lib/alertRadar';
import { useAuth } from './AuthProvider';

export default function PriorityRadarMonitor() {
  useAuth();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let intervalId = null;

    const scheduleMonitor = async () => {
      const settings = loadPriorityRadarSettings();

      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
      }

      if (!settings.enabled || Capacitor.isNativePlatform()) {
        return;
      }

      const pollMs = Math.max(1, Number(settings.pollMinutes) || 5) * 60 * 1000;
      intervalId = window.setInterval(() => {
        void runPriorityRadarCheck();
      }, pollMs);
    };

    const runOnFocus = () => {
      const settings = loadPriorityRadarSettings();
      if (!settings.enabled || Capacitor.isNativePlatform()) {
        return;
      }

      void runPriorityRadarCheck();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runOnFocus();
      }
    };

    const handleSettingsChanged = () => {
      void scheduleMonitor();
      runOnFocus();
    };

    void scheduleMonitor();
    runOnFocus();

    window.addEventListener(PRIORITY_RADAR_EVENT, handleSettingsChanged);
    window.addEventListener('focus', runOnFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalId) {
        window.clearInterval(intervalId);
      }

      window.removeEventListener(PRIORITY_RADAR_EVENT, handleSettingsChanged);
      window.removeEventListener('focus', runOnFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return null;
}
