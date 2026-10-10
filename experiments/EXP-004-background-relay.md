# EXP-004 — Background and battery characterization

Prerequisite: repeatable foreground three-node success. This milestone is research; the current app has no foreground service or persistence.

Test screen on/off, app backgrounded, Doze, battery saver, charging, moving devices, and vendor-specific battery settings. For each condition, send a known sequence through B, record attempts/receipts, connection lifetime, recovery time, CPU method, and battery change over a fixed interval.

Force-stop/process death should lose queues and links in the current build. Record failures rather than claiming background support. Do not change system battery exemptions silently. Any future foreground service must provide visible status and user-controlled relay consent.

Pass criteria and acceptable power budget will be set using measured foreground baseline data. Results: **not run on physical devices**.
