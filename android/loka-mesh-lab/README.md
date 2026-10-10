# LOKA Mesh Lab

Open this directory in Android Studio. See [repository quickstart](../../README.md) for SDK/JDK requirements, build commands, key exchange, and the three-phone experiment.

- `app`: native Android UI, Keystore identity, Bluetooth transport, diagnostics.
- `core`: portable protocol, cryptography, mesh engine, node orchestration, and transport contracts with JVM integration tests.

Android composition selects the provider in `LokaApplication`. UI/ViewModel code uses generic capabilities and opaque peer handles; the provider owns radio permissions and setup dialogs.

`./gradlew :core:test :app:assembleDebug :app:lintDebug`


## 0.6.18 — receipts and background recovery

Locally generated save/read receipts can pass waiting BLE media packets without splitting a frame already being sent. Android requests foreground-service restart after system process eviction while local connection remains enabled. iOS initializes Bluetooth restoration during application launch, independent of screen appearance. Explicit Off and all existing permission/key-protection checks remain in effect.

This does not guarantee messaging after force-stop/force-quit. iPhone locked-key restrictions can delay decryption and receipts until unlock. Test Home/background separately from force-quitting. See [EXP-014](../../experiments/EXP-014-receipt-priority-background.md) for measured queue results, platform limits and the outstanding physical test.


## 0.6.20 — shared local Wi-Fi experiment

Connect the iPhone and Android to the same private IPv4 Wi-Fi LAN and allow iPhone Local Network access. Enable LOKA local connections as usual. Android advertises a local listener; iPhone discovers it automatically and both can exchange the existing encrypted messages. Bluetooth remains available in parallel. The LAN needs neither a working Internet uplink nor cellular data, but must allow Bonjour discovery and traffic between devices.

This is a testable shared-network transport, not Wi-Fi Aware, automatic hotspot setup or best-route scoring. It currently supports an iPhone client and Android server; Android↔Android Wi-Fi initiation and an iPhone Wi-Fi server remain future work. Background and force-quit limitations still apply. See EXP-015 and protocol/LOCAL-WIFI-V0.md for proof requirements and bounds.

## 0.6.22 — optional background battery setup

Settings → Background messaging (also available on onboarding's final step) shows the PowerManager optimization exemption, ActivityManager background restriction and Battery Saver state. Values refresh on return from system settings. Users can open Android's battery optimization list or LOKA app details, and Samsung users get the manufacturer's documented Never sleeping apps link with app-details fallback. No special battery-exemption permission, silent allowlisting, global Battery Saver change or automatic device setting modification is introduced. Android's Doze exemption is not evidence of Samsung's separate sleeping-app exemption, and neither overrides Force stop or proves delivery reliability.

Sources: [Android PowerManager](https://developer.android.com/reference/android/os/PowerManager), [Samsung application management](https://developer.samsung.com/mobile/app-management.html). Build/lint validate the UI code; exact system-menu behavior and background delivery still need physical testing.

## 0.6.24 — experimental Android Wi-Fi Aware

Settings → Router-free Wi-Fi shows hardware/availability and offers the optional Nearby Wi-Fi permission (fine/coarse location on older Android). Once local connections are on, compatible Android phones can publish/discover and establish a native Aware data path alongside existing transports. Unsupported/denied Aware does not block Bluetooth. Nearby labels distinguish Aware, shared Wi-Fi and Bluetooth without inventing Wi-Fi signal readings.

The connected SM_S948U1 advertises Aware support. Native two-phone delivery, background recovery and relay performance remain unproven. This Android PSK flow does not implement iPhone Aware pairing; Wi-Fi Direct is still separate work. See EXP-016 and security/WIFI-AWARE-REVIEW.md. Existing shared Wi-Fi automatic admission was also corrected: earlier policy inadvertently admitted only BLE handles.
