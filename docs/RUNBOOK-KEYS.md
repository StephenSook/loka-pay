# Server keys and VPS runbook (task 1.0)

Every private key below was generated on the machine that uses it and never left it, except inside an encrypted backup. Public halves are in `config/pins.json`. Nothing here moves real money: devnet only.

## Host

- Vultr Cloud Compute, region Chicago (`ORD`), outside the Atlanta wind warning (PLAN.md D5). Ubuntu 26.04 LTS, 1 GB RAM.
- `api.zerobars.us` A record points at `64.177.8.201` (Porkbun DNS, set by Stephen).
- Caddy terminates HTTPS (Let's Encrypt) and proxies to `127.0.0.1:3001`. The Caddyfile has no `log` directive (D16).
- Docker log driver: `json-file`, `max-size 5m`, `max-file 3`, so container logs keep at most about 15 MB per container.
- Firewall: Vultr group and `ufw` allow 22 (SSH), 80 and 443. The API port (3001) is bound to `127.0.0.1` only.
- SSH: key login works for root. Password login and root password login are still enabled in `sshd_config` (open item: turn both off).

## Keys on the VPS

All in `/etc/loka-pay/keys/`, directory mode `700`, files mode `600`, owned by root. The API container mounts this directory read-only at `/run/keys`.

| File | What it is | Public half |
|---|---|---|
| `server-ed25519.pem` | Ed25519 (PKCS#8). Signs ALLOW, MERCH and CONF | `serverEd25519PublicKey` (raw 32 bytes, hex) |
| `server-rsa.pem` | RSA-3072, e = 65537. LOKA settlement node identity | `settlementNodeFingerprint` (SHA-256 of the SubjectPublicKeyInfo DER, hex) |
| `fee-payer-demo.json` | Solana keypair. Fee payer for team registration and note settlement | `feePayers.demo` |
| `fee-payer-public.json` | Solana keypair. Fee payer for public registration | `feePayers.public` |
| `funding-table-demo.json` | Solana keypair. Funds team allowances | `wallets.tableDemo` |
| `funding-public-onboarding.json` | Solana keypair. Funds public allowances | `wallets.publicOnboarding` |
| `funding-send.json` | Solana keypair. `/send` remittances | `wallets.send` |
| `funding-canary.json` | Solana keypair. Canary traffic | `wallets.canary` |

The program upgrade authority lives on Pravin's machine, not here (D14).

Check that a pin matches its key, on the VPS, without printing a secret:

```sh
cd /etc/loka-pay/keys
openssl pkey -in server-ed25519.pem -pubout -outform DER | tail -c 32 | od -An -v -tx1 | tr -d ' \n'
openssl pkey -in server-rsa.pem -pubout -outform DER | sha256sum
solana-keygen pubkey fee-payer-demo.json
```

The API also refuses to start if the Ed25519 key or any registration wallet does not match `config/pins.json`.

## Backups

- Encrypted with `gpg --symmetric --cipher-algo AES256` over a tar of `/etc/loka-pay/keys`.
- `keys-20261010.tar.gpg` holds all ten files above (it supersedes `wallets-20261009.tar.gpg`, which holds only the six wallets).
- Copies: `/root/loka-pay-backups/` on the VPS and Jordan's laptop, checksums matched after copy. Restore was tested with `gpg --decrypt | tar --compare`, exit code 0.
- The passphrase belongs in the Apple Passwords shared group "OWLS keys". Open item: not yet confirmed saved there, and the archive has no team-accessible copy yet.
- The archive and the passphrase are never stored together, and neither goes in Discord or this repository.

## Restore onto a new VPS

```sh
umask 077
mkdir -p /etc/loka-pay
gpg --pinentry-mode loopback --decrypt keys-20261010.tar.gpg | tar -C /etc/loka-pay -xf -
chmod 700 /etc/loka-pay/keys
```

Then run the pin checks above and redeploy the API container.

## Rotation

A new Ed25519 key invalidates every issued ALLOW, MERCH and CONF for clients that pin the old key. Rotate only if the key leaks: generate on the VPS, update `config/pins.json` in a PR, rebuild and distribute iOS and Android, rebuild web, redeploy, then take a new encrypted backup.
