import type { Metadata } from "next";
import { SERVER_RPC_URL } from "@/lib/server-rpc";
import { CONTACT_EMAIL } from "@/lib/site";
import { DEFAULT_RPC_URL, RPC_URL, WS_URL, hostsOf, wsUrlFor } from "@/lib/solana";

// Also the App Store Connect privacy policy URL for the TestFlight build
// (https://zerobars.us/privacy). Every sentence here must be true today. The "What we store"
// table follows protocol/API-V1.md; re-check it against the server code when that merges.

export const metadata: Metadata = {
  title: "Privacy | LOKA Pay",
  description: "LOKA Pay privacy policy: no sign-up, no login, no profile.",
};

const UPDATED = "2026-10-10";

// The hosts named below come from the endpoints this build actually uses (lib/solana.ts and
// lib/server-rpc.ts), host names only, so an override can never leave this page untrue.
const BROWSER_HOSTS = hostsOf(RPC_URL, WS_URL);
const browserRpc =
  RPC_URL === DEFAULT_RPC_URL && WS_URL === wsUrlFor(DEFAULT_RPC_URL)
    ? `Solana's public devnet server (${BROWSER_HOSTS.join(" and ")})`
    : `the Solana devnet RPC server at ${BROWSER_HOSTS.join(" and ")}`;
const serverHosts = hostsOf(SERVER_RPC_URL).join(" and ");

// What reaches the settlement server, per protocol/API-V1.md sections 2 to 4.
const STORED = [
  {
    field: "A phone's public key and its sandbox allowance",
    where: "The settlement server, and Solana devnet, where it is public",
    why: "To open the allowance and let the program check that each payment was signed by that phone",
  },
  {
    field: "A merchant's display name, typed by the merchant",
    where: "The settlement server, inside the merchant's signed certificate",
    why: "So the certificate shows the same name every time",
  },
  {
    field: "Payment notes and acks: amount, key hashes, signatures and when the merchant received it",
    where: "The settlement server; each settled payment is also public on Solana devnet",
    why: "To settle each payment once and show how long it was held offline",
  },
  {
    field: "Your phone number, if you ask for a call on /call",
    where: "Stored nowhere. Our server passes it once to Vonage to place one call; Vonage keeps a record of the call",
    why: "To place the one call you asked for",
  },
  {
    field: "The words the call says",
    where: "Sent to ElevenLabs to make the voice: public payment details only (the amount, when it settled, that the signature was checked)",
    why: "To read the payment out loud",
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 leading-relaxed sm:px-6 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-5xl sm:text-6xl">Privacy</h1>
        <p className="text-muted">
          Updated <time dateTime={UPDATED}>{UPDATED}</time>
        </p>
      </header>

      <div className="rounded-card border-3 border-ink bg-surface p-5 shadow-hard">
        <p className="text-xl font-bold">No sign-up, no login, no profile.</p>
        <p className="mt-2">
          LOKA Pay has no accounts. There is nothing to sign up for or log in to, and we keep no
          profile of you.
        </p>
      </div>

      <p>
        LOKA Pay is a sandbox prototype built at the Hacklanta II hackathon. It uses test tokens on
        Solana devnet that have no monetary value. &quot;We&quot; means the LOKA Pay team.
      </p>

      <Section title="The iPhone app">
        <p>
          The iPhone app keeps its keys on the phone. Messages, photos and voice notes travel
          end-to-end encrypted to the person you send them to, over Bluetooth or a local Wi-Fi
          network, and are stored on the phones involved. The app does not send them to us.
        </p>
        <p>
          The app asks for these permissions, each only for the feature named: Bluetooth (to reach
          nearby phones), camera (to scan codes and take photos for messages), microphone (to record
          voice notes), contacts (to find a name for a phone number you type; contacts stay on the
          phone and are never uploaded), local network (to reach nearby phones on Wi-Fi) and Face ID
          (to approve each payment).
        </p>
      </Section>

      <Section title="This website">
        <p>
          This website sets no cookies and runs no analytics or tracking. Its fonts are served from
          this site&apos;s own address.
        </p>
        <p>
          Two pages make your browser contact another website, and only to read public data: /live
          connects to {browserRpc} to read the program&apos;s transactions, and /call connects to the
          same server to watch for the next settled payment, only after you press &quot;Call me when
          the next payment settles&quot;. That site sees your browser&apos;s request, as any website
          does; this site sends it nothing about you, and never your phone number. Every other page
          makes no request to any other website.
        </p>
        <p>
          The /judge, /proof and /trust pages read public data from Solana devnet ({serverHosts}) and
          GitHub (api.github.com) on our server, not from your browser, and those reads carry
          nothing about you. /call also reads public payment data from Solana devnet on our server,
          to find the payment the call reads out.
        </p>
        <p>
          It is hosted on Vercel. We have not turned on Vercel Web Analytics or Speed Insights.
        </p>
      </Section>

      <Section title="Phone calls (/call)">
        <p>
          If you enter a phone number on /call and press a button, your browser sends it once to our
          server, in the body of one request. Our server uses it to ask Vonage, the phone company we
          use, to place one call, and does not store or log it. Vonage keeps a record of the call.
        </p>
        <p>
          To enforce the call limits, our server&apos;s memory keeps a keyed hash of the number (not
          the number) for up to 24 hours. It is never written to disk and is gone when the server
          restarts.
        </p>
        <p>
          The voice is made by ElevenLabs from public payment details only: the amount, how long ago
          the payment settled, and that the chain checked the payer phone&apos;s signature. Your number
          is never sent to ElevenLabs.
        </p>
      </Section>

      <Section title="The settlement server">
        <p>
          The settlement server at api.zerobars.us is running on Solana devnet. It has no accounts
          and never asks for a name, phone number or email.
        </p>
        <p>
          The first three rows of the table below list what reaches it under our published API
          contract (protocol/API-V1.md in the repository). The server&apos;s code is still in review
          and not yet in the repository; we will check those rows against that code when it merges.
          The last two rows are what the /call page handles.
        </p>
      </Section>

      <Section title="What we store">
        <table className="w-full table-fixed border-collapse border-3 border-ink bg-surface text-left">
          <thead>
            <tr>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Field
              </th>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Where it lives
              </th>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Why
              </th>
            </tr>
          </thead>
          <tbody>
            {STORED.map((row) => (
              <tr key={row.field}>
                <td className="break-words border-2 border-ink p-3 align-top">{row.field}</td>
                <td className="break-words border-2 border-ink p-3 align-top">{row.where}</td>
                <td className="break-words border-2 border-ink p-3 align-top">{row.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Contact">
        <p>
          Questions about privacy:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="break-all font-bold underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </main>
  );
}
