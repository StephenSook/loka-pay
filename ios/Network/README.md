# iOS Network

`BleLink.swift` implements foreground Core Bluetooth central discovery, connection, two-way public probes and bounded packet writes/indications behind `LocalPacketTransport`. `BleFraming.swift` assembles bounded frames. Android uses the same [BLE contract](../../protocol/BLE-LINK-V1.md).

`ChatStore` owns this connection for the app lifetime and feeds frames to the authenticated packet engine; leaving Local connection for Chats does not disconnect. Explicit contact trust is independent of radio connection. Automatic authenticated discovery, background reliability and physical radio/relay success remain separate gates. See [scope and physical test steps](../README.md).
