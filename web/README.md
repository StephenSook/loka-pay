# LOKA Pay website (`web/`)

Next.js (App Router, TypeScript) with Tailwind CSS, managed with pnpm. It will serve https://zerobars.us.

Pages today:

| Path | What it shows |
|---|---|
| `/` | What LOKA Pay is, the sandbox chip, the build status, links to the source and to `/privacy` |
| `/privacy` | The privacy policy. Also the App Store Connect privacy policy URL for the TestFlight build |
| `/verify` | Checks a payment receipt in the visitor's browser (PAYMENT-V1 section 4.9): from a `#r=<base64url>` link or pasted text, plus a button that loads the published test receipt |

Other pages arrive with the tasks that build them (see `PLAN.md`). Claims follow the code: no page describes a feature that is not built and tested.

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

# Playwright: builds, serves on http://127.0.0.1:3100, runs chromium and webkit
pnpm exec playwright install chromium webkit   # once
pnpm test:e2e
```

CI (`.github/workflows/web.yml`) runs the same steps, each on its own exit code. With `CI` set, Playwright skips its own build because the workflow builds in the step before.

## Telemetry and tracking

- Next.js telemetry is off in CI (`NEXT_TELEMETRY_DISABLED=1` in the workflow). Locally, run `pnpm exec next telemetry disable` once, or export `NEXT_TELEMETRY_DISABLED=1`.
- No analytics, telemetry or error-tracking packages, and no cookies. `e2e/judge.spec.ts` fails if a page sets a cookie or requests anything from another origin.
- Fonts (Bricolage Grotesque, Figtree) come through `next/font/google`, which downloads them at build time and serves them from this site. A page load never requests a font from Google.

## Design tokens

All tokens live in `app/globals.css` (CSS variables plus the Tailwind `@theme`), so every page reuses them:

- Paper `#FBF8F3` background, ink `#102A43` text, borders and hard shadows. Dark mode (from `prefers-color-scheme`) flips them to `#14163A` and `#FFF8EC`, never pure black.
- Display: Bricolage Grotesque 800, letter-spacing -0.03em (every `h1` to `h3`). Body: Figtree 500.
- 2 to 3 px ink borders, hard offset shadows with no blur (`shadow-hard` 4 px, `shadow-hard-lg` 6 px), capsule chips, an ink pill call to action.
- Money states, each shown with a word AND an icon (`components/chips.tsx`, `StateChip`): Pending `#FFB020`, Received `#9FE3E0`, Paid `#1FA35B` (white text only on `#0F7A40`), Warning fill `#FFD9D7` with border `#B4232A`, Failed `#E5484D` (white text only on `#B4232A`).
- Grid children get `min-w-0` (a base rule in `globals.css` and in the markup), so long content cannot widen the page.
