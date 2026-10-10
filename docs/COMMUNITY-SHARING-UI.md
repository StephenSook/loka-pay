# Community sharing controls — October 5, 2026

The supplied community-sharing PNG is implemented in native Android and iOS onboarding, before Backup, and in Settings → Community sharing. Settings use the same editor. Defaults are an enabled **draft**, Wi-Fi on/Unlimited, and mobile off with a retained 100 MB limit. Nothing is saved until Save. Saving atomically persists all selections, including disabled sections, and advances onboarding or returns from Settings. The existing local mesh relay setting is untouched.

Bottom sheets show presets and a current-selection checkmark. Dismissal preserves the selection. Custom positive decimal MB/GB values are validated using decimal arithmetic; MB is 1,000,000 bytes and GB is 1,000,000,000 bytes. Zero, negatives, invalid input, fractional-byte limits and values beyond a signed 64-bit byte count are rejected. Only active sections constrain Save, so disabling sharing can always be saved. Re-enabling sections restores their draft selections. Sharing with neither connection enabled is invalid. The only bottom action is Save; instructions and expanding controls scroll above it, including when the keyboard is present.

## Capability boundary

Internet community relaying and usage metering are not implemented. The screen explicitly states this and does not show invented usage or connect saved consent to the local relay flag. There is no upload, backend, account enrollment, network permission request, packet change or cryptographic change in this feature. Saving preferences does **not** establish an active gateway or enforce limits on a nonexistent transport.

Before enabling the future Go/Gateway path, wire this policy into admission and scheduling, add durable per-connection counters and in-flight reservations, include uploads/downloads/receipts/retries and network overhead, use device-local calendar-month resets, and stop admission on disabled sharing or an exhausted cap. An independently enabled connection may continue under its own budget. Own-message traffic and ordinary offline local relaying must remain separate. Reconcile application-byte accounting with measured TLS/OS overhead; do not present it as exact carrier billing. These runtime requirements remain open alongside the security and physical gates in [Internet gateway requirements](INTERNET-GATEWAY-REQUIREMENTS.md).

## Software validation

Kotlin and Swift checks cover defaults, no enabled connection, custom input/overflow, disabled-section validation, mobile limits and a Swift Codable persistence round trip. Native builds, Android lint, and emulator UI review validate presentation. These checks do not demonstrate Internet relay traffic, monthly quota enforcement, or physical mesh reliability.
