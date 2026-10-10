package org.loka.awareprobe;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.pm.PackageManager;
import android.net.wifi.aware.WifiAwareManager;
import android.net.wifi.aware.Characteristics;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

/** Isolated capability and user-started pairing test; no production app data. */
public final class MainActivity extends Activity {
    private PairingProbe probe;
    private ReverseDiscovery reverse;
    private android.widget.Button reverseButton;
    private void beginReverse() {
        if (reverse != null && reverse.isActive()) return;
        if (checkSelfPermission(android.Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.NEARBY_WIFI_DEVICES}, 2); return;
        }
        if (probe != null) probe.close();
        start.setEnabled(false);
        reverse = new ReverseDiscovery(this, line -> {
            view.setText(line);
            boolean active = reverse != null && reverse.isActive();
            reverseButton.setEnabled(!active); start.setEnabled(!active);
        });
        reverse.start();
    }
    private TextView view;
    private android.widget.Button start;
    private void beginTest() {
        if (reverse != null && reverse.isActive()) return;
        if (probe != null && probe.isActive()) return;
        if (checkSelfPermission(android.Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.NEARBY_WIFI_DEVICES}, 1); return;
        }
        probe = new PairingProbe(this, line -> {
            if (reverse != null && reverse.isActive()) return;
            view.setText(line);
            boolean active = probe != null && probe.isActive();
            start.setEnabled(!active);
            reverseButton.setEnabled(!active);
            start.setText(active ? "Waiting for iPhone…" : "Start pairing test");
        });
        start.setEnabled(false);
        probe.start();
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == 1 && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) beginTest();
        else if (code == 2 && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) beginReverse();
        else if (code == 1 || code == 2) view.setText("Nearby devices access is needed for this test. Tap Start to try again, or enable it in Settings → Apps → LOKA Aware Probe → Permissions.");
    }
    @Override protected void onDestroy() { if (probe != null) probe.close(); if (reverse != null) reverse.close(); super.onDestroy(); }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        JSONObject report = new JSONObject();
        try {
            report.put("schema", 1).put("captured_at", Instant.now().toString());
            report.put("model", Build.MODEL).put("os", Build.VERSION.RELEASE).put("sdk", Build.VERSION.SDK_INT);
            report.put("kind", "physical_capability_probe");
            report.put("aware_feature", getPackageManager().hasSystemFeature(PackageManager.FEATURE_WIFI_AWARE));
            WifiAwareManager manager = getSystemService(WifiAwareManager.class);
            report.put("available", manager != null && manager.isAvailable());
            Characteristics c = manager == null ? null : manager.getCharacteristics();
            if (c != null) {
                report.put("pairing_supported", c.isAwarePairingSupported());
                report.put("pairing_cipher_suites", c.getSupportedPairingCipherSuites());
                report.put("data_cipher_suites", c.getSupportedCipherSuites());
                report.put("max_data_paths", c.getNumberOfSupportedDataPaths());
                report.put("max_data_interfaces", c.getNumberOfSupportedDataInterfaces());
                report.put("max_publish_sessions", c.getNumberOfSupportedPublishSessions());
                report.put("max_subscribe_sessions", c.getNumberOfSupportedSubscribeSessions());
                report.put("instant_mode_supported", c.isInstantCommunicationModeSupported());
                report.put("suspension_supported", c.isSuspensionSupported());
            }
        } catch (Exception e) {
            try { report.put("error", e.getClass().getSimpleName()); } catch (Exception ignored) {}
        }
        view = new TextView(this); view.setPadding(32, 72, 32, 32); view.setTextSize(16);
        String output;
        try { output = report.toString(2); Files.write(new File(getFilesDir(), "capabilities.json").toPath(), output.getBytes(StandardCharsets.UTF_8)); }
        catch (Exception e) { output = report + "\nCould not save report: " + e.getClass().getSimpleName(); }
        view.setText("iPhone pairing test\n\n1. On iPhone tap Make iPhone discoverable and keep that screen open.\n2. Here tap Find and pair with iPhone.\n\nWe will check whether Android can see the test service. Confirm the test, then enter the six-digit code shown by the iPhone.\n\nLOKA chats are unchanged.");
        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        android.widget.ScrollView scroll = new android.widget.ScrollView(this); scroll.addView(view);
        layout.addView(scroll, new android.widget.LinearLayout.LayoutParams(-1, 0, 1));
        reverseButton = new android.widget.Button(this); reverseButton.setText("Find and pair with iPhone");
        reverseButton.setOnClickListener(v -> beginReverse()); layout.addView(reverseButton);
        start = new android.widget.Button(this); start.setText("Other direction: let iPhone find Android");
        start.setOnClickListener(v -> beginTest()); layout.addView(start);
        android.widget.Button stop = new android.widget.Button(this); stop.setText("Stop test");
        stop.setOnClickListener(v -> { if (probe != null) probe.close(); if (reverse != null) reverse.close(); reverseButton.setEnabled(true); start.setEnabled(true); view.setText("Test stopped. Choose a test to start again."); }); layout.addView(stop);
        setContentView(layout);
        // Explicit development launch option: discovery only; native pairing still needs confirmation.
        if (getIntent().getBooleanExtra("reverseTest", false)) beginReverse();
    }
}
