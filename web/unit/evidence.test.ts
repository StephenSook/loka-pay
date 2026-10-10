import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { secp256r1FeaturePart } from "../lib/chain";
import { GitHubError, PROGRAM_JOB, WORKFLOWS, summarizeCheckRuns } from "../lib/github";
import { DecodeError, FEATURE_PROGRAM, decodeFeature } from "../lib/vault";

// The evidence behind two /proof claims: the secp256r1 feature account on devnet, and the
// program job's result on main's latest commit from GitHub's check runs API.

// The feature account's 9 bytes as devnet answered getAccountInfo on 2026-10-10 (context slot
// 509494509): Some(380592000), the activation slot programs/TOOLCHAIN.md records.
const RECORDED_FEATURE = Uint8Array.from([1, 128, 95, 175, 22, 0, 0, 0, 0]);

test.describe("the secp256r1 feature account", () => {
  test("the recorded account decodes to its activation slot", () => {
    expect(decodeFeature(RECORDED_FEATURE)).toEqual({ activatedAt: BigInt(380_592_000) });
  });

  test("an inactive feature is None; a bad option byte or a short account is refused", () => {
    expect(decodeFeature(Uint8Array.from([0]))).toEqual({ activatedAt: null });
    expect(() => decodeFeature(Uint8Array.from([2, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(DecodeError);
    expect(() => decodeFeature(Uint8Array.from([1, 128, 95]))).toThrow(DecodeError);
  });

  test("active only when activated at or before the slot it was read at", () => {
    const info = { owner: FEATURE_PROGRAM, data: RECORDED_FEATURE };
    expect(secp256r1FeaturePart(info, 509_494_509)).toEqual({
      ok: true,
      value: { exists: true, activatedAt: 380_592_000, active: true, slot: 509_494_509 },
    });
    expect(secp256r1FeaturePart(info, 380_591_999)).toEqual({
      ok: true,
      value: { exists: true, activatedAt: 380_592_000, active: false, slot: 380_591_999 },
    });
    expect(secp256r1FeaturePart({ owner: FEATURE_PROGRAM, data: Uint8Array.from([0]) }, 509_494_509)).toEqual({
      ok: true,
      value: { exists: true, activatedAt: null, active: false, slot: 509_494_509 },
    });
  });

  test("no account, or an account the feature program does not own, is never active", () => {
    expect(secp256r1FeaturePart(null, 509_494_509)).toEqual({
      ok: true,
      value: { exists: false, activatedAt: null, active: false, slot: 509_494_509 },
    });
    const spoofed = secp256r1FeaturePart({ owner: "11111111111111111111111111111111", data: RECORDED_FEATURE }, 509_494_509);
    expect(spoofed.ok).toBe(false);
  });
});

// TEST FIXTURES in the shape GitHub's check runs API answered for main on 2026-10-10.
const SHA = "62c401a0000000000000000000000000000000ab";
function check(name: string, conclusion: string | null, options: { status?: string; slug?: string; sha?: string } = {}) {
  return {
    name,
    head_sha: options.sha ?? SHA,
    status: options.status ?? "completed",
    conclusion,
    html_url: `https://github.com/StephenSook/loka-pay/actions/runs/38039402175/job/114176466350`,
    app: { slug: options.slug ?? "github-actions" },
  };
}

test.describe("main's checks from GitHub", () => {
  test("GitHub Actions jobs with their results and the commit; another app's check is left out", () => {
    const s = summarizeCheckRuns({
      total_count: 3,
      check_runs: [check(PROGRAM_JOB, "success"), check("server (typecheck, unit, integration, vectors)", "failure"), check(PROGRAM_JOB, "success", { slug: "socket-security" })],
    });
    expect(s.sha).toBe(SHA);
    expect(s.runs).toEqual([
      { name: PROGRAM_JOB, status: "completed", conclusion: "success", htmlUrl: "https://github.com/StephenSook/loka-pay/actions/runs/38039402175/job/114176466350" },
      {
        name: "server (typecheck, unit, integration, vectors)",
        status: "completed",
        conclusion: "failure",
        htmlUrl: "https://github.com/StephenSook/loka-pay/actions/runs/38039402175/job/114176466350",
      },
    ]);
  });

  test("an answer of the wrong shape, a check of the wrong shape, or checks of two commits is refused", () => {
    expect(() => summarizeCheckRuns({ message: "Not Found" })).toThrow(GitHubError);
    expect(() => summarizeCheckRuns({ check_runs: [{ ...check(PROGRAM_JOB, "success"), status: undefined }] })).toThrow(/unexpected shape/);
    expect(() => summarizeCheckRuns({ check_runs: [{ ...check(PROGRAM_JOB, "success"), head_sha: "main" }] })).toThrow(/unexpected shape/);
    expect(() =>
      summarizeCheckRuns({ check_runs: [check(PROGRAM_JOB, "success"), check("web (lint, typecheck, build, Playwright)", "success", { sha: "f".repeat(40) })] }),
    ).toThrow(/more than one commit/);
    expect(() => summarizeCheckRuns({ check_runs: [{ ...check(PROGRAM_JOB, "success"), html_url: "https://example.org/job/1" }] })).toThrow(
      /not in this repository/,
    );
  });

  test("no GitHub Actions job at all: no commit, no runs", () => {
    expect(summarizeCheckRuns({ check_runs: [] })).toEqual({ sha: null, runs: [] });
  });
});

// /judge matches each workflow to its check run by the job's name, so a renamed job would
// silently show "No run on this commit". The names are read from the workflow files here.
test("every workflow file is listed for /judge with its one job's name", () => {
  const dir = path.join(__dirname, "..", "..", ".github", "workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  expect(WORKFLOWS.map((w) => `${w.file}.yml`).sort()).toEqual(files.sort());
  for (const w of WORKFLOWS) {
    const jobNames = [...readFileSync(path.join(dir, `${w.file}.yml`), "utf8").matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim());
    expect(jobNames, w.file).toEqual([w.job]);
  }
});
