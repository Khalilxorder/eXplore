package com.explore.app.radar;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RadarBridge")
public class RadarBridgePlugin extends Plugin {
    @PluginMethod
    public void configure(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        String apiBase = call.getString("apiBase", "");
        boolean aiEnabled = call.getBoolean("aiEnabled", true);
        boolean geoEnabled = call.getBoolean("geoEnabled", false);
        boolean releaseWatchEnabled = call.getBoolean("releaseWatchEnabled", true);
        String releaseWatchCompanies = call.getString("releaseWatchCompanies", "");
        String releaseWatchMinImportance = call.getString("releaseWatchMinImportance", "important");
        boolean directNewsWatchEnabled = call.getBoolean("directNewsWatchEnabled", true);
        String directNewsWatchSources = call.getString("directNewsWatchSources", "anthropic");

        RadarPreferences.saveConfig(
            getContext(),
            enabled,
            apiBase,
            aiEnabled,
            geoEnabled,
            releaseWatchEnabled,
            releaseWatchCompanies,
            releaseWatchMinImportance,
            directNewsWatchEnabled,
            directNewsWatchSources
        );
        RadarScheduler.apply(getContext(), enabled);

        JSObject response = new JSObject();
        response.put("ok", true);
        response.put("enabled", enabled);
        response.put("intervalMinutes", 15);
        response.put("apiBase", RadarPreferences.getApiBase(getContext()));
        response.put("aiEnabled", RadarPreferences.isAiEnabled(getContext()));
        response.put("geoEnabled", RadarPreferences.isGeoEnabled(getContext()));
        response.put("releaseWatchEnabled", RadarPreferences.isReleaseWatchEnabled(getContext()));
        response.put("releaseWatchCompanies", String.join(",", RadarPreferences.getReleaseWatchCompanies(getContext())));
        response.put("releaseWatchMinImportance", RadarPreferences.getReleaseWatchMinImportance(getContext()));
        response.put("directNewsWatchEnabled", RadarPreferences.isDirectNewsWatchEnabled(getContext()));
        response.put("directNewsWatchSources", String.join(",", RadarPreferences.getDirectNewsWatchSources(getContext())));
        response.put("lastCheckedAt", RadarPreferences.getLastCheckedAt(getContext()));
        response.put("lastStatus", RadarPreferences.getLastStatus(getContext()));
        response.put("lastError", RadarPreferences.getLastError(getContext()));
        call.resolve(response);
    }

    @PluginMethod
    public void performCheck(PluginCall call) {
        RadarScheduler.runNow(getContext());

        JSObject response = new JSObject();
        response.put("ok", true);
        response.put("scheduled", true);
        call.resolve(response);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject response = new JSObject();
        response.put("ok", true);
        response.put("enabled", RadarPreferences.isEnabled(getContext()));
        response.put("intervalMinutes", 15);
        response.put("apiBase", RadarPreferences.getApiBase(getContext()));
        response.put("aiEnabled", RadarPreferences.isAiEnabled(getContext()));
        response.put("geoEnabled", RadarPreferences.isGeoEnabled(getContext()));
        response.put("releaseWatchEnabled", RadarPreferences.isReleaseWatchEnabled(getContext()));
        response.put("releaseWatchCompanies", String.join(",", RadarPreferences.getReleaseWatchCompanies(getContext())));
        response.put("releaseWatchMinImportance", RadarPreferences.getReleaseWatchMinImportance(getContext()));
        response.put("directNewsWatchEnabled", RadarPreferences.isDirectNewsWatchEnabled(getContext()));
        response.put("directNewsWatchSources", String.join(",", RadarPreferences.getDirectNewsWatchSources(getContext())));
        response.put("lastCheckedAt", RadarPreferences.getLastCheckedAt(getContext()));
        response.put("lastStatus", RadarPreferences.getLastStatus(getContext()));
        response.put("lastError", RadarPreferences.getLastError(getContext()));
        call.resolve(response);
    }
}
