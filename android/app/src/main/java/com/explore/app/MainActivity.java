package com.explore.app;

import android.os.Bundle;

import com.explore.app.radar.RadarBridgePlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(RadarBridgePlugin.class);
    }
}
