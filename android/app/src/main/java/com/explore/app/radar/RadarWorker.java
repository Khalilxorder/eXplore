package com.explore.app.radar;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.explore.app.MainActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class RadarWorker extends Worker {
    private static final String CHANNEL_ID = "priority_radar";
    private static final String CHANNEL_NAME = "Priority radar";

    public RadarWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        if (!RadarPreferences.isEnabled(context)) {
            RadarPreferences.saveWorkerStatus(context, "disabled", "");
            return Result.success();
        }

        String url = RadarPreferences.buildRadarUrl(context);
        if (url.isEmpty()) {
            RadarPreferences.saveWorkerStatus(context, "missing_api_base", "Radar API base URL is missing.");
            return Result.success();
        }

        try {
            JSONObject payload = new JSONObject(fetchJson(url));
            if (!payload.optBoolean("success", false)) {
                RadarPreferences.saveWorkerStatus(context, "api_error", "Radar API response was not successful.");
                return Result.retry();
            }

            JSONArray alerts = payload.optJSONArray("alerts");
            if (alerts == null || alerts.length() == 0) {
                RadarPreferences.saveWorkerStatus(context, "success_empty", "");
                return Result.success();
            }

            Set<String> seenIds = RadarPreferences.getSeenIds(context);
            List<JSONObject> freshAlerts = new ArrayList<>();
            List<String> freshIds = new ArrayList<>();

            for (int index = 0; index < alerts.length(); index += 1) {
                JSONObject alert = alerts.optJSONObject(index);
                if (alert == null) {
                    continue;
                }

                String alertId = alert.optString("id", "");
                if (alertId.isEmpty() || seenIds.contains(alertId)) {
                    continue;
                }

                if (!matchesPreferences(context, alert)) {
                    continue;
                }

                freshAlerts.add(alert);
                freshIds.add(alertId);
            }

            if (freshAlerts.isEmpty()) {
                RadarPreferences.saveWorkerStatus(context, "success_no_new_alerts", "");
                return Result.success();
            }

            if (!notificationsGranted(context)) {
                RadarPreferences.saveWorkerStatus(context, "permission_required", "Notification permission is not granted.");
                return Result.success();
            }

            showNotification(context, freshAlerts);
            RadarPreferences.markSeen(context, freshIds);
            RadarPreferences.saveWorkerStatus(context, "notified", "");
            return Result.success();
        } catch (Exception error) {
            RadarPreferences.saveWorkerStatus(context, "error", error.getMessage());
            return Result.retry();
        }
    }

    private void showNotification(Context context, List<JSONObject> alerts) {
        ensureChannel(context);

        String title;
        String body;

        if (alerts.size() == 1) {
            JSONObject alert = alerts.get(0);
            String category = alert.optString("category", "ai");
            if ("geo".equals(category) || "political".equals(category)) {
                String alertLabel = "political".equals(category) ? "political alert" : "threat";
                title = "eXplore radar: " + alert.optString("threatLevel", "Elevated") + " " + alertLabel;
            } else {
                title = "eXplore radar: " + alert.optString("importance", "important").toUpperCase(Locale.US) + " AI alert";
            }

            body = alert.optString("title", "Important update detected.");
        } else {
            title = "eXplore radar: " + alerts.size() + " new important alerts";
            body = joinTitles(alerts);
        }

        PendingIntent contentIntent = buildContentIntent(context, alerts);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        int notificationId = Math.abs(alerts.get(0).optString("id", "1").hashCode());
        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
    }

    private boolean matchesPreferences(Context context, JSONObject alert) {
        String category = alert.optString("category", "");
        if ("geo".equals(category) || "political".equals(category)) {
            return RadarPreferences.isGeoEnabled(context);
        }

        if (!"ai".equals(category) || !RadarPreferences.isAiEnabled(context)) {
            return false;
        }

        if (!RadarPreferences.isReleaseWatchEnabled(context)) {
            return true;
        }

        boolean officialSource = alert.optBoolean("official_source", alert.optBoolean("officialSource", false));
        String releaseSignal = readString(alert, "release_watch_signal", "releaseWatchSignal");
        if ("direct_news_notification".equalsIgnoreCase(releaseSignal)) {
            if (!RadarPreferences.isDirectNewsWatchEnabled(context)) {
                return false;
            }

            Set<String> sources = RadarPreferences.getDirectNewsWatchSources(context);
            String source = readString(alert, "direct_notification_source_id", "directNotificationSourceId").toLowerCase(Locale.US);
            if (source.isEmpty()) {
                source = readString(alert, "release_watch_company", "releaseWatchCompany").toLowerCase(Locale.US);
            }

            return sources.isEmpty() || sources.contains(source);
        }

        if (!officialSource || !"official_release".equalsIgnoreCase(releaseSignal)) {
            return false;
        }

        Set<String> companies = RadarPreferences.getReleaseWatchCompanies(context);
        String company = readString(alert, "release_watch_company", "releaseWatchCompany").toLowerCase(Locale.US);
        if (!companies.isEmpty() && !companies.contains(company)) {
            return false;
        }

        return importanceRank(alert.optString("importance", "important"))
            >= importanceRank(RadarPreferences.getReleaseWatchMinImportance(context));
    }

    private String readString(JSONObject alert, String snakeCaseKey, String camelCaseKey) {
        String value = alert.optString(snakeCaseKey, "");
        return value.isEmpty() ? alert.optString(camelCaseKey, "") : value;
    }

    private int importanceRank(String importance) {
        return "major".equalsIgnoreCase(importance) ? 2 : 1;
    }

    private PendingIntent buildContentIntent(Context context, List<JSONObject> alerts) {
        Intent intent = new Intent(Intent.ACTION_VIEW, buildDeepLink(alerts), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        return PendingIntent.getActivity(
            context,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Uri buildDeepLink(List<JSONObject> alerts) {
        if (alerts.size() == 1) {
            String alertId = alerts.get(0).optString("id", "");
            if (!alertId.isEmpty()) {
                return Uri.parse("explore://radar/" + Uri.encode(alertId));
            }
        }

        return Uri.parse("explore://radar");
    }

    private String joinTitles(List<JSONObject> alerts) {
        StringBuilder builder = new StringBuilder();

        for (int index = 0; index < alerts.size() && index < 2; index += 1) {
            if (builder.length() > 0) {
                builder.append(" | ");
            }

            builder.append(alerts.get(index).optString("title", "Important update"));
        }

        return builder.toString();
    }

    private void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("High-signal AI and regional security alerts");
        manager.createNotificationChannel(channel);
    }

    private boolean notificationsGranted(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true;
        }

        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private String fetchJson(String urlString) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");

        try {
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();

            if (stream == null) {
                throw new IllegalStateException("Radar response was empty");
            }

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                StringBuilder builder = new StringBuilder();
                String line;

                while ((line = reader.readLine()) != null) {
                    builder.append(line);
                }

                if (status < 200 || status >= 300) {
                    throw new IllegalStateException(builder.toString());
                }

                return builder.toString();
            }
        } finally {
            connection.disconnect();
        }
    }
}
