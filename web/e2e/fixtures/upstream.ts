// TEST FIXTURE: a local stand-in for Solana devnet's JSON-RPC and GitHub's API, so the e2e
// tests always see the server pages' success path with known values (playwright.config.ts
// points one e2e server at it with SOLANA_RPC_URL and GITHUB_API_URL, and a second at a port
// where nothing listens, for the failure path). Every account below is built field by field
// in the layouts the pages decode; none is a real devnet account. The values the tests
// expect are written out here as literals (EXPECTED), not computed by the app.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { encodeBase58 } from "../../lib/base58";
import { ACCOUNT_DISCRIMINATORS, BPF_UPGRADEABLE_LOADER, FEATURE_PROGRAM, SECP256R1_FEATURE, TOKEN_PROGRAM } from "../../lib/vault";
import { allowanceBytes, merchantBytes, tokenAccountBytes } from "../../unit/accounts";
import { base64, concat, filled, le32, le64, padTo, pubkey } from "../../unit/bytes";
import { UPSTREAM_PORT } from "./ports";

export { E2E_GITHUB_TOKEN, UPSTREAM } from "./ports";


const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pins = JSON.parse(readFileSync(path.join(repoRoot, "config", "pins.json"), "utf8"));
const recorded = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "unit", "fixtures", "devnet-transactions.json"), "utf8"));

const PROGRAM_DATA = encodeBase58(filled(32, 0x07));
const ALLOWANCE_A = pins.wallets.canary as string;
const ALLOWANCE_B = pins.feePayers.demo as string;
const MERCHANT = pins.wallets.send as string;
const MAIN_SHA = "abcdef0123456789abcdef0123456789abcdef01";

/** What the pages must show when they read this stand-in. */
export const EXPECTED = {
  deploySlot: 509_428_340,
  programBytes: 300_000,
  vault: "9.50",
  counts: { VaultConfig: 1, VaultAuthority: 1, Allowance: 2, Merchant: 1 },
  reserves: { assets: "9.50", allowances: "4.50", bonds: "1.50", merchants: "2.50", liabilities: "8.50", difference: "1.00", verdict: "Covered" },
  commits: 3,
  authors: ["pravinireri", "StephenSook"],
  filesChanged: 3,
  /** A floor: one listed file has no line count. */
  additions: "150+",
  filesWithoutLineCount: 1,
  mainCommit: MAIN_SHA.slice(0, 7),
  ci: { ios: "success", android: "success", program: "success", server: "failure", web: "success", hygiene: "success" } as Record<string, string>,
  /** /call: the newest settled payment in the recorded history (the refused redeem above it is skipped). */
  callSignature: recorded.redeem.transaction.signatures[0] as string,
  callAmount: "0.10",
};

/** Every recorded devnet transaction, newest first: getSignaturesForAddress answers this list. */
const RECORDED_TXS = [recorded.refusedRedeem, recorded.redeem, recorded.registerMerchant, recorded.initializeVault, recorded.deploy];

/** TEST FIXTURE: the bytes the ElevenLabs stand-in answers in place of an MP3. */
export const E2E_AUDIO = Buffer.from("ID3 e2e stand-in audio, not a real mp3");

/** What the Vonage and ElevenLabs stand-ins received (GET /__seen). */
interface CallSeen {
  vonage: Array<{ authorization: string; body: unknown }>;
  speech: Array<{ apiKey: string; voice: string; outputFormat: string | null; body: unknown }>;
}

interface Account {
  owner: string;
  executable: boolean;
  data: Uint8Array;
  space?: number;
}

function accounts(): Map<string, Account> {
  const m = new Map<string, Account>();
  m.set(pins.programId, { owner: BPF_UPGRADEABLE_LOADER, executable: true, data: concat(le32(2), pubkey(PROGRAM_DATA)) });
  m.set(PROGRAM_DATA, {
    owner: BPF_UPGRADEABLE_LOADER,
    executable: false,
    data: concat(le32(3), le64(EXPECTED.deploySlot), [1], pubkey(pins.upgradeAuthority)),
    space: 45 + EXPECTED.programBytes,
  });
  m.set(pins.accounts.config, {
    owner: pins.programId,
    executable: false,
    data: padTo(concat([...ACCOUNT_DISCRIMINATORS.VaultConfig], pubkey(pins.mint), [0], [255]), 42),
  });
  m.set(pins.accounts.vault, { owner: pins.programId, executable: false, data: padTo(concat([...ACCOUNT_DISCRIMINATORS.VaultAuthority], [254]), 9) });
  m.set(pins.accounts.vaultUsdcAccount, { owner: TOKEN_PROGRAM, executable: false, data: tokenAccountBytes(pins.mint, pins.accounts.vault, BigInt(9_500_000)) });
  m.set(SECP256R1_FEATURE, { owner: FEATURE_PROGRAM, executable: false, data: concat([1], le64(380_592_000)) });
  m.set(ALLOWANCE_A, {
    owner: pins.programId,
    executable: false,
    data: allowanceBytes({ id: BigInt(1), cap: BigInt(5_000_000), redeemed: BigInt(2_500_000), bond: BigInt(1_000_000), funder: pins.wallets.tableDemo }),
  });
  m.set(ALLOWANCE_B, {
    owner: pins.programId,
    executable: false,
    data: allowanceBytes({ id: BigInt(2), cap: BigInt(2_000_000), redeemed: BigInt(0), bond: BigInt(500_000), funder: pins.wallets.tableDemo }),
  });
  m.set(MERCHANT, { owner: pins.programId, executable: false, data: merchantBytes(BigInt(2_500_000)) });
  return m;
}

function accountJson(a: Account, slice?: { offset: number; length: number }) {
  const data = slice ? a.data.subarray(slice.offset, slice.offset + slice.length) : a.data;
  return { data: [base64(data), "base64"], executable: a.executable, owner: a.owner, lamports: 1_000_000, rentEpoch: 0, space: a.space ?? a.data.length };
}

function rpcAnswer(state: { slot: number; accounts: Map<string, Account> }, method: string, params: unknown[]): unknown {
  state.slot += 1;
  const context = { slot: state.slot, apiVersion: "e2e-stand-in" };
  const options = (params[1] ?? {}) as { dataSlice?: { offset: number; length: number } };
  switch (method) {
    case "getMultipleAccounts":
      return {
        context,
        value: (params[0] as string[]).map((address) => {
          const a = state.accounts.get(address);
          return a ? accountJson(a, options.dataSlice) : null;
        }),
      };
    case "getAccountInfo": {
      const a = state.accounts.get(params[0] as string);
      return { context, value: a ? accountJson(a, options.dataSlice) : null };
    }
    case "getProgramAccounts":
      return {
        context,
        value: [...state.accounts.entries()]
          .filter(([, a]) => a.owner === params[0])
          .map(([pubkey, a]) => ({ pubkey, account: accountJson(a, options.dataSlice) })),
      };
    case "getTokenAccountBalance":
      return { context, value: { amount: "9500000", decimals: 6, uiAmount: 9.5, uiAmountString: "9.5" } };
    case "getTransaction":
      return RECORDED_TXS.find((tx) => tx.transaction.signatures[0] === params[0]) ?? null;
    case "getSignaturesForAddress":
      return params[0] === pins.programId
        ? RECORDED_TXS.map((tx) => ({
            signature: tx.transaction.signatures[0],
            slot: tx.slot,
            err: tx.meta.err,
            memo: null,
            blockTime: tx.blockTime,
            confirmationStatus: "finalized",
          }))
        : [];
    case "getBlockTime":
      return 1_791_608_000;
    default:
      throw new Error(`the e2e stand-in does not answer ${method}`);
  }
}

/**
 * TEST FIXTURE: the settlement API's health answer (API-V1 section 6), as the stand-in sends it,
 * with the phase3Routes object of server/src/app/phase3.ts reporting
 * POST /v1/remittances as registered, so /send's form is on for the healthy e2e server. (The
 * server deployed before the Phase 3 routes sends no phase3Routes; unit/send-server.test.ts covers
 * that off state.)
 */
export const HEALTH = {
  ok: true,
  commit: MAIN_SHA,
  cluster: "devnet",
  programId: pins.programId as string,
  slot: 600_123_456,
  phase3Routes: {
    "/api/volume": { registered: false, reason: "missing_config" },
    "/trust": { registered: false, reason: "missing_config" },
    "/v1/remittances": { registered: true, reason: null },
    "/api/reserves": { registered: false, reason: "missing_config" },
  },
};

const JOB_NAMES: Record<string, string> = {
  ios: "ios (package tests, app build, release checks)",
  android: "android (core tests, debug build, lint)",
  program: "program (secp256r1 feature check, anchor test)",
  server: "server (typecheck, unit, integration, vectors)",
  web: "web (lint, typecheck, build, Playwright)",
  hygiene: "hygiene (gitleaks, scrub guard, prose gate, FACTS)",
};

function githubAnswer(pathname: string): unknown {
  if (pathname === "/github/repos/StephenSook/loka-pay/compare/pre-hacklanta-kit...main") {
    const commit = (login: string, date: string) => ({ author: { login }, commit: { author: { date } } });
    return {
      total_commits: EXPECTED.commits,
      commits: [commit("StephenSook", "2026-10-10T00:44:26Z"), commit("pravinireri", "2026-10-10T02:00:00Z"), commit("StephenSook", "2026-10-10T05:23:51Z")],
      // The third file has no patch and zero additions, the way GitHub reports a binary or
      // too-large diff, so the panel must show a floor and say why.
      files: [{ additions: 120, patch: "@@ -0,0 +1,120 @@" }, { additions: 30, patch: "@@ -0,0 +1,30 @@" }, { additions: 0 }],
    };
  }
  if (pathname === "/github/repos/StephenSook/loka-pay/commits/main/check-runs") {
    return {
      total_count: 6,
      check_runs: Object.entries(JOB_NAMES).map(([file, name], i) => ({
        name,
        head_sha: MAIN_SHA,
        status: "completed",
        conclusion: EXPECTED.ci[file],
        html_url: `https://github.com/StephenSook/loka-pay/actions/runs/${1000 + i}/job/${2000 + i}`,
        app: { slug: "github-actions" },
      })),
    };
  }
  return null;
}

/**
 * Starts the stand-in. GET /__seen reports the Authorization headers GitHub requests carried
 * and what the Vonage (/vonage/v1/calls) and ElevenLabs (/elevenlabs/v1/text-to-speech/:voice)
 * stand-ins received, for the /call tests.
 */
export async function startUpstream(port = UPSTREAM_PORT): Promise<Server> {
  const state = { slot: 600_000_000, accounts: accounts() };
  const githubAuthorization: string[] = [];
  const calls: CallSeen = { vonage: [], speech: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const readJson = (then: (body: unknown) => void) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => then(JSON.parse(raw)));
    };
    if (req.method === "GET" && url.pathname === "/__seen") return send(200, { githubAuthorization, ...calls });
    if (req.method === "POST" && url.pathname === "/vonage/v1/calls") {
      return readJson((body) => {
        calls.vonage.push({ authorization: req.headers.authorization ?? "", body });
        send(201, { uuid: randomUUID(), status: "started", direction: "outbound", conversation_uuid: `CON-${randomUUID()}` });
      });
    }
    const tts = url.pathname.match(/^\/elevenlabs\/v1\/text-to-speech\/([A-Za-z0-9]+)$/);
    if (req.method === "POST" && tts) {
      return readJson((body) => {
        const apiKey = req.headers["xi-api-key"];
        calls.speech.push({ apiKey: typeof apiKey === "string" ? apiKey : "", voice: tts[1], outputFormat: url.searchParams.get("output_format"), body });
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(E2E_AUDIO);
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/github/")) {
      githubAuthorization.push(req.headers.authorization ?? "");
      const body = githubAnswer(url.pathname);
      return body === null ? send(404, { message: "Not Found" }) : send(200, body);
    }
    if (req.method === "GET" && url.pathname === "/settlement/api/health") return send(200, HEALTH);
    if (req.method === "POST" && url.pathname === "/rpc") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const answer = (call: { id: number; method: string; params: unknown[] }) => {
          try {
            return { jsonrpc: "2.0", id: call.id, result: rpcAnswer(state, call.method, call.params ?? []) };
          } catch (e) {
            return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: String(e) } };
          }
        };
        const body = JSON.parse(raw);
        send(200, Array.isArray(body) ? body.map(answer) : answer(body));
      });
      return;
    }
    send(404, { message: "Not Found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
