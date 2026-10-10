# LOKA Cloud backend — deferred

Future stack: **TypeScript, Node.js, NestJS, PostgreSQL**, starting as a modular monolith. Introduce Redis only for a demonstrated requirement; do not split into microservices prematurely.

Responsibilities: accounts, authentication, LOKA Numbers, recovery, linked phones, devices, communities, membership, credential issuance, key directory, revocation, verification, and backup metadata. Immutable internal account IDs remain independent of phone numbers and device IDs.

The backend is the control plane. Ordinary LOKA Local delivery must continue without an online backend. Go and Gateway have separate responsibilities for Internet communication and external backhaul; local Wi-Fi does not imply Internet.

Account recovery and encrypted-history recovery are separate security domains. SMS alone must not unlock history; backups are optional and encrypted on device. See [system boundaries](../docs/ARCHITECTURE.md) and [recovery/backup requirements](../docs/RECOVERY-AND-BACKUP.md).

No server, database, provider integration, or cloud deployment exists in this initial milestone.
