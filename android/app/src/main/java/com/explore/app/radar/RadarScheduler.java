package com.explore.app.radar;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

public final class RadarScheduler {
    private static final String UNIQUE_WORK_NAME = "explore-priority-radar";

    private RadarScheduler() {
    }

    public static void apply(Context context, boolean enabled) {
        WorkManager workManager = WorkManager.getInstance(context);

        if (!enabled) {
            workManager.cancelUniqueWork(UNIQUE_WORK_NAME);
            return;
        }

        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();

        PeriodicWorkRequest periodicRequest = new PeriodicWorkRequest.Builder(
            RadarWorker.class,
            15,
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .build();

        workManager.enqueueUniquePeriodicWork(
            UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodicRequest
        );

        runNow(context);
    }

    public static void runNow(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(RadarWorker.class)
            .setConstraints(constraints)
            .build();

        WorkManager.getInstance(context).enqueue(request);
    }
}
