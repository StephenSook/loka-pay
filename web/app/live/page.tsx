import type { Metadata } from "next";
import { SandboxChip } from "@/components/chips";
import { LiveFeed } from "@/components/live-feed";
import { Mono } from "@/components/judge-ui";
import { PINS } from "@/lib/pins";

// /live (PLAN.md 3.72): the browser reads the program's transactions from devnet itself
// (components/live-feed.tsx). `/live?kiosk=1` uses large type for a screen at the table.

export const metadata: Metadata = {
  title: "Live | LOKA Pay",
  description: "Every transaction that touches the LOKA Pay program on Solana devnet, read by your browser straight from the chain.",
};

export default async function LivePage({ searchParams }: PageProps<"/live">) {
  const { kiosk } = await searchParams;
  const big = kiosk === "1";
  return (
    <main className={`mx-auto flex w-full flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16 ${big ? "max-w-5xl" : "max-w-3xl"}`}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className={big ? "text-6xl sm:text-7xl" : "text-5xl sm:text-6xl"}>Live from devnet</h1>
          <SandboxChip />
        </div>
        <p className={big ? "text-2xl leading-relaxed" : "text-xl leading-relaxed"}>
          Every transaction that touches the <code className="font-mono">loka_vault</code> program, read by this browser
          straight from Solana devnet. No server of ours sits in between.
        </p>
        {big ? null : (
          <p className="text-muted">
            Program <Mono>{PINS.programId}</Mono>. Sandbox only: test tokens with no value.
          </p>
        )}
      </header>
      <LiveFeed programId={PINS.programId} kiosk={big} />
    </main>
  );
}
