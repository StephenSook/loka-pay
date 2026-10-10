package org.loka.awareprobe;

import android.app.Activity;
import android.app.AlertDialog;
import android.widget.EditText;
import android.text.InputFilter;
import android.text.InputType;
import android.content.pm.PackageManager;
import android.net.wifi.aware.*;
import android.os.*;
import org.json.JSONObject;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** Native PIN pairing probe. No sockets, LOKA identities, or PIN logging. */
final class ReverseDiscovery implements AutoCloseable {
    private final Activity activity;
    private final Consumer<String> display;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final String run = UUID.randomUUID().toString();
    private final long began = SystemClock.elapsedRealtime();
    private WifiAwareSession aware;
    private SubscribeDiscoverySession subscription;
    private boolean closed, found;
    private PeerHandle selectedPeer;
    private String phase = "discovery";
    private AlertDialog dialog;
    private EditText pinInput;
    private void deadline(String expected, long ms, String message) {
        main.postDelayed(() -> { if (!closed && phase.equals(expected)) finish("reverse_" + expected + "_timeout", message); }, ms);
    }
    ReverseDiscovery(Activity activity, Consumer<String> display) { this.activity = activity; this.display = display; }
    boolean isActive() { return !closed; }
    private void event(String name, String message) {
        try {
            JSONObject row = new JSONObject().put("schema", 1).put("run", run).put("event", name)
                .put("mode", "reverse-pairing-v2-keypad").put("elapsed_ms", SystemClock.elapsedRealtime() - began)
                .put("captured_at", java.time.Instant.now().toString())
                .put("sdk", Build.VERSION.SDK_INT).put("bootstrap_metadata_api_available", Build.VERSION.SDK_INT >= 37)
                .put("bootstrap_request_method", AwarePairingConfig.PAIRING_BOOTSTRAPPING_PIN_CODE_KEYPAD);
            try (FileOutputStream out = activity.openFileOutput("events.jsonl", Activity.MODE_APPEND)) {
                out.write((row + "\n").getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) { }
        display.accept(message);
    }
    void start() {
        event("reverse_start", "Searching for the iPhone…\n\nOn iPhone tap Make iPhone discoverable, then keep its pairing screen open.\n\nAfter discovery, confirm the test and enter the code shown on your iPhone.");
        if (activity.checkSelfPermission(android.Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            finish("reverse_permission_missing", "Nearby devices permission is needed."); return;
        }
        try {
            WifiAwareManager manager = activity.getSystemService(WifiAwareManager.class);
            if (manager == null || !manager.isAvailable()) { finish("reverse_unavailable", "Wi-Fi Aware is unavailable. Leave Wi-Fi on."); return; }
            if (manager.getCharacteristics() == null || !manager.getCharacteristics().isAwarePairingSupported()) {
                finish("reverse_pairing_unsupported", "This phone does not report native Wi-Fi Aware pairing support."); return;
            }
            manager.attach(new AttachCallback() {
                @Override public void onAttached(WifiAwareSession session) {
                    if (closed) { session.close(); return; } aware = session; subscribe();
                }
                @Override public void onAttachFailed() { finish("reverse_attach_failed", "Android could not start discovery."); }
            }, main);
            deadline("discovery", 120_000, "No matching service found in 2 minutes. No pairing was attempted.");
        } catch (Exception e) { finish("reverse_start_failed", "Discovery could not start: " + e.getClass().getSimpleName()); }
    }
    private void subscribe() {
        if (activity.checkSelfPermission(android.Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            finish("reverse_permission_missing", "Nearby devices access was removed."); return;
        }
        try {
            AwarePairingConfig pairing = new AwarePairingConfig.Builder().setPairingSetupEnabled(true)
                .setPairingCacheEnabled(true).setPairingVerificationEnabled(true)
                .setBootstrappingMethods(AwarePairingConfig.PAIRING_BOOTSTRAPPING_PIN_CODE_KEYPAD).build();
            aware.subscribe(new SubscribeConfig.Builder().setServiceName(PairingProbe.SERVICE)
                .setSubscribeType(SubscribeConfig.SUBSCRIBE_TYPE_ACTIVE).setPairingConfig(pairing).build(), new DiscoverySessionCallback() {
                @Override public void onSubscribeStarted(SubscribeDiscoverySession session) {
                    if (closed) { session.close(); return; } subscription = session;
                    event("reverse_subscribed", "Searching for the iPhone…\n\nKeep Make iPhone discoverable open on the iPhone.\nWaiting up to 2 minutes, then we will request a pairing code.");
                }
                @Override public void onServiceDiscovered(ServiceDiscoveryInfo info) { discovered(info.getPeerHandle(), info.getPairingConfig()); }
                @Override public void onServiceDiscovered(PeerHandle peer, byte[] data, List<byte[]> filters) { /* API 34+ supplies pairing capabilities through ServiceDiscoveryInfo. */ }
                @Override public void onBootstrappingSucceeded(PeerHandle peer, int method) {
                    if (closed || !peer.equals(selectedPeer) || !phase.equals("bootstrap")) return;
                    if (method != AwarePairingConfig.PAIRING_BOOTSTRAPPING_PIN_CODE_DISPLAY && method != AwarePairingConfig.PAIRING_BOOTSTRAPPING_PIN_CODE_KEYPAD) {
                        finish("reverse_bootstrap_method_rejected", "The phone selected an unsupported pairing method."); return;
                    }
                    enterPin();
                }
                @Override public void onBootstrappingFailed(PeerHandle peer) {
                    if (!closed && peer.equals(selectedPeer) && phase.equals("bootstrap")) finish("reverse_bootstrap_failed", "The phones could find each other, but could not start code pairing. No code was submitted.");
                }
                @Override public void onPairingSetupSucceeded(PeerHandle peer, String alias) {
                    if (closed || !peer.equals(selectedPeer) || !phase.equals("pairing")) return;
                    phase = "paired";
                    event("reverse_pairing_succeeded", "Android reports pairing succeeded ✓\n\nCheck that the iPhone also finishes pairing. This does not yet prove saved pairing on both phones or message transfer.\n\nKeeping the session open briefly to let system pairing finish.");
                    main.postDelayed(() -> { if (!closed && phase.equals("paired")) finish("reverse_pairing_observation_complete", "Android pairing succeeded ✓\n\nDid the iPhone also finish? No message transfer has been tested yet."); }, 10_000);
                }
                @Override public void onPairingSetupFailed(PeerHandle peer) {
                    if (!closed && peer.equals(selectedPeer) && phase.equals("pairing")) finish("reverse_pairing_failed", "Native pairing failed. The code may have been rejected or the phones may have a compatibility problem. No message was sent.");
                }
                @Override public void onSessionConfigFailed() { finish("reverse_subscribe_failed", "Android rejected the discovery configuration."); }
                @Override public void onSessionTerminated() { if (!closed) finish("reverse_session_terminated", "Discovery stopped before finding the service."); }
            }, main);
        } catch (Exception e) { finish("reverse_subscribe_failed", "Discovery could not start: " + e.getClass().getSimpleName()); }
    }
    private void discovered(PeerHandle peer, AwarePairingConfig config) {
        if (closed || found || subscription == null) return; found = true; selectedPeer = peer;
        event("reverse_service_found", "Test service found. Preparing native pairing.");
        if (config == null || !config.isPairingSetupEnabled() ||
                (config.getBootstrappingMethods() & AwarePairingConfig.PAIRING_BOOTSTRAPPING_PIN_CODE_DISPLAY) == 0) {
            finish("reverse_pin_pairing_unavailable", "Service found, but it is not advertising PIN-display pairing. Keep the iPhone pairing screen open and start a fresh test."); return;
        }
        phase = "confirm";
        deadline("confirm", 30_000, "Pairing confirmation expired. Start again when both phones are ready.");
        dialog = new AlertDialog.Builder(activity).setTitle("Pair with your test iPhone?")
            .setMessage("Continue only if your iPhone is on Make iPhone discoverable. The service name alone does not verify the phone.")
            .setPositiveButton("Continue", (d, w) -> {
                if (closed) return; phase = "bootstrap";
                event("reverse_bootstrap_requested", "Requesting a code from the iPhone…\nApprove its system prompt if one appears.");
                deadline("bootstrap", 30_000, "The iPhone did not complete the code request. No PIN was submitted.");
                // Apple chapter 56.3 requires the initiating subscriber's keypad role.
                // The publisher advertises DISPLAY; the request is KEYPAD.
                try { subscription.initiateBootstrappingRequest(selectedPeer, AwarePairingConfig.PAIRING_BOOTSTRAPPING_PIN_CODE_KEYPAD); }
                catch (Exception e) { finish("reverse_bootstrap_failed", "Could not request code: " + e.getClass().getSimpleName()); }
            }).setNegativeButton("Cancel", (d,w) -> finish("reverse_user_cancelled", "Pairing cancelled.")).setCancelable(false).show();
    }
    private void enterPin() {
        phase = "pin";
        event("reverse_bootstrap_succeeded", "Enter the six-digit code shown on the iPhone into the Android box.");
        deadline("pin", 90_000, "Code entry expired. Start a fresh pairing attempt.");
        pinInput = new EditText(activity);
        pinInput.setHint("6-digit iPhone code");
        pinInput.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pinInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});
        pinInput.setSaveEnabled(false);
        pinInput.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO);
        dialog = new AlertDialog.Builder(activity).setTitle("Enter the iPhone code")
            .setMessage("Read the code on your iPhone and enter it here. It will not be saved or logged.")
            .setView(pinInput).setPositiveButton("Pair", null)
            .setNegativeButton("Cancel", (d,w) -> finish("reverse_user_cancelled", "Pairing cancelled.")).setCancelable(false).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            if (closed || !phase.equals("pin")) return;
            String pin = pinInput.getText().toString();
            if (!pin.matches("[0-9]{6}")) { pinInput.setError("Enter all 6 digits"); return; }
            phase = "pairing"; pinInput.setText(""); dialog.dismiss(); dialog = null;
            event("reverse_pairing_requested", "Pairing with the iPhone…\nKeep both apps open.");
            deadline("pairing", 30_000, "Pairing did not finish within 30 seconds. No message was sent.");
            try { subscription.initiatePairingRequest(selectedPeer, "LOKA-test-" + run,
                Characteristics.WIFI_AWARE_CIPHER_SUITE_NCS_PK_PASN_128, pin); }
            catch (Exception e) { finish("reverse_pairing_failed", "Pairing request failed: " + e.getClass().getSimpleName()); }
        }));
        dialog.show();
    }
    private void finish(String name, String message) { if (closed) return; close(); event(name, message); }
    @Override public void close() { if (closed) return; closed = true; if (pinInput != null) pinInput.setText(""); if (dialog != null) { dialog.dismiss(); dialog = null; } if (subscription != null) subscription.close(); if (aware != null) aware.close(); }
}
