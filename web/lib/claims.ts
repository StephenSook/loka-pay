// The claims /proof lists, each with the status its evidence decides (PLAN.md 3.2). Pure:
// the page hands in its reads, so the rules are unit-tested (unit/claims.test.ts).
//
// A claim is Live only with evidence a judge can open; a claim the chain decides is computed
// from a current devnet read (younger than its window, lib/read-state.ts; the page asks with
// `needCurrent`), and a Live claim says when that read was made and how old it was. When the
// read failed, was not made, or only an older read is available, it says Not checked, never
// Live from an older read. Everything else says Building and has no link.

import type { ProgramFacts, ReservesRead } from "./chain";
import { PROGRAM_JOB, type MainChecks } from "./github";
import { FIRST_REDEEM_TX_SIGNATURE, INIT_TX_SIGNATURE, TESTFLIGHT_STATUS, TESTFLIGHT_STATUS_AS_OF } from "./facts";
import { PINS } from "./pins";
import type { Read } from "./read-state";
import { REPO_URL } from "./site";
import { explorerAddress, explorerTx } from "./solana";
import { SECP256R1_FEATURE } from "./vault";
import { formatAge, formatEt } from "./time";

/** LIVE (evidence linked), BUILDING (no link) or NOT CHECKED (the read behind it failed). */
export type ClaimStatus = "live" | "building" | "unchecked";

export interface Evidence {
  href: string;
  label: string;
  /** Internal links stay in this tab. */
  internal?: boolean;
}

export interface Claim {
  id: string;
  text: string;
  status: ClaimStatus;
  evidence?: Evidence;
  /** A second place to look, shown under the evidence of a Live claim. */
  more?: Evidence;
  /** Why it is not Live: the failed read, or what is missing. */
  note?: string;
  /** For a Live claim decided by a read: which read, when, and how old it was when the page loaded. */
  checked?: Checked;
}

export interface Checked {
  source: string;
  readAtMs: number;
  ageMs: number;
}

/**
 * The data of a current read, with when it was made, or why there is none: the read failed or
 * was not made, or only an older read is available. A claim is never decided from an older
 * read: Live needs a read younger than its window.
 */
export type Current<T> = { data: T; problem: null; checked: Checked } | { data: null; problem: string; checked: null };

export function current<T>(read: Read<T>, source = "Solana devnet"): Current<T> {
  if (!read.ok) return { data: null, problem: read.reason, checked: null };
  const age = formatAge(read.askedAtMs - read.readAtMs);
  const window = formatAge(read.currentForMs);
  if (!read.current) {
    const why = read.staleBecause
      ? `The ${source} read for this page, at ${formatEt(read.staleBecause.atMs)}, ${read.staleBecause.notMade ? "was not made" : "failed"}: ${read.staleBecause.reason}. `
      : "";
    return {
      data: null,
      problem: `${why}The last good ${source} read, from ${formatEt(read.readAtMs)}, was ${age} old; a Live claim needs one no older than ${window}.`,
      checked: null,
    };
  }
  return { data: read.data, problem: null, checked: { source, readAtMs: read.readAtMs, ageMs: read.askedAtMs - read.readAtMs } };
}

/** A Live claim decided by a read carries that read's time and age. */
function stamped(claim: Claim, checked: Checked | null): Claim {
  return claim.status === "live" && checked ? { ...claim, checked } : claim;
}

const PRECOMPILE_TEXT =
  "The program checks the phone's P-256 signature on chain through Solana's secp256r1 precompile, whose runtime feature is active on devnet.";

/** Decided by the secp256r1 feature account, read with the program facts. */
function precompileClaim(facts: Current<ProgramFacts>): Claim {
  const base = { id: "precompile", text: PRECOMPILE_TEXT };
  if (!facts.data) return { ...base, status: "unchecked", note: facts.problem };
  const feature = facts.data.secp256r1;
  if (!feature.ok) return { ...base, status: "unchecked", note: `The secp256r1 feature account could not be read: ${feature.reason}.` };
  const f = feature.value;
  if (!f.active) {
    const note = !f.exists
      ? "Devnet has no secp256r1 feature account, so the precompile is not active."
      : f.activatedAt === null
        ? "The secp256r1 feature account on devnet is not activated."
        : `The secp256r1 feature activates at slot ${f.activatedAt}, after the read's slot ${f.slot}.`;
    return { ...base, status: "building", note };
  }
  return stamped(
    {
      ...base,
      status: "live",
      evidence: { href: explorerAddress(SECP256R1_FEATURE), label: `The secp256r1 feature account on Solana Explorer (active since slot ${f.activatedAt})` },
      more: { href: `${REPO_URL}/blob/main/programs/loka_vault/src/wire.rs`, label: "wire.rs (verify_precompile)" },
    },
    facts.checked,
  );
}

const PROGRAM_CI_TEXT =
  "The program's Anchor tests passed on a local validator for main's latest commit, after a check that the secp256r1 feature is active there. They run for every pull request and every push to main.";

/** Decided by the program job's result on main's latest commit, from GitHub's check runs. */
function programCiClaim(checks: Current<MainChecks>): Claim {
  const base = { id: "program-ci", text: PROGRAM_CI_TEXT };
  if (!checks.data) return { ...base, status: "unchecked", note: checks.problem };
  const commit = checks.data.sha ? checks.data.sha.slice(0, 7) : "unknown";
  const run = checks.data.runs.find((r) => r.name === PROGRAM_JOB);
  if (!run) return { ...base, status: "unchecked", note: `GitHub lists no "${PROGRAM_JOB}" job for main's latest commit (${commit}).` };
  if (run.status !== "completed") {
    return { ...base, status: "unchecked", note: `The program job for main's latest commit (${commit}) has not finished: GitHub says ${run.status}.` };
  }
  if (run.conclusion !== "success") {
    return { ...base, status: "building", note: `GitHub reports the program job for main's latest commit (${commit}) ended: ${run.conclusion ?? "no conclusion"}.` };
  }
  return stamped(
    {
      ...base,
      status: "live",
      evidence: { href: run.htmlUrl, label: `The program job for main's latest commit (${commit}) on GitHub` },
      more: { href: `${REPO_URL}/actions/workflows/program.yml`, label: "Every program workflow run" },
    },
    checks.checked,
  );
}

export function claimsFrom(factsRead: Read<ProgramFacts>, reservesRead: Read<ReservesRead>, checksRead: Read<MainChecks>): Claim[] {
  const facts = current(factsRead);
  const reserves = current(reservesRead);
  const checks = current(checksRead, "GitHub");
  const deployed: Claim = facts.data
    ? facts.data.program.exists && facts.data.program.executable
      ? {
          id: "deployed",
          text: "The loka_vault program is deployed on devnet and executable.",
          status: "live",
          evidence: { href: explorerAddress(PINS.programId), label: "Program on Solana Explorer" },
        }
      : { id: "deployed", text: "The loka_vault program is deployed on devnet and executable.", status: "building", note: "The chain does not show an executable program at the pinned id." }
    : { id: "deployed", text: "The loka_vault program is deployed on devnet and executable.", status: "unchecked", note: facts.problem };

  const configPart = facts.data ? facts.data.config : null;
  const initialized: Claim =
    configPart === null || !configPart.ok
      ? {
          id: "initialized",
          text: "The vault is initialized for devnet USDC.",
          status: "unchecked",
          note: configPart === null ? (facts.problem ?? "") : configPart.reason,
        }
      : configPart.value.exists && configPart.value.mintMatchesPins && configPart.value.cluster === 0
        ? {
            id: "initialized",
            text: "The vault is initialized for devnet USDC.",
            status: "live",
            evidence: { href: explorerTx(INIT_TX_SIGNATURE), label: "Initialize transaction on Solana Explorer" },
          }
        : { id: "initialized", text: "The vault is initialized for devnet USDC.", status: "building", note: "The config account on chain does not match the pins." };

  const redeemedOnChain = reserves.data ? reserves.data.allowances.some((a) => BigInt(a.redeemedUnits) > BigInt(0)) : null;
  const redeemed: Claim =
    redeemedOnChain === null
      ? { id: "redeemed", text: "A payment note has been redeemed on devnet.", status: "unchecked", note: reserves.problem ?? "" }
      : redeemedOnChain
        ? {
            id: "redeemed",
            text: "A payment note has been redeemed on devnet.",
            status: "live",
            // The first settled redeem itself (lib/facts.ts), which cannot scroll away; /live
            // lists only the newest transactions.
            evidence: { href: explorerTx(FIRST_REDEEM_TX_SIGNATURE), label: "The first settled redeem on Solana Explorer" },
            more: { href: "/live", label: "Newer transactions on /live", internal: true },
          }
        : { id: "redeemed", text: "A payment note has been redeemed on devnet.", status: "building", note: "No allowance on chain has a redeemed amount yet." };

  return [
    stamped(deployed, facts.checked),
    stamped(initialized, facts.checked),
    {
      id: "verify",
      text: "A receipt's three signatures are checked in your browser, with nothing sent to a server.",
      status: "live",
      evidence: { href: "/verify", label: "/verify and its labelled test receipt", internal: true },
    },
    precompileClaim(facts),
    programCiClaim(checks),
    {
      id: "live",
      text: "A live feed of the program's transactions, read by your browser straight from devnet.",
      // Built, but whether it works is decided in each visitor's browser, which this server
      // cannot see; /live itself says whether its WebSocket is carrying traffic.
      status: "unchecked",
      note: "Built, but this page cannot see your browser's connection. Open /live from the menu: it says Live only while its WebSocket to devnet carries traffic, and says so when it does not.",
    },
    stamped(
      {
        id: "reserves",
        text: "Proof of reserves from the program's accounts, every balance read at one slot.",
        status: reserves.data ? "live" : "unchecked",
        evidence: reserves.data ? { href: "#reserves", label: "Proof of reserves below", internal: true } : undefined,
        note: reserves.problem ?? undefined,
      },
      reserves.checked,
    ),
    stamped(redeemed, reserves.checked),
    {
      id: "server",
      text: "The settlement server takes a note from a phone and settles it on devnet.",
      status: "building",
      note: "The server is not live yet.",
    },
    {
      id: "testflight",
      text: "Anyone can install the iPhone app from a public TestFlight link.",
      status: "building",
      // The same dated status /judge shows (lib/facts.ts), so one edit updates both pages.
      note: `${TESTFLIGHT_STATUS}. Status as of ${TESTFLIGHT_STATUS_AS_OF}.`,
    },
  ];
}
