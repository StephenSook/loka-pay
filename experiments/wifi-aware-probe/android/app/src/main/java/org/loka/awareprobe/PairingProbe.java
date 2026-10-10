package org.loka.awareprobe;

import android.app.Activity;
import android.app.AlertDialog;
import android.net.*;
import android.net.wifi.aware.*;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.function.Consumer;

/** Experimental NAN-paired responder. Synthetic bytes only; never imports LOKA identities. */
final class PairingProbe implements AutoCloseable {
    static final String SERVICE = "_loka-probe._tcp";
    private final Activity activity;
    private final Consumer<String> display;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final String run = UUID.randomUUID().toString();
    private final String pin = String.format(Locale.ROOT, "%06d", new SecureRandom().nextInt(1_000_000));
    private final long started = SystemClock.elapsedRealtime();
    private WifiAwareSession aware;
    private PublishDiscoverySession publisher;
    private ConnectivityManager.NetworkCallback callback;
    private ServerSocket server;
    private Socket socket;
    private volatile boolean closed;
    private boolean paired;
    private String lastEvent = "";
    boolean isActive() { return !closed; }
    PairingProbe(Activity activity, Consumer<String> display) { this.activity = activity; this.display = display; }
    private synchronized void event(String name, String detail) {
        try {
            JSONObject value = new JSONObject().put("schema", 1).put("run", run).put("event", name)
                .put("elapsed_ms", SystemClock.elapsedRealtime() - started).put("detail", detail);
            try (FileOutputStream out = activity.openFileOutput("events.jsonl", Activity.MODE_APPEND)) {
                out.write((value + "\n").getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) { }
        if (!name.equals("stopped")) lastEvent = name;
        String screen;
        if (closed) {
            screen = lastEvent.equals("pairing_timeout")
                ? "Pairing timed out\n\nNo pairing completed. The old code has expired.\n\nTap Start pairing test once to get a new code, then use Select Android probe on the iPhone. If no phone appears there, report that result."
                : "Test stopped\n\nThe code is no longer active.\n\nLast step: " + lastEvent + "\nTap Start pairing test to try again.";
        } else if (name.equals("published") || name.equals("start")) {
            screen = "Continue on your iPhone\n\nOpen LOKA Aware Probe → Select Android probe → LOKA test phone.\n\nWhen the iPhone’s system screen asks, enter this code there:\n\n" + pin
                + "\n\nDo not enter it on Android. Keep this screen open.\n\nIf the iPhone shows no phone or no code box, pairing has not reached that step.\n\nThis code stays active for up to 2 minutes. Do not restart the test while pairing.";
        } else {
            screen = "Pairing test\n\n" + name.replace('_', ' ') + "\n" + detail
                + (paired ? "" : "\n\nCode for the iPhone: " + pin);
        }
        String message = screen;
        main.post(() -> display.accept(message));
    }

    void start() {
        event("start", "Android publisher; discovery trial=unsolicited-v1; pairing window: 120 seconds.");
        try {
            WifiAwareManager manager = activity.getSystemService(WifiAwareManager.class);
            if (manager == null || !manager.isAvailable() || !manager.getCharacteristics().isAwarePairingSupported()) {
                event("unsupported", "Native Aware pairing is unavailable."); close(); return;
            }
            manager.attach(new AttachCallback() {
                @Override public void onAttached(WifiAwareSession session) {
                    if (closed) { session.close(); return; } aware = session; publish();
                }
                @Override public void onAttachFailed() { event("attach_failed", "No native session"); close(); }
            }, main);
            main.postDelayed(() -> { if (!paired && !closed) { event("pairing_timeout", "No completed pairing within 120 seconds"); close(); } }, 120_000);
        } catch (Exception e) { event("start_failed", e.getClass().getSimpleName()); close(); }
    }
    private PublishConfig config(boolean pairing) {
        AwarePairingConfig pairingConfig = new AwarePairingConfig.Builder().setPairingSetupEnabled(pairing)
            .setPairingVerificationEnabled(true).setPairingCacheEnabled(true)
            .setBootstrappingMethods(AwarePairingConfig.PAIRING_BOOTSTRAPPING_PIN_CODE_DISPLAY).build();
        PublishConfig.Builder b = new PublishConfig.Builder().setServiceName(SERVICE)
            // Controlled discovery trial: announce during the bounded pairing window.
            // Return to solicited publication after pairing; no always-on advertising change.
            .setPublishType(pairing ? PublishConfig.PUBLISH_TYPE_UNSOLICITED : PublishConfig.PUBLISH_TYPE_SOLICITED)
            .setPairingConfig(pairingConfig);
        if (pairing) {
            ByteArrayOutputStream txt = new ByteArrayOutputStream();
            for (String record : new String[]{"vendorName=LOKA", "modelName=Android probe", "pairingName=LOKA test phone"}) {
                byte[] bytes = record.getBytes(StandardCharsets.UTF_8); txt.write(bytes.length); txt.write(bytes, 0, bytes.length);
            }
            b.setServiceSpecificInfo(txt.toByteArray());
        }
        return b.build();
    }
    private void publish() {
        if (activity.checkSelfPermission(android.Manifest.permission.NEARBY_WIFI_DEVICES) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            event("permission_missing", "Enable Nearby devices for this isolated probe"); close(); return;
        }
        try { aware.publish(config(true), new DiscoverySessionCallback() {
            @Override public void onPublishStarted(PublishDiscoverySession session) {
                if (closed) { session.close(); return; } publisher = session; event("published", SERVICE + "; discovery trial=unsolicited-v1");
            }
            @Override public void onSessionConfigFailed() { event("publish_failed", "Native publish rejected"); close(); }
            @Override public void onSessionTerminated() { if (!closed) { event("session_terminated", "Native session ended"); close(); } }
            @Override public void onBootstrappingSucceeded(PeerHandle peer, int method) { event("bootstrap_succeeded", "method=" + method); }
            @Override public void onBootstrappingFailed(PeerHandle peer) { event("bootstrap_failed", "No successful bootstrap"); }
            @Override public void onPairingSetupRequestReceived(PeerHandle peer, int requestId) {
                if (closed || paired) { if (publisher != null) publisher.rejectPairingRequest(requestId, peer); return; }
                event("pairing_requested", "Approve only the iPhone test you started.");
                new AlertDialog.Builder(activity).setTitle("Pair with the test iPhone?")
                    .setMessage("Approve only if you just selected LOKA test phone on your iPhone. Enter the displayed PIN there.")
                    .setPositiveButton("Pair", (d, w) -> { if (!closed && publisher != null) publisher.acceptPairingRequest(requestId, peer, "LOKA-test-" + run,
                        Characteristics.WIFI_AWARE_CIPHER_SUITE_NCS_PK_PASN_128, pin); })
                    .setNegativeButton("Reject", (d, w) -> { if (!closed && publisher != null) publisher.rejectPairingRequest(requestId, peer); })
                    .setCancelable(false).show();
            }
            @Override public void onPairingSetupFailed(PeerHandle peer) { event("pairing_failed", "Native pairing failed"); }
            @Override public void onPairingSetupSucceeded(PeerHandle peer, String alias) { paired(peer, "pairing_succeeded"); }
            @Override public void onPairingVerificationSucceed(PeerHandle peer, String alias) { paired(peer, "verification_succeeded"); }
            @Override public void onPairingVerificationFailed(PeerHandle peer) { event("verification_failed", "Cached native pairing failed"); }
        }, main); } catch (Exception e) { event("publish_exception", e.getClass().getSimpleName()); close(); }
    }
    private void paired(PeerHandle peer, String eventName) {
        if (closed || paired) return; paired = true; event(eventName, "Native callback; data path not yet proven");
        try {
            publisher.updatePublish(config(false));
            server = new ServerSocket(0); server.setSoTimeout(30_000);
            // Pairing establishes NAN security. No exchanged application PSK or invented cryptography.
            // Whether this SDK's network request uses the paired security context is a test gate.
            WifiAwareNetworkSpecifier spec = new WifiAwareNetworkSpecifier.Builder(publisher, peer)
                .setPort(server.getLocalPort()).setTransportProtocol(6).build();
            callback = new ConnectivityManager.NetworkCallback() {
                private boolean accepting;
                @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                    if (closed || accepting || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI_AWARE) ||
                        !(caps.getTransportInfo() instanceof WifiAwareNetworkInfo)) return;
                    Inet6Address expected = ((WifiAwareNetworkInfo)caps.getTransportInfo()).getPeerIpv6Addr();
                    if (expected == null) return; accepting = true; event("aware_network", "Native Aware network; accepting paired peer only");
                    new Thread(() -> serve(expected), "aware-probe-io").start();
                }
                @Override public void onUnavailable() { event("network_unavailable", "Data path request did not complete"); close(); }
                @Override public void onLost(Network n) { event("network_lost", "Aware path lost"); close(); }
            };
            activity.getSystemService(ConnectivityManager.class).requestNetwork(new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI_AWARE).setNetworkSpecifier(spec).build(), callback, 30_000);
        } catch (Exception e) { event("data_path_exception", e.getClass().getSimpleName()); close(); }
    }
    private void serve(Inet6Address expected) {
        try {
            socket = server.accept(); socket.setSoTimeout(30_000);
            if (!Arrays.equals(socket.getInetAddress().getAddress(), expected.getAddress())) throw new IOException("Wrong interface peer");
            socket.setTcpNoDelay(true);
            DataInputStream in = new DataInputStream(socket.getInputStream()); OutputStream out = socket.getOutputStream();
            if (in.readInt() != 0x4c415031) throw new IOException("Magic");
            new DataOutputStream(out).writeInt(0x4c415031); out.flush(); event("tcp_connected", "LAP1 synthetic benchmark ready");
            byte[] buffer = new byte[16_384]; new SecureRandom().nextBytes(buffer);
            for (int trial = 0; trial < 512 && !closed; trial++) {
                int size = in.readInt();
                if (size == 0) break;
                if (size < 1 || size > 100_000_000) throw new IOException("Size bound");
                MessageDigest digest = MessageDigest.getInstance("SHA-256"); int remaining = size;
                while (remaining > 0) { int n = in.read(buffer, 0, Math.min(remaining, buffer.length)); if (n < 0) throw new EOFException(); digest.update(buffer, 0, n); remaining -= n; }
                out.write(digest.digest()); out.flush();
                digest.reset(); remaining = size;
                while (remaining > 0) { int n = Math.min(remaining, buffer.length); out.write(buffer, 0, n); digest.update(buffer, 0, n); remaining -= n; }
                out.flush(); byte[] ack = new byte[32]; in.readFully(ack);
                if (!MessageDigest.isEqual(ack, digest.digest())) throw new IOException("Integrity");
                event("transfer_complete", "synthetic bytes each direction=" + size);
            }
        } catch (Exception e) { if (!closed) event("io_failed", e.getClass().getSimpleName()); }
        finally { close(); }
    }
    @Override public synchronized void close() {
        if (closed) return; closed = true;
        try { if (socket != null) socket.close(); } catch (IOException ignored) {}
        try { if (server != null) server.close(); } catch (IOException ignored) {}
        if (callback != null) { try { activity.getSystemService(ConnectivityManager.class).unregisterNetworkCallback(callback); } catch (Exception ignored) {} }
        if (publisher != null) publisher.close(); if (aware != null) aware.close();
        event("stopped", "Probe stopped; production LOKA unchanged");
    }
}
