// The claims /proof lists, each with the status its evidence decides (PLAN.md 3.2). Pure:
// the page hands in its reads, so the rules are unit-tested (unit/claims.test.ts).
//
// A claim is Live only with evidence a judge can open; a claim the chain decides is computed
// from the latest devnet read, and when that read failed it says Not checked, never Live
// from an older read. Everything else says Building and has no link.

import type { ProgramFacts, ReservesRead } from "./chain";
import { FIRST_REDEEM_TX_SIGNATURE, INIT_TX_SIGNATURE, TESTFLIGHT_STATUS, TESTFLIGHT_STATUS_AS_OF } from "./facts";
import { PINS } from "./pins";
import type { Read } from "./read-state";
import { REPO_URL } from "./site";
import { explorerAddress, explorerTx } from "./solana";
import { formatEt } from "./time";

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
}

/**
 * The data of a read that is current, or why there is none: the read failed, or only an
 * older read succeeded. A claim the chain decides is never decided from an older read.
 */
export function current<T>(read: Read<T>): { data: T; problem: null } | { data: null; problem: string } {
  if (!read.ok) return { data: null, problem: read.reason };
  if (read.staleBecause) {
    return { data: null, problem: `The latest devnet read, at ${formatEt(read.staleBecause.atMs)}, failed: ${read.staleBecause.reason}.` };
  }
  return { data: read.data, problem: null };
}

export function claimsFrom(factsRead: Read<ProgramFacts>, reservesRead: Read<ReservesRead>): Claim[] {
  const facts = current(factsRead);
  const reserves = current(reservesRead);
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
    deployed,
    initialized,
    {
      id: "verify",
      text: "A receipt's three signatures are checked in your browser, with nothing sent to a server.",
      status: "live",
      evidence: { href: "/verify", label: "/verify and its labelled test receipt", internal: true },
    },
    {
      id: "precompile",
      text: "The program checks the phone's P-256 signature on chain through Solana's secp256r1 precompile, and its tests run in CI.",
      status: "live",
      evidence: { href: `${REPO_URL}/blob/main/programs/loka_vault/src/wire.rs`, label: "wire.rs (verify_precompile)" },
    },
    {
      id: "program-ci",
      text: "The program's Anchor tests run on a local validator for every pull request and every push to main.",
      status: "live",
      evidence: { href: `${REPO_URL}/actions/workflows/program.yml`, label: "program workflow runs" },
    },
    {
      id: "live",
      text: "A live feed of the program's transactions, read by your browser straight from devnet.",
      status: "live",
      evidence: { href: "/live", label: "/live", internal: true },
    },
    {
      id: "reserves",
      text: "Proof of reserves from the program's accounts, every balance read at one slot.",
      status: reserves.data ? "live" : "unchecked",
      evidence: reserves.data ? { href: "#reserves", label: "Proof of reserves below", internal: true } : undefined,
      note: reserves.problem ?? undefined,
    },
    redeemed,
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
