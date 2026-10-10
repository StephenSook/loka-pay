# Power, performance and transport comparison

**NM = not measured on this device set in this investigation.** No marketing PHY speed or simulator throughput is substituted for physical application measurements.

| Architecture | Discovery | Bandwidth | Latency | Power | Cross-platform | Background | Multi-peer | Internet required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BLE | Advertisement/GATT | NM | NM | NM | Existing LOKA adapters; no controlled baseline in this run | OS-limited; NM | App caps, actual stable count NM | No |
| Wi-Fi Direct | P2P group discovery | NM | NM | NM | Android API; no equivalent LOKA iOS adapter | NM | Group topology != arbitrary mesh; NM | No |
| Wi-Fi Aware | Native publish/subscribe and pairing | NM | NM | NM | Candidate; capability gates only | Runtime dependent; NM | Samsung reports 8 paths; usable count NM | No by API design; offline run pending |
| LAN | Bonjour / local sockets | NM | NM | NM | Existing LOKA Android server/iOS client | NM | Provider dependent; NM | No Internet, but requires a shared local network |
| Nearby-style architecture | SDK radio orchestration | NM | NM | NM | Separate Android/Swift SDK evaluation required | NM | Strategy/device dependent; NM | API supports offline |
| Current LOKA approach | Concurrent independent providers | NM | NM | NM | BLE/LAN implementations; Aware mismatch | Service/BLE runtime constraints; NM | Android flood, iOS no onward relay | No local-path backend prerequisite |

Wi-Fi Direct groups and permissions are documented by [Android](https://developer.android.com/develop/connectivity/wifi/wifi-direct). Nearby Connections abstracts Bluetooth/BLE/Wi-Fi and requires acceptance of connection requests; it is neither an automatic multi-hop routing layer nor proof of identical radio behavior on all platforms. [Google overview](https://developers.google.com/nearby/connections/overview)

## Reproducible measurement design

Use three randomized modes: current BLE baseline; native Aware discovery+transfer; BLE-assisted discovery followed by authenticated Aware upgrade. The third mode is not yet implemented in the isolated probe. Separate cold discovery/native pairing from warm reconnect; compare tiny messages as well as bulk traffic. Include failures and OS prompts rather than filtering them out.

For power tests, disconnect charging after deployment. USB/Wi-Fi debugging changes load and potentially connectivity; record it and repeat without debugging. Begin at comparable charge/temperature, fix screen brightness and ambient conditions, measure idle baseline and a fixed-work transfer workload for at least one hour with repeated trials. Record charge/energy counters if available; battery percentage alone is coarse. Report baseline-subtracted energy per useful delivered MB and idle battery percentage points/hour, with confidence limits.

CPU: process CPU time / wall time with stated core normalization. Memory: peak resident footprint with sampling interval. Thermal: native state changes plus device conditions, not invented temperature. Throughput: useful bytes / elapsed monotonic time, alongside setup and hashing costs. Report p50/p95/p99 and sample counts for setup, reconnect and round-trip transactions; unavailable metrics remain null.

The probe provides transfer durations and hashes only. `summarize.py` leaves RF loss, one-way latency and offline confirmation unknown. Success percentages require a declared attempt denominator. Successive application round-trip differences are a variability proxy, not RTP interarrival jitter. Failed TCP transfers are not a measurement of radio packet loss.

Distance: measure physical separation/obstacles, test sustained bidirectional delivery at each step, record failure and return-to-range recovery. No claimed meters until measured. Do not derive distance or resolution from RSSI alone.
