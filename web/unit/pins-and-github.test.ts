import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FILES_CAP, GitHubError, readCompareUncached, summarizeCompare } from "../lib/github";
import { PINS, PinsError, parsePins } from "../lib/pins";
import { wsUrlFor } from "../lib/solana";
import { formatEt, isoUtc } from "../lib/time";

const pinsFile = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "config", "pins.json"), "utf8"));

test.describe("config/pins.json", () => {
  test("the bundled pins equal the file, field by field", () => {
    expect(PINS.programId).toBe(pinsFile.programId);
    expect(PINS.mint).toBe(pinsFile.mint);
    expect(PINS.upgradeAuthority).toBe(pinsFile.upgradeAuthority);
    expect(PINS.accounts).toEqual(pinsFile.accounts);
    expect(PINS.feePayers).toEqual(pinsFile.feePayers);
    expect(PINS.wallets).toEqual(pinsFile.wallets);
    expect(PINS.serverEd25519PublicKey).toBe(pinsFile.serverEd25519PublicKey);
    expect(PINS.settlementNodeFingerprint).toBe(pinsFile.settlementNodeFingerprint);
  });

  const valid = () => JSON.parse(JSON.stringify(pinsFile));

  test("a cluster other than devnet is refused", () => {
    expect(() => parsePins({ ...valid(), cluster: "mainnet" })).toThrow(PinsError);
  });

  test("an address that is not 32 bytes of base58 is refused, naming the field", () => {
    const bad = valid();
    bad.accounts.vaultUsdcAccount = "11111";
    expect(() => parsePins(bad)).toThrow(/accounts\.vaultUsdcAccount/);
    const notBase58 = valid();
    notBase58.wallets.canary = "0OIl";
    expect(() => parsePins(notBase58)).toThrow(/wallets\.canary/);
  });

  test("a missing section is refused", () => {
    const bad = valid();
    delete bad.accounts;
    expect(() => parsePins(bad)).toThrow(/accounts/);
    expect(() => parsePins([])).toThrow(PinsError);
  });

  test("the server key may be null, hex or base58, and nothing else", () => {
    expect(parsePins({ ...valid(), serverEd25519PublicKey: null }).serverEd25519PublicKey).toBeNull();
    expect(parsePins({ ...valid(), serverEd25519PublicKey: "ab".repeat(32) }).serverEd25519PublicKey).toBe("ab".repeat(32));
    expect(() => parsePins({ ...valid(), serverEd25519PublicKey: "not a key!" })).toThrow(/serverEd25519PublicKey/);
  });
});

// Hand-built compare answers (TEST FIXTURES) in the shape of GitHub's REST compare endpoint.
const commit = (login: string | null, date: string) => ({ author: login ? { login } : null, commit: { author: { date } } });

test.describe("Built this weekend: GitHub compare summary", () => {
  test("a complete list gives counts, distinct authors and the first and latest times", () => {
    const s = summarizeCompare({
      total_commits: 3,
      commits: [
        commit("StephenSook", "2026-10-10T00:44:26Z"),
        commit("pravinireri", "2026-10-10T02:00:00Z"),
        commit("StephenSook", "2026-10-10T05:23:51Z"),
      ],
      files: [{ additions: 10 }, { additions: 5 }],
    });
    expect(s).toEqual({
      totalCommits: 3,
      listedCommits: 3,
      authors: ["pravinireri", "StephenSook"],
      commitsWithoutLogin: 0,
      filesChanged: 2,
      filesCapped: false,
      additions: 15,
      firstCommitMs: Date.parse("2026-10-10T00:44:26Z"),
      latestCommitMs: Date.parse("2026-10-10T05:23:51Z"),
    });
  });

  test("a cut-short list shows no first or latest time; commits with no login are counted", () => {
    const s = summarizeCompare({
      total_commits: 300,
      commits: [commit(null, "2026-10-10T01:00:00Z"), commit("AblazedTC", "2026-10-10T01:30:00Z")],
      files: Array.from({ length: FILES_CAP }, () => ({ additions: 1 })),
    });
    expect(s.totalCommits).toBe(300);
    expect(s.listedCommits).toBe(2);
    expect(s.commitsWithoutLogin).toBe(1);
    expect(s.firstCommitMs).toBeNull();
    expect(s.latestCommitMs).toBeNull();
    expect(s.filesCapped).toBe(true);
  });

  test("an unexpected shape throws instead of showing a number", () => {
    expect(() => summarizeCompare({ message: "API rate limit exceeded" })).toThrow(/unexpected shape/);
    expect(() => summarizeCompare(null)).toThrow();
  });
});

// Local servers on 127.0.0.1 (TEST FIXTURES) stand in for api.github.com.
test.describe("Built this weekend: a failed GitHub read names what failed", () => {
  test("no answer within the limit is a timeout", async () => {
    const server = createServer(() => {
      // Accepts the request and never answers.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/compare`;
    try {
      const error = await readCompareUncached(url, 300).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).message).toBe("GitHub did not answer within 0.3 s");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("a refused connection is not called a timeout", async () => {
    // Listen, note the port, close: nothing listens there any more.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise((resolve) => server.close(resolve));
    const error = await readCompareUncached(`http://127.0.0.1:${port}/compare`, 5000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toBe(`could not reach 127.0.0.1:${port}`);
  });
});

test.describe("small helpers", () => {
  test("WebSocket URL from the RPC URL", () => {
    expect(wsUrlFor("https://api.devnet.solana.com")).toBe("wss://api.devnet.solana.com");
    expect(wsUrlFor("http://127.0.0.1:8899")).toBe("ws://127.0.0.1:8899");
  });

  test("times are shown in Atlanta time with the zone named", () => {
    // The initialize_vault block time on devnet.
    expect(formatEt(1791608579 * 1000)).toBe("Sat, Oct 10, 1:02:59 AM ET");
    expect(isoUtc(1791608579 * 1000)).toBe("2026-10-10T05:02:59.000Z");
  });
});
