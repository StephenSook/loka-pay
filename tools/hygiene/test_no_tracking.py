"""Tests for no_tracking.py: every planted tracker turns it red, an audio "amplitude"
does not, and a scan that saw too little never reads as clean.

Run: python3 -m unittest tools/hygiene/test_no_tracking.py -v
"""
from __future__ import annotations

import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import no_tracking  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

CLEAN = {
    "web/package.json": '{"dependencies": {"next": "16.4.0", "react": "19.2.0"}}',
    "web/pnpm-lock.yaml": "lockfileVersion: '9.0'\npackages:\n  next@16.4.0:\n    resolution: {}\n  '@types/node@22.0.0':\n    resolution: {}\n",
    "web/app/page.tsx": "export default function Page() { return null; }\n",
    "android/app/build.gradle.kts": 'dependencies { implementation("androidx.biometric:biometric:1.1.0") }\n',
    "android/app/VoiceNote.kt": "val amplitude = recorder.maxAmplitude\n",
    "ios/Package.swift": '// swift-tools-version:5.9\nlet package = Package(name: "LokaPay")\n',
    "programs/Cargo.toml": '[dependencies]\nanchor-lang = "1.0.0"\n',
}
REQUIRE = ["web/package.json", "web/pnpm-lock.yaml", "android/app/build.gradle.kts", "ios/Package.swift", "programs/Cargo.toml"]


def run_on(files: dict[str, str], *extra: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        for rel, text in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = no_tracking.main(["--root", str(root), "--min-files", "5", "--require", *REQUIRE, *extra])
        return code, out.getvalue()


def planted(rel: str, text: str) -> dict[str, str]:
    files = dict(CLEAN)
    files[rel] = text
    return files


class NoTracking(unittest.TestCase):
    def test_clean_tree_passes_and_an_audio_amplitude_is_not_a_tracker(self):
        code, out = run_on(CLEAN)
        self.assertEqual(code, 0, out)
        self.assertIn("0 findings", out)

    def test_analytics_package_in_package_json_fails(self):
        code, out = run_on(planted("web/package.json", '{"dependencies": {"next": "16.4.0", "@vercel/analytics": "1.0.0"}}'))
        self.assertEqual(code, 1, out)
        self.assertIn("@vercel/analytics", out)

    def test_transitive_error_tracker_in_the_lockfile_fails(self):
        lock = CLEAN["web/pnpm-lock.yaml"] + "  '@sentry/node@8.0.0':\n    resolution: {}\n"
        code, out = run_on(planted("web/pnpm-lock.yaml", lock))
        self.assertEqual(code, 1, out)
        self.assertIn("locks @sentry/node", out)

    def test_firebase_in_gradle_fails(self):
        code, out = run_on(planted("android/app/build.gradle.kts", 'dependencies { implementation("com.google.firebase:firebase-analytics:22.0.0") }\n'))
        self.assertEqual(code, 1, out)
        self.assertIn("com.google.firebase", out)

    def test_sentry_cocoa_in_package_swift_fails(self):
        code, out = run_on(planted("ios/Package.swift", '.package(url: "https://github.com/getsentry/sentry-cocoa", from: "8.0.0")\n'))
        self.assertEqual(code, 1, out)
        self.assertIn("sentry-cocoa", out)

    def test_tracker_host_in_web_source_fails(self):
        code, out = run_on(planted("web/app/layout.tsx", '<script src="https://www.googletagmanager.com/gtag/js" />\n'))
        self.assertEqual(code, 1, out)
        self.assertIn("googletagmanager.com", out)

    def test_untracked_new_file_is_scanned_before_commit(self):
        # run_on never commits, so every finding above already came from untracked files;
        # this one names the property so a switch to tracked-only files fails here.
        code, out = run_on(planted("web/app/new-page.tsx", "fetch('https://us.i.posthog.com/e')\n"))
        self.assertEqual(code, 1, out)

    def test_a_walk_below_the_floor_fails(self):
        code, out = run_on(CLEAN, "--min-files", "50")
        self.assertEqual(code, 1, out)
        self.assertIn("floor is 50", out)

    def test_a_required_manifest_that_was_not_scanned_fails(self):
        files = dict(CLEAN)
        del files["programs/Cargo.toml"]
        code, out = run_on(files)
        self.assertEqual(code, 1, out)
        self.assertIn("required manifest programs/Cargo.toml was not scanned", out)

    def test_the_lockfile_parser_reads_real_package_names(self):
        names = set(no_tracking.LOCK_KEY.findall((REPO / "web/pnpm-lock.yaml").read_text()))
        self.assertTrue({"next", "react", "@playwright/test"} <= names, sorted(names)[:20])

    def test_this_repository_is_clean(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = no_tracking.main(["--root", str(REPO)])
        self.assertEqual(code, 0, out.getvalue())


if __name__ == "__main__":
    unittest.main()
