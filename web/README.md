# LOKA Pay website (`web/`)

Next.js (App Router, TypeScript) with Tailwind CSS, managed with pnpm. It will serve https://zerobars.us.

Pages today:

| Path | What it shows |
|---|---|
| `/` | What LOKA Pay is, the sandbox chip, the build status, the judge door button and links to every page |
| `/judge` | The judge door: a numbered three-minute itinerary, the program's facts read live from devnet, the TestFlight status and each workflow's result on main, read from GitHub's API by the server |
| `/live` | The program's transactions, read by the browser straight from devnet (`getSignaturesForAddress`, `getTransaction`, then a `logsSubscribe` WebSocket). It keeps the newest 100 rows, and after a reconnect it reads the history again and retries rows whose details it had given up on. A transaction answer it cannot read marks only its own row "Details unavailable". The socket also carries a `slotSubscribe` heartbeat, so with nothing arriving for 10 s the connection chip says "No update for N s" instead of Live, and Live again when traffic resumes. `/live?kiosk=1` uses large type |
| `/verify` | Checks a payment receipt in the visitor's browser (PAYMENT-V1 section 4.9): from a `#r=<base64url>` link or pasted text, plus a button that loads the published test receipt |
| `/proof` | Claims, each Live only from a current read with its evidence linked and the read's time and age shown (the verifier is Available, a page to run yourself), proof of reserves from the program's accounts at one slot, and "Built this weekend" from GitHub's compare API |
| `/trust` | The threat model in plain words: what the program checks, what the protocol does not promise, custody, and the upgrade authority read from chain |
| `/privacy` | The privacy policy. Also the App Store Connect privacy policy URL for the TestFlight build |

Other pages arrive with the tasks that build them (see `PLAN.md`). Claims follow the code: no page describes a feature that is not built and tested.

## Chain and GitHub reads (`/judge`, `/live`, `/proof`, `/trust`)

- `lib/pins.ts` bundles every public field of `config/pins.json` with a static import and checks each address (32 bytes of base58, cluster `devnet`). A missing or malformed file fails `next build`. (`lib/deployment.ts` stays as it is for `/verify`, which needs the server key.)
- `lib/solana.ts` is a small JSON-RPC client (8 s timeout, one retry on a timeout, network error or 5xx; HTTP 429 is reported, not retried). Server reads (`lib/server-rpc.ts`) make no retries and share one 10 s limit across every call of a read, so a hanging node gives the page its honest failure within that limit instead of holding it until the host's function timeout. `NEXT_PUBLIC_SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_WS_URL` name the endpoints the browser uses on `/live`; they are inlined into every visitor's page, and a provider can carry its API key in the path as well as the query, so each accepts only an allowlist of public endpoints that need no key (`https://api.devnet.solana.com` and its `wss://` twin) and any other URL fails the build with a `PublicEndpointError` that names the variable, never its value. `SOLANA_RPC_URL` (`lib/server-rpc.ts`) is the endpoint for the server reads and is never sent to a browser, so a keyed provider URL goes there. `/privacy` names the hosts this build actually uses. All of them are listed in `.env.example`.
- The e2e test seam (`lib/test-upstream.ts`, server only): `GITHUB_API_URL` may replace `https://api.github.com` only with a local endpoint, and `SOLANA_RPC_URL` may name a local endpoint, only while `LOKA_E2E_UPSTREAM=1` is set; a deployed production build (`NODE_ENV=production` with `VERCEL` set) refuses both with an error naming the variable, so a stand-in's answers never count as devnet or GitHub evidence on the real site. `SOLANA_RPC_URL` still accepts any real provider URL, keyed or not. A real `GITHUB_TOKEN` goes only to `https://api.github.com` itself, never to another host or over http; in test mode the only token ever sent is the e2e stand-in's test token, and only to the stand-in.
- `GITHUB_TOKEN` (optional, server only, `lib/github.ts`): when set, the server's GitHub reads (each workflow's result on main for `/judge` and `/proof`, and the commit count) send it as `Authorization: Bearer`, so they run under the token's limit instead of GitHub's 60 requests an hour per IP, which shared hosting addresses can use up. A fine-grained token with read-only access to public repositories is enough. It has no `NEXT_PUBLIC` prefix, is read only by `lib/github.ts`, is never logged or shown, and `unit/server-only.test.ts` fails if a client module can reach the modules that read it.
- `lib/vault.ts` decodes the program's accounts (`programs/loka_vault/src/state.rs`), events, `open_allowance` arguments, the upgradeable loader's accounts and SPL token accounts. `lib/logs.ts` reads log lines into instruction names, event amounts and Anchor's named errors, attributing each line to the program on top of the call stack.
- `/judge`, `/proof` and `/trust` render per request and read on the server through `lib/chain.ts` and `lib/github.ts`. Results are cached with the time they were read (`lib/cached-read.ts`, `unstable_cache`): 30 seconds for devnet, 5 minutes for GitHub, and an entry older than that is read again. A read made past the cache is kept in the server process with its own time, so the next page views use it instead of each reading again. Every value is shown with its time and its age when the page rendered; a page re-stamps all of its reads at one render time after the slowest has arrived (`lib/read-state.ts`). A read is current when it is at most 10 s old for devnet or 60 s for GitHub, with no newer read that failed; only a current read makes a claim Live on `/proof` (which asks for one, reusing a kept read under 7 s or 45 s old), and `/trust` says upgradeability in the present only from one. A failed read is never cached and never replaced by a typed-in value; the page says what failed and when. When an earlier good read exists, it is shown marked stale with the failed read's reason and time ("Not current. Last good read ..."), the read-backed claims say Not checked, and the commit count is not shown at all (PLAN.md 3.60: never a stale count), only the time of the last good read.
- Every upstream read goes through one ReadGate per server process (`lib/read-state.ts`): page views that want a running read share it, each read has a budget (3 per 10 s for devnet, 3 per minute for GitHub), and a rate-limited answer pauses that read (10 s, 60 s) instead of being retried. A read the gate does not make leaves the last good read on the page, with its age and the reason.
- Public devnet allows 10 `getProgramAccounts` and 10 `getTransaction` calls per 10 seconds per IP, refuses `getProgramAccounts` inside a JSON-RPC batch, and refuses a batch that repeats `getAccountInfo` or `getTokenAccountBalance`. So the program's accounts are listed with one unfiltered `getProgramAccounts` call returning each account's 8-byte discriminator, fixed accounts are read with `getMultipleAccounts`, and `/live` reads every transaction's details through one queue: one batch request at a time, newest first, at most 8 calls per 11 s, and nothing for 11 s after a rate-limited answer.
- Proof of reserves lists the program's accounts, reads the vault token account and every allowance and merchant in one `getMultipleAccounts` call (one slot), then lists the accounts again at that slot to confirm none was missed.

## `/verify`, the protocol library and `config/pins.json`

- `@lokapay/protocol` is `protocol/lib`, linked with `link:../protocol/lib`. A linked package's own dependencies are not installed by this project's install, so the `postinstall` script runs `pnpm install --frozen-lockfile --prod` in `protocol/lib`. `next.config.ts` sets `turbopack.root` to the repository root, because Turbopack resolves nothing outside its root and `/verify` also imports `protocol/vectors/payment-v1.json`.
- The status shown always comes from the signed confirmation, after `verifyReceipt` passes. On a failure the page names the error code and the check it came from.
- `lib/deployment.ts` reads `config/pins.json` at build time. While the file is missing it exports `null`, and receipts other than the test vectors get the notice that the server key is not published. When the file exists, the page reads these fields (others are ignored), and a present but unreadable file fails the build:

  ```json
  {
    "cluster": "devnet",
    "programId": "<base58, 32 bytes>",
    "mint": "<base58, 32 bytes>",
    "serverEd25519PublicKey": "<64 hex characters, or base58 of 32 bytes>"
  }
  ```

- A receipt whose note carries the vector-only program id is checked against the test deployment and test server key in `protocol/vectors/payment-v1.json` and labelled as a test vector made from public test keys.

## Commands

Node 22 and pnpm 12.3.4 (the version in `packageManager`; Corepack or `pnpm self-update` gets it).

```sh
cd web
pnpm install --frozen-lockfile
pnpm dev                 # http://localhost:3000
pnpm lint                # ESLint (eslint-config-next)
pnpm typecheck           # next typegen, then tsc --noEmit
pnpm build               # production build
pnpm test:unit           # decoder and parser unit tests (unit/), no browser, no server

# Playwright: builds, serves on http://127.0.0.1:3100 and :3101, runs chromium and webkit
pnpm exec playwright install chromium webkit   # once
pnpm test:e2e
```

The e2e tests read the server pages against known values: `e2e/global-setup.ts` starts a local stand-in for devnet's JSON-RPC and GitHub's API (`e2e/fixtures/upstream.ts`, port 3190, every account and answer a labelled test fixture), and `playwright.config.ts` starts the build twice, both in the test mode (`LOKA_E2E_UPSTREAM=1`): on 3100 with `SOLANA_RPC_URL`, `GITHUB_API_URL` and the test `GITHUB_TOKEN` pointing at the stand-in, so the success path (facts, Live claims, exact reserves, the commit count, each workflow's result) is asserted every run; and on 3101 with both endpoints at a port where nothing listens, so the failure path is asserted every run too. Cache keys include a digest of the endpoint, so the two servers never share a cached read. `/live` still reads real devnet from the browser.

CI (`.github/workflows/web.yml`) runs the same steps, each on its own exit code. With `CI` set, Playwright skips its own build because the workflow builds in the step before. The unit tests run there too: `playwright.config.ts` includes them as its `unit` project, which needs no browser.

## Telemetry and tracking

- Next.js telemetry is off in CI (`NEXT_TELEMETRY_DISABLED=1` in the workflow). Locally, run `pnpm exec next telemetry disable` once, or export `NEXT_TELEMETRY_DISABLED=1`.
- No analytics, telemetry or error-tracking packages, and no cookies. `e2e/judge.spec.ts` fails if `/` or `/privacy` sets a cookie or requests anything from another origin. `e2e/judge-door.spec.ts` checks the same for `/judge`, `/proof` and `/trust` (the workflow results on `/judge` are read by the server, not loaded as images from github.com), and leaves `/live` free to reach devnet (the privacy page says so).
- Fonts (Bricolage Grotesque, Figtree) are committed in `app/fonts` and loaded with `next/font/local`, so neither a build nor a page load contacts another site for them.

## Design tokens

All tokens live in `app/globals.css` (CSS variables plus the Tailwind `@theme`), so every page reuses them:

- Paper `#FBF8F3` background, ink `#102A43` text, borders and hard shadows. Dark mode (from `prefers-color-scheme`) flips them to `#14163A` and `#FFF8EC`, never pure black.
- Display: Bricolage Grotesque 800, letter-spacing -0.03em (every `h1` to `h3`). Body: Figtree 500.
- 2 to 3 px ink borders, hard offset shadows with no blur (`shadow-hard` 4 px, `shadow-hard-lg` 6 px), capsule chips, an ink pill call to action.
- Money states, each shown with a word AND an icon (`components/chips.tsx`, `StateChip`): Pending `#FFB020`, Received `#9FE3E0`, Paid `#1FA35B` (white text only on `#0F7A40`), Warning fill `#FFD9D7` with border `#B4232A`, Failed `#E5484D` (white text only on `#B4232A`).
- Grid children get `min-w-0` (a base rule in `globals.css` and in the markup), so long content cannot widen the page.
