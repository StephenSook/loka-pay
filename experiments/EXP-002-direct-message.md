# EXP-002 — Direct encrypted messaging

Prerequisite: EXP-001 passes.

1. Copy A's public key to B and B's to A. Compare full fingerprints on the originating phones before trusting.
2. Connect A–B only. Send “Hello B”, then reply “Hello A”. Confirm destination display.
3. Send UTF-8 text and test oversize rejection. Repeat 20 messages, recording attempts and receipt independently.
4. Forget A's key on B, send a fresh message, and confirm it is rejected as untrusted. Reimport and send a new message (rejected packet IDs are not replayed).
5. Export logs and record delivery latency using external timing; compare clock settings.

Pass: bidirectional text arrives, untrusted senders are rejected, no plaintext appears in exported diagnostics. Queue/write events alone are not proof of receipt. Results: **not run on physical devices**.
