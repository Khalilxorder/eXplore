package com.explore.app.radar;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class RadarPreferences {
    private static final String PREFS_NAME = "explore_priority_radar";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_API_BASE = "api_base";
    private static final String KEY_AI_ENABLED = "ai_enabled";
    private static final String KEY_GEO_ENABLED = "geo_enabled";
    private static final String KEY_RELEASE_WATCH_ENABLED = "release_watch_enabled";
    private static final String KEY_RELEASE_WATCH_COMPANIES = "release_watch_companies";
    private static final String KEY_RELEASE_WATCH_MIN_IMPORTANCE = "release_watch_min_importance";
    private static final String KEY_DIRECT_NEWS_WATCH_ENABLED = "direct_news_watch_enabled";
    private static final String KEY_DIRECT_NEWS_WATCH_SOURCES = "direct_news_watch_sources";
    private static final String KEY_LAST_CHECKED_AT = "last_checked_at";
    private static final String KEY_LAST_STATUS = "last_status";
    private static final String KEY_LAST_ERROR = "last_error";
    private static final String KEY_SEEN_IDS = "seen_ids";
    private static final int MAX_SEEN_IDS = 120;

    private RadarPreferences() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static void saveConfig(
        Context context,
        boolean enabled,
        String apiBase,
        boolean aiEnabled,
        boolean geoEnabled,
        boolean releaseWatchEnabled,
        String releaseWatchCompanies,
        String releaseWatchMinImportance,
        boolean directNewsWatchEnabled,
        String directNewsWatchSources
    ) {
        prefs(context)
            .edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putString(KEY_API_BASE, sanitizeBaseUrl(apiBase))
            .putBoolean(KEY_AI_ENABLED, aiEnabled)
            .putBoolean(KEY_GEO_ENABLED, geoEnabled)
            .putBoolean(KEY_RELEASE_WATCH_ENABLED, releaseWatchEnabled)
            .putString(KEY_RELEASE_WATCH_COMPANIES, sanitizeCompanies(releaseWatchCompanies))
            .putString(KEY_RELEASE_WATCH_MIN_IMPORTANCE, sanitizeImportance(releaseWatchMinImportance))
            .putBoolean(KEY_DIRECT_NEWS_WATCH_ENABLED, directNewsWatchEnabled)
            .putString(KEY_DIRECT_NEWS_WATCH_SOURCES, sanitizeCompanies(directNewsWatchSources))
            .apply();
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    public static String getApiBase(Context context) {
        return sanitizeBaseUrl(prefs(context).getString(KEY_API_BASE, ""));
    }

    public static boolean isAiEnabled(Context context) {
        return prefs(context).getBoolean(KEY_AI_ENABLED, true);
    }

    public static boolean isGeoEnabled(Context context) {
        return prefs(context).getBoolean(KEY_GEO_ENABLED, false);
    }

    public static boolean isReleaseWatchEnabled(Context context) {
        return prefs(context).getBoolean(KEY_RELEASE_WATCH_ENABLED, true);
    }

    public static Set<String> getReleaseWatchCompanies(Context context) {
        String raw = prefs(context).getString(
            KEY_RELEASE_WATCH_COMPANIES,
            "anthropic,openai,google,xai"
        );
        String sanitized = sanitizeCompanies(raw);
        return sanitized.isEmpty()
            ? new LinkedHashSet<>()
            : new LinkedHashSet<>(Arrays.asList(sanitized.split(",")));
    }

    public static String getReleaseWatchMinImportance(Context context) {
        return sanitizeImportance(prefs(context).getString(KEY_RELEASE_WATCH_MIN_IMPORTANCE, "important"));
    }

    public static boolean isDirectNewsWatchEnabled(Context context) {
        return prefs(context).getBoolean(KEY_DIRECT_NEWS_WATCH_ENABLED, true);
    }

    public static Set<String> getDirectNewsWatchSources(Context context) {
        String raw = prefs(context).getString(KEY_DIRECT_NEWS_WATCH_SOURCES, "anthropic");
        String sanitized = sanitizeCompanies(raw);
        return sanitized.isEmpty()
            ? new LinkedHashSet<>()
            : new LinkedHashSet<>(Arrays.asList(sanitized.split(",")));
    }

    public static void saveWorkerStatus(Context context, String status, String error) {
        prefs(context)
            .edit()
            .putLong(KEY_LAST_CHECKED_AT, System.currentTimeMillis())
            .putString(KEY_LAST_STATUS, status == null ? "" : status)
            .putString(KEY_LAST_ERROR, error == null ? "" : error)
            .apply();
    }

    public static long getLastCheckedAt(Context context) {
        return prefs(context).getLong(KEY_LAST_CHECKED_AT, 0);
    }

    public static String getLastStatus(Context context) {
        return prefs(context).getString(KEY_LAST_STATUS, "never_run");
    }

    public static String getLastError(Context context) {
        return prefs(context).getString(KEY_LAST_ERROR, "");
    }

    public static void markSeen(Context context, List<String> alertIds) {
        LinkedHashSet<String> merged = new LinkedHashSet<>();

        for (String alertId : alertIds) {
            if (alertId != null && !alertId.isEmpty()) {
                merged.add(alertId);
            }
        }

        merged.addAll(getSeenIds(context));

        JSONArray jsonArray = new JSONArray();
        int count = 0;
        for (String alertId : merged) {
            jsonArray.put(alertId);
            count += 1;
            if (count >= MAX_SEEN_IDS) {
                break;
            }
        }

        prefs(context).edit().putString(KEY_SEEN_IDS, jsonArray.toString()).apply();
    }

    public static Set<String> getSeenIds(Context context) {
        String raw = prefs(context).getString(KEY_SEEN_IDS, "[]");
        LinkedHashSet<String> result = new LinkedHashSet<>();

        try {
          JSONArray jsonArray = new JSONArray(raw);
          for (int index = 0; index < jsonArray.length(); index += 1) {
              String value = jsonArray.optString(index, "");
              if (!value.isEmpty()) {
                  result.add(value);
              }
          }
        } catch (JSONException ignored) {
        }

        return result;
    }

    public static String buildRadarUrl(Context context) {
        String apiBase = getApiBase(context);
        if (apiBase.isEmpty()) {
            return "";
        }

        return apiBase
            + "/api/v1/alerts/radar?limit=5"
            + "&ai=" + isAiEnabled(context)
            + "&geo=" + isGeoEnabled(context);
    }

    private static String sanitizeBaseUrl(String value) {
        if (value == null) {
            return "";
        }

        String trimmed = value.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }

        return trimmed;
    }

    private static String sanitizeCompanies(String value) {
        if (value == null) {
            return "";
        }

        LinkedHashSet<String> companies = new LinkedHashSet<>();
        for (String company : value.split(",")) {
            String normalized = company.trim().toLowerCase();
            if (!normalized.isEmpty() && normalized.matches("[a-z0-9_]+")) {
                companies.add(normalized);
            }
        }
        return String.join(",", companies);
    }

    private static String sanitizeImportance(String value) {
        return "major".equalsIgnoreCase(value) ? "major" : "important";
    }
}
