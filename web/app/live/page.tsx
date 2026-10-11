import type { Metadata } from "next";
import Link from "next/link";
import { SandboxChip } from "@/components/chips";
import { LiveFeed } from "@/components/live-feed";
import { Mono } from "@/components/judge-ui";
import { PINS } from "@/lib/pins";
import { rowLabels } from "@/lib/row-labels";

// /live (PLAN.md 3.72): the browser reads the program's transactions from devnet itself
// (components/live-feed.tsx). `/live?kiosk=1` is the judge desk screen (PLAN.md 3.84): no site
// header, footer or intro (main[data-kiosk] hides the layout's header and footer in
// app/globals.css), large type, and a "Last payment" line on top. The labels for the rows
// docs/FACTS.json records are built here, on the server, so the browser never loads FACTS.

export const metadata: Metadata = {
  title: "Live | LOKA Pay",
  description: "Every transaction that touches the LOKA Pay program on Solana devnet, read by your browser straight from the chain.",
};

export default async function LivePage({ searchParams }: PageProps<"/live">) {
  const { kiosk } = await searchParams;
  const big = kiosk === "1";
  const labels = rowLabels();
  if (big) {
    return (
      <main data-kiosk="" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="sr-only">Live from devnet: the judge desk screen</h1>
        <div className="flex flex-wrap items-center gap-3">
          <SandboxChip />
          <span className="text-sm text-muted">Read by this browser straight from Solana devnet. No server of ours sits in between.</span>
        </div>
        <LiveFeed programId={PINS.programId} kiosk labels={labels} />
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Live from devnet</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          Every transaction that touches the <code className="font-mono">loka_vault</code> program, read by this browser
          straight from Solana devnet. No server of ours sits in between.
        </p>
        <p className="text-muted">
          Program <Mono>{PINS.programId}</Mono>. Sandbox only: test tokens with no value.
        </p>
        <p>
          Want your phone to ring when a payment settles?{" "}
          <Link prefetch={false} href="/call" className="font-bold underline">
            Get a call on /call
          </Link>
          .
        </p>
      </header>
      <LiveFeed programId={PINS.programId} kiosk={false} labels={labels} />
    </main>
  );
}
