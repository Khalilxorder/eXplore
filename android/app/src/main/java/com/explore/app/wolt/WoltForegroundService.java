package com.explore.app.wolt;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.explore.app.MainActivity;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class WoltForegroundService extends Service {
    private static final String TAG = "WoltForegroundService";
    public static final String CHANNEL_ID = "wolt_demand_monitor_channel";
    public static final int NOTIFICATION_ID = 901;

    // Intent extras
    public static final String EXTRA_BACKEND_URL = "extra_backend_url";
    public static final String EXTRA_INTERVAL_MINUTES = "extra_interval_minutes";
    public static final String EXTRA_AUTH_TOKEN = "extra_auth_token";

    private HandlerThread backgroundThread;
    private Handler backgroundHandler;
    private Runnable pollRunnable;

    private int pollIntervalMs = 2 * 60 * 1000; // 2 minutes default
    private String backendBaseUrl = "http://localhost:8080";
    private String authToken = "";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        backgroundThread = new HandlerThread("WoltMonitorThread");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String urlExtra = intent.getStringExtra(EXTRA_BACKEND_URL);
            if (urlExtra != null && !urlExtra.isEmpty()) {
                backendBaseUrl = urlExtra;
            }
            int intervalMins = intent.getIntExtra(EXTRA_INTERVAL_MINUTES, 2);
            if (intervalMins >= 1) {
                pollIntervalMs = intervalMins * 60 * 1000;
            }
            String tokenExtra = intent.getStringExtra(EXTRA_AUTH_TOKEN);
            if (tokenExtra != null && !tokenExtra.isEmpty()) {
                authToken = tokenExtra;
            }
        }

        Notification notification = buildForegroundNotification("Monitoring Wolt demand in background...");
        startForeground(NOTIFICATION_ID, notification);
        startPolling();

        return START_STICKY;
    }

    private void startPolling() {
        if (pollRunnable != null) {
            backgroundHandler.removeCallbacks(pollRunnable);
        }
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                performWoltCheck();
                backgroundHandler.postDelayed(this, pollIntervalMs);
            }
        };
        backgroundHandler.post(pollRunnable);
    }

    private void performWoltCheck() {
        try {
            Log.d(TAG, "Performing Wolt background check against: " + backendBaseUrl);
            URL url = new URL(backendBaseUrl + "/api/v1/wolt/check");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            if (!authToken.isEmpty()) {
                conn.setRequestProperty("Authorization", authToken.startsWith("Bearer ") ? authToken : "Bearer " + authToken);
            }
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            // Empty JSON body to satisfy POST requirements
            byte[] body = "{}".getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
            }

            int code = conn.getResponseCode();
            Log.d(TAG, "Wolt check response: " + code);
            conn.disconnect();
        } catch (Exception e) {
            Log.e(TAG, "Error during Wolt demand background check", e);
        }
    }

    private Notification buildForegroundNotification(String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Wolt Demand Monitor")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Wolt Demand Monitor Active",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows sticky foreground status when Wolt demand monitor is active.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        if (backgroundHandler != null && pollRunnable != null) {
            backgroundHandler.removeCallbacks(pollRunnable);
        }
        if (backgroundThread != null) {
            backgroundThread.quitSafely();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
