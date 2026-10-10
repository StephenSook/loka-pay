import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CallPanel } from "@/components/call-panel";
import { SandboxChip } from "@/components/chips";
import { CARD, PAGE } from "@/components/judge-ui";
import { callsEnabled } from "@/lib/call-server";
import { NUMBER_LIMIT, NUMBER_WINDOW_MS, SITE_LIMIT } from "@/lib/call-limits";
import { SIGNATURE_MAX_AGE_MS } from "@/lib/call-shared";
import { PINS } from "@/lib/pins";

// /call (PLAN.md 3.9, web version): a visitor's phone rings and an ElevenLabs voice reads a
// real settled payment from devnet, placed through Vonage (lib/call-server.ts). Rendered per
// request so the page knows whether calling is turned on here; it loads nothing from another
// site until "the next payment" is pressed (components/call-panel.tsx).

export const metadata: Metadata = {
  title: "Call me | LOKA Pay",
  description: "Enter your own phone number and get a call that reads a settled LOKA Pay sandbox payment from Solana devnet.",
};

export default async function CallPage() {
  await connection();
  const enabled = callsEnabled();
  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Get a phone call when a payment settles</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          Enter your phone number and press a button. Your phone rings, and a voice reads a real settled LOKA Pay payment
          from Solana devnet: the amount, how long ago it settled, and that the chain checked the signature made by the
          payer&apos;s phone.
        </p>
        <p className="text-muted">Sandbox only: test money on Solana devnet with no value. No real money moves.</p>
      </header>

      <div className={`${CARD} flex flex-col gap-2`} data-testid="call-consent">
        <p className="text-xl font-bold">Only enter your own number.</p>
        <p>
          It stays in this browser until you press a button. Our server uses it to place one call and never stores or logs
          it. Vonage, the phone company we use, keeps a record of the call. The voice is made by ElevenLabs from public
          payment details.
        </p>
      </div>

      <section aria-labelledby="how-title" className="flex flex-col gap-2 leading-relaxed">
        <h2 id="how-title" className="text-2xl">
          The two buttons
        </h2>
        <p>
          <strong>Call me now</strong> asks our server for the program&apos;s most recent settled payment on devnet and
          calls you about it.
        </p>
        <p>
          <strong>Call me when the next payment settles</strong> makes this browser watch the program on devnet, the way
          the <Link prefetch={false} href="/live" className="font-bold underline">live feed</Link> does. When a new
          payment settles, the page sends your number and that payment to our server, which checks on devnet that it
          settled within the last {SIGNATURE_MAX_AGE_MS / 60_000} minutes before calling.
        </p>
        <p className="text-sm text-muted">
          A refused or failed transaction is never read out as paid. Limits, counted in each server instance&apos;s
          memory: {NUMBER_LIMIT} calls per number every {NUMBER_WINDOW_MS / 60_000} minutes, one call per number for each
          payment, and {SITE_LIMIT} calls an hour. US and Canadian numbers only. More in the{" "}
          <Link prefetch={false} href="/privacy" className="font-bold underline">
            privacy policy
          </Link>
          .
        </p>
      </section>

      <CallPanel programId={PINS.programId} enabled={enabled} />
    </main>
  );
}
