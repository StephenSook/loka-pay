# EXP-001 — Direct discovery

Goal: find and pair two phones with mobile data off and Internet uplinks unavailable. Keep Bluetooth enabled for this baseline. Wi-Fi radio state is a separate observation; local Wi-Fi experiments must keep that radio enabled without Internet upstream.

1. Record models, Android versions, permissions, enabled radios, and environment.
2. Enable Bluetooth. On Android 8–11, grant fine location and enable system location services.
3. Start both labs. Make B visible for 120 seconds; discover from A.
4. Record time to discover, name/address, RSSI when present, and pairing time.
5. Allow B on A and A on B; connect from A only. Record time to connected state.
6. Stop and restart each lab, repeating five times; export diagnostics.

Pass: discovery, pairing, and connection work without Internet. Failure cases (denied permission, Bluetooth off, visibility timeout) should surface in diagnostics. Results: **not run on physical devices**. Use RESULT-TEMPLATE.md.
