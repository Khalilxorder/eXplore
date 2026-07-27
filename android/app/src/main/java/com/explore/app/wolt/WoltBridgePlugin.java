package com.explore.app.wolt;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor bridge plugin that allows the JS layer (WoltDemandMonitor.js)
 * to start / stop / configure the WoltForegroundService from JavaScript.
 *
 * JS usage (via Capacitor Plugins API):
 *   import { Plugins } from '@capacitor/core';
 *   const { WoltBridge } = Plugins;
 *   await WoltBridge.start({ backendUrl: 'http://192.168.x.x:8080', intervalMinutes: 2 });
 *   await WoltBridge.stop();
 */
@CapacitorPlugin(name = "WoltBridge")
public class WoltBridgePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        String backendUrl = call.getString("backendUrl", "");
        int intervalMinutes = call.getInt("intervalMinutes", 2);
        String authToken = call.getString("authToken", "");

        Intent intent = new Intent(ctx, WoltForegroundService.class);
        if (!backendUrl.isEmpty()) {
            intent.putExtra(WoltForegroundService.EXTRA_BACKEND_URL, backendUrl);
        }
        intent.putExtra(WoltForegroundService.EXTRA_INTERVAL_MINUTES, intervalMinutes);
        if (!authToken.isEmpty()) {
            intent.putExtra(WoltForegroundService.EXTRA_AUTH_TOKEN, authToken);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }

        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("message", "WoltForegroundService started");
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, WoltForegroundService.class));

        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("message", "WoltForegroundService stopped");
        call.resolve(result);
    }
}
