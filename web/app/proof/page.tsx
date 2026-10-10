import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BuiltThisWeekendPanel } from "@/components/built-this-weekend";
import { SandboxChip } from "@/components/chips";
import { ArrowUpRightIcon } from "@/components/icons";
import { CARD, ClaimChip, PAGE } from "@/components/judge-ui";
import { ReservesPanel } from "@/components/reserves-panel";
import { readProgramFacts, readReserves } from "@/lib/chain";
import { claimsFrom, type Evidence } from "@/lib/claims";
import { readBuiltThisWeekend } from "@/lib/github";

// /proof (PLAN.md 3.2, 3.24, 3.60). The claims and the rules that decide their status are in
// lib/claims.ts; this page reads devnet and GitHub and shows them.

export const metadata: Metadata = {
  title: "Proof | LOKA Pay",
  description: "LOKA Pay's claims with their evidence, proof of reserves read from devnet at one slot, and what was built this weekend.",
};

function EvidenceLink({ evidence, testId = "claim-evidence" }: { evidence: Evidence; testId?: string }) {
  const className = "w-fit font-bold underline";
  return evidence.internal ? (
    <Link href={evidence.href} className={className} data-testid={testId}>
      {evidence.label}
    </Link>
  ) : (
    <a href={evidence.href} target="_blank" rel="noopener noreferrer" className={className} data-testid={testId}>
      {evidence.label}
      <ArrowUpRightIcon className="ml-1 inline-block h-4 w-4 align-[-0.15em]" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export default async function ProofPage() {
  await connection();
  // Read for this page view (readFirst): a claim is never Live from a cached read.
  const [facts, reserves, built] = await Promise.all([
    readProgramFacts({ readFirst: true }),
    readReserves({ readFirst: true }),
    readBuiltThisWeekend(),
  ]);
  const claims = claimsFrom(facts, reserves);

  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Proof</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          A claim says Live only when a read made for this page backs it, and then it links to evidence you can open. Not
          checked means that read failed or could not be made; Building means it is not built yet. Neither has a link.
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
              {c.status === "live" && c.evidence && c.more ? <EvidenceLink evidence={c.more} testId="claim-evidence-more" /> : null}
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
