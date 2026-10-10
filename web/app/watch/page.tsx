import type { Metadata } from "next";
import Link from "next/link";
import { SandboxChip } from "@/components/chips";
import { BUTTON_PRIMARY, CARD, PAGE } from "@/components/judge-ui";
import { WatchPanel } from "@/components/watch-panel";
import { DEMO_ALLOWANCE_ID } from "@/lib/facts";
import { PINS } from "@/lib/pins";
import { parseRecipient } from "@/lib/remittance";

// /watch?a=<allowance id> (PLAN.md 3.85): a judge scans the QR on /judge and their own phone
// reads one allowance straight from Solana devnet (components/watch-panel.tsx, lib/watch.ts):
// what it can still spend, and each payment from it as it settles or is refused. The id is
// the bare decimal id or the payer phone's LOKA-ALLOWANCE:<id> code, checked by the same rule
// /send uses (lib/remittance.ts parseRecipient). This server only sends the page.

export const metadata: Metadata = {
  title: "Watch it settle | LOKA Pay",
  description:
    "One LOKA Pay allowance, read by your phone straight from Solana devnet: what it can still spend, and each payment from it as it settles or is refused.",
};

export default async function WatchPage({ searchParams }: PageProps<"/watch">) {
  const { a } = await searchParams;
  const raw = typeof a === "string" ? a : undefined;
  const parsed = raw === undefined ? null : parseRecipient(raw);
  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Watch it settle</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          One allowance, read by this phone straight from Solana devnet: what it can still spend, and each payment from it
          as it settles, or is refused when the same note is spent twice. No server of ours sits in between.
        </p>
      </header>
      {parsed?.ok ? (
        <WatchPanel key={parsed.value} allowanceId={parsed.value} programId={PINS.programId} />
      ) : (
        <section aria-labelledby="choose-title" className={`${CARD} flex flex-col gap-4`} data-testid="watch-choose">
          <h2 id="choose-title" className="text-2xl">
            Which allowance?
          </h2>
          {parsed && !parsed.ok ? (
            <p className="font-bold" role="alert" data-testid="watch-id-problem">
              {parsed.problem}
            </p>
          ) : null}
          <form method="get" action="/watch" className="flex flex-col gap-3">
            <label htmlFor="watch-id" className="font-bold">
              Allowance id, or the payer phone&apos;s LOKA-ALLOWANCE code
            </label>
            <input
              id="watch-id"
              name="a"
              defaultValue={raw ?? ""}
              inputMode="numeric"
              autoComplete="off"
              className="w-full min-w-0 rounded-xl border-3 border-ink bg-paper px-4 py-3 font-mono text-lg"
            />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Watch
            </button>
          </form>
          <p>
            Or watch the demo payer&apos;s allowance:{" "}
            <Link prefetch={false} href={`/watch?a=${DEMO_ALLOWANCE_ID}`} className="break-all font-bold underline" data-testid="watch-demo-link">
              {DEMO_ALLOWANCE_ID}
            </Link>
            .
          </p>
        </section>
      )}
    </main>
  );
}
