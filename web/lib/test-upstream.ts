// The e2e tests point the server reads at a local stand-in for devnet and GitHub
// (e2e/fixtures/upstream.ts). This module keeps that seam test-only, server only:
// - a loopback endpoint (any 127.0.0.0/8 address, the unspecified 0.0.0.0/8 and [::], [::1],
//   IPv4-mapped or IPv4-compatible forms of those, localhost and *.localhost, in whatever form
//   the URL parser normalizes) is accepted only while the explicit
//   test mode LOKA_E2E_UPSTREAM=1 is set, and never in a deployed production build
//   (NODE_ENV=production with VERCEL set), so stand-in answers can never count as devnet or
//   GitHub evidence on the real site;
// - in test mode the only GitHub token ever sent is the known test token (lib/github.ts).
// A refused setting throws UpstreamConfigError, which names the variable, never its value, so
// the page shows the read as failed with that reason.

/** The GitHub token the e2e stand-in expects (e2e/fixtures/ports.ts); not a secret. */
export const E2E_TEST_TOKEN = "e2e-stand-in-token-not-a-secret";

export class UpstreamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamConfigError";
  }
}

/** A production build running on Vercel: the real site, where no test seam may be open. */
export function isDeployedProduction(): boolean {
  return process.env.NODE_ENV === "production" && Boolean(process.env.VERCEL);
}

/** The explicit e2e test mode (playwright.config.ts sets it on its servers only). */
export function testMode(): boolean {
  return process.env.LOKA_E2E_UPSTREAM === "1";
}

/** Four IPv4 octets from a dotted host the URL parser has normalized, or null. */
function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** 127.0.0.0/8 (loopback) or 0.0.0.0/8 (unspecified, which reaches this machine). */
const isLocalIpv4 = (octets: number[]) => octets[0] === 127 || octets[0] === 0;

/** The eight 16-bit words of an IPv6 address (without brackets), or null when it is not one. */
function ipv6Words(addr: string): number[] | null {
  let text = addr;
  let tail: number[] = [];
  // A dotted IPv4 tail (::ffff:127.0.0.1) is the last two words.
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const octets = ipv4Octets(last);
    if (!octets || lastColon < 0) return null;
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    text = text.slice(0, lastColon);
    if (text.endsWith(":")) text += ":";
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const rest = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  if (![...head, ...rest].every((w) => /^[0-9a-f]{1,4}$/.test(w))) return null;
  const missing = 8 - tail.length - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const hex = (w: string) => parseInt(w, 16);
  return [...head.map(hex), ...new Array<number>(halves.length === 2 ? missing : 0).fill(0), ...rest.map(hex), ...tail];
}

/**
 * ::1, the unspecified ::, IPv4-mapped forms (::ffff:a.b.c.d) of a local IPv4 address, and
 * IPv4-compatible forms (::a.b.c.d) of a 127.0.0.0/8 address. (Other ::a.b.c.d forms overlap
 * ordinary IPv6 addresses such as ::2, which are not this machine.)
 */
function isLocalIpv6(words: number[]): boolean {
  if (words.slice(0, 5).some((w) => w !== 0)) return false;
  const [w5, w6, w7] = words.slice(5);
  const v4 = [w6 >> 8, w6 & 0xff, w7 >> 8, w7 & 0xff];
  if (w5 === 0xffff) return isLocalIpv4(v4);
  if (w5 !== 0) return false;
  if (w6 === 0 && (w7 === 0 || w7 === 1)) return true;
  return v4[0] === 127;
}

/**
 * True when an http(s) URL's host is this machine, decided after the URL parser has normalized
 * it (so 127.1, 2130706433 and 0x7f000001 are already 127.0.0.1): any 127.0.0.0/8 or 0.0.0.0/8
 * address, [::1], [::], their IPv4-mapped and IPv4-compatible IPv6 forms, and localhost or any
 * *.localhost name, with or without a trailing dot. A name that only resolves to loopback
 * through DNS is not detected here.
 */
export function isLoopback(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[") && host.endsWith("]")) {
    const words = ipv6Words(host.slice(1, -1));
    return words !== null && isLocalIpv6(words);
  }
  const octets = ipv4Octets(host);
  return octets !== null && isLocalIpv4(octets);
}

/** Throws unless a loopback endpoint named by `name` is allowed here: test mode on, not deployed production. */
export function assertTestUpstream(name: string): void {
  if (isDeployedProduction()) {
    throw new UpstreamConfigError(`${name} names a local test endpoint, which a deployed production build refuses`);
  }
  if (!testMode()) {
    throw new UpstreamConfigError(`${name} names a local test endpoint, which is accepted only in the e2e test mode (LOKA_E2E_UPSTREAM=1)`);
  }
}
