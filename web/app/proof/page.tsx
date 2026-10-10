import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BuiltThisWeekendPanel } from "@/components/built-this-weekend";
import { SandboxChip } from "@/components/chips";
import { ArrowUpRightIcon } from "@/components/icons";
import { CARD, ClaimChip, PAGE, type ClaimStatus } from "@/components/judge-ui";
import { ReservesPanel } from "@/components/reserves-panel";
import { readProgramFacts, readReserves, type ProgramFacts, type Read, type ReservesRead } from "@/lib/chain";
import { INIT_TX_SIGNATURE, TESTFLIGHT_STATUS, TESTFLIGHT_STATUS_AS_OF } from "@/lib/facts";
import { readBuiltThisWeekend } from "@/lib/github";
import { PINS } from "@/lib/pins";
import { REPO_URL } from "@/lib/site";
import { explorerAddress, explorerTx } from "@/lib/solana";
import { formatEt } from "@/lib/time";

// /proof (PLAN.md 3.2, 3.24, 3.60). A claim is Live only with evidence a judge can open;
// a claim the chain decides is computed from the latest devnet read (cached 30 seconds), and
// when that read failed it says Not checked, never Live from an older read. Everything else
// says Building and has no link.

export const metadata: Metadata = {
  title: "Proof | LOKA Pay",
  description: "LOKA Pay's claims with their evidence, proof of reserves read from devnet at one slot, and what was built this weekend.",
};

interface Evidence {
  href: string;
  label: string;
  /** Internal links stay in this tab. */
  internal?: boolean;
}

interface Claim {
  id: string;
  text: string;
  status: ClaimStatus;
  evidence?: Evidence;
  /** Why it is not Live: the failed read, or what is missing. */
  note?: string;
}

/**
 * The data of a read that is current, or why there is none: the read failed, or only an
 * older read succeeded. A claim the chain decides is never decided from an older read.
 */
function current<T>(read: Read<T>): { data: T; problem: null } | { data: null; problem: string } {
  if (!read.ok) return { data: null, problem: read.reason };
  if (read.staleBecause) {
    return { data: null, problem: `The latest devnet read, at ${formatEt(read.staleBecause.atMs)}, failed: ${read.staleBecause.reason}.` };
  }
  return { data: read.data, problem: null };
}

function claimsFrom(factsRead: Read<ProgramFacts>, reservesRead: Read<ReservesRead>): Claim[] {
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
            evidence: { href: "/live", label: "The transactions on /live", internal: true },
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

function EvidenceLink({ evidence }: { evidence: Evidence }) {
  const className = "w-fit font-bold underline";
  return evidence.internal ? (
    <Link href={evidence.href} className={className} data-testid="claim-evidence">
      {evidence.label}
    </Link>
  ) : (
    <a href={evidence.href} target="_blank" rel="noopener noreferrer" className={className} data-testid="claim-evidence">
      {evidence.label}
      <ArrowUpRightIcon className="ml-1 inline-block h-4 w-4 align-[-0.15em]" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export default async function ProofPage() {
  await connection();
  const [facts, reserves, built] = await Promise.all([readProgramFacts(), readReserves(), readBuiltThisWeekend()]);
  const claims = claimsFrom(facts, reserves);

  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Proof</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          A claim says Live only when it links to evidence you can open. Everything else says Building and has no link.
        </p>
      </header>

      <section aria-labelledby="claims-title" className="flex flex-col gap-4">
        <h2 id="claims-title" className="text-3xl">
          Claims
        </h2>
        <ul className="flex flex-col gap-3" aria-label="Claims and their evidence">
          {claims.map((c) => (
            <li key={c.id} className={`${CARD} flex min-w-0 flex-col gap-2`} data-testid={`claim-${c.id}`} data-status={c.status}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 flex-1 basis-64 font-bold leading-relaxed">{c.text}</p>
                <ClaimChip status={c.status} />
              </div>
              {c.status === "live" && c.evidence ? <EvidenceLink evidence={c.evidence} /> : null}
              {c.status !== "live" && c.note ? <p className="break-words text-sm text-muted">{c.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <ReservesPanel read={reserves} />

      <BuiltThisWeekendPanel read={built} />
    </main>
  );
}
