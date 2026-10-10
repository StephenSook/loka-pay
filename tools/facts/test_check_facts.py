"""Tests for check_facts.py: a copy of the repository's own FACTS.json, web/lib/facts.ts and
README.md passes, and each kind of drift planted in that copy turns it red. Every planted
edit asserts it changed exactly one place, so a test cannot pass because its edit missed.

Run: python3 -m unittest tools/facts/test_check_facts.py -v
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_facts  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
FILES = (check_facts.FACTS_PATH, check_facts.WEB_PATH, check_facts.README_PATH)


class Copy:
    """A temporary root holding copies of the three files the check reads."""

    def __enter__(self) -> "Copy":
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        for rel in FILES:
            dest = self.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / rel, dest)
        return self

    def __exit__(self, *exc: object) -> None:
        self._tmp.cleanup()

    def replace(self, rel: str, old: str, new: str) -> None:
        path = self.root / rel
        text = path.read_text(encoding="utf-8")
        count = text.count(old)
        if count != 1:
            raise AssertionError(f"planted edit expects {old!r} once in {rel}, found {count}")
        path.write_text(text.replace(old, new), encoding="utf-8")

    def append(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.write_text(path.read_text(encoding="utf-8") + text, encoding="utf-8")

    def facts(self, edit: Callable[[dict[str, Any]], None]) -> None:
        path = self.root / check_facts.FACTS_PATH
        data = json.loads(path.read_text(encoding="utf-8"))
        edit(data)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def run(self, *extra: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = check_facts.main(["--root", str(self.root), *extra])
        return code, out.getvalue()


def real_fact(key: str) -> dict[str, Any]:
    return json.loads((REPO / check_facts.FACTS_PATH).read_text(encoding="utf-8"))["facts"][key]


class CleanCopy(unittest.TestCase):
    def test_a_copy_of_the_repository_passes_and_counts_every_fact(self):
        total = len(json.loads((REPO / check_facts.FACTS_PATH).read_text(encoding="utf-8"))["facts"])
        with Copy() as c:
            code, out = c.run()
        self.assertEqual(code, 0, out)
        self.assertIn(f"{total} of {total} facts checked (floor {total})", out)
        self.assertIn(f"{len(check_facts.WEB_MIRRORS)} web/lib/facts.ts constants", out)
        must = len(check_facts.MUST_PRINT)
        self.assertIn(f"README: {must} printed and equal (floor {must}, one per MUST_PRINT key)", out)
        self.assertIn(" 0 findings", out)

    def test_must_print_names_every_value_readme_printed_when_it_was_written(self):
        # The README values printed and equal on 2026-10-10. Removing one from MUST_PRINT
        # means editing this test too, so the floor cannot be lowered in passing.
        printed_then = {
            "proof_pair_settled_tx", "proof_pair_refused_tx",
            "proof_pair_iphone_settled_tx", "proof_pair_iphone_refused_tx", "note_v1_bytes",
        }
        self.assertLessEqual(printed_then, check_facts.MUST_PRINT)

    def test_pending_placeholder_wording_on_readme_passes(self):
        with Copy() as c:
            c.append("README.md", "\nHeadline: PENDING of PENDING zero-bar payments settled; TODO(3.6) to settle.\n")
            code, out = c.run()
        self.assertEqual(code, 0, out)

    def test_a_correct_value_in_unrecognized_wording_passes_with_a_warning(self):
        with Copy() as c:
            c.append("README.md", "\nRemittances, World Bank: 10.6% (Senegal, 2023).\n")
            code, out = c.run()
        self.assertEqual(code, 0, out)
        self.assertIn("WARN senegal_remittances_pct_gdp_2023 on README.md: printed as '10.6%' in wording", out)
        # Found, but not compared: it does not count toward printed and equal.
        self.assertIn("1 equal only in wording no slot knows", out)


class Drift(unittest.TestCase):
    def test_a_drifted_web_constant_fails_naming_key_surface_expected_and_actual(self):
        good = real_fact("proof_pair_iphone_settled_note_id")["value"]
        bad = good[:-1] + ("0" if good[-1] != "0" else "1")
        with Copy() as c:
            c.replace(check_facts.WEB_PATH, f'"{good}"', f'"{bad}"')
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"FAIL proof_pair_iphone_settled_note_id on web/lib/facts\.ts:\d+: IPHONE_SETTLED_NOTE_ID")
        self.assertIn(f"expected '{good}', actual '{bad}'", out)

    def test_a_drifted_readme_signature_fails_with_its_line(self):
        good = real_fact("proof_pair_settled_tx")["value"]
        bad = good[:-1] + ("b" if good[-1] != "b" else "c")
        with Copy() as c:
            c.replace("README.md", f"tx/{good}?cluster=devnet", f"tx/{bad}?cluster=devnet")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"FAIL proof_pair_settled_tx on README\.md:\d+: expected ")
        self.assertIn(bad, out)

    def test_a_drifted_readme_number_fails(self):
        with Copy() as c:
            c.replace("README.md", "141-byte structure", "142-byte structure")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"FAIL note_v1_bytes on README\.md:\d+: expected '141', actual '142'")

    def test_settled_and_refused_links_swapped_fails_both(self):
        settled = real_fact("proof_pair_iphone_settled_tx")["value"]
        refused = real_fact("proof_pair_iphone_refused_tx")["value"]
        with Copy() as c:
            c.replace("README.md", f"[settled iPhone payment](https://explorer.solana.com/tx/{settled}",
                      f"[settled iPhone payment](https://explorer.solana.com/tx/{refused}")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL proof_pair_iphone_settled_tx on README.md", out)

    def test_a_pending_fact_printed_as_a_number_fails(self):
        with Copy() as c:
            c.append("README.md", "\nZero bars: 12 of 14 payments settled on devnet.\n")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"FAIL zero_bar_payments_settled on README\.md:\d+: is pending with no value, but README prints '12'")
        self.assertRegex(out, r"FAIL zero_bar_payments_tried on README\.md:\d+: is pending with no value, but README prints '14'")
        self.assertNotIn("FAIL payments_settled_total", out)

    def test_a_display_that_no_longer_matches_its_value_fails(self):
        with Copy() as c:
            c.facts(lambda d: d["facts"]["senegal_remittances_pct_gdp_2023"].update(display="10.5%"))
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL senegal_remittances_pct_gdp_2023 on docs/FACTS.json: display '10.5%' does not match value", out)

    def test_an_input_updated_without_its_estimate_fails(self):
        def bump(d: dict[str, Any]) -> None:
            d["facts"]["sol_usd_price_snapshot"].update(value=120.0, display="$120.00")

        with Copy() as c:
            c.facts(bump)
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL redeem_fee_usd_estimate on docs/FACTS.json: value 0.0011001 does not equal its formula", out)

    def test_a_value_of_the_wrong_type_fails_with_a_finding_not_a_crash(self):
        with Copy() as c:
            c.facts(lambda d: d["facts"]["people_count_estimate"].update(value="7886667"))
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL people_count_estimate on docs/FACTS.json: cannot format value '7886667'", out)
        self.assertIn("FAIL people_count_estimate on README.md: cannot format value '7886667' for README", out)

    def test_an_unclassified_or_unreadable_export_fails(self):
        with Copy() as c:
            c.append(check_facts.WEB_PATH, "\nexport const SETTLED_COUNT = 12;\nexport const LABEL = `t`;\n")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL SETTLED_COUNT on web/lib/facts.ts", out)
        self.assertIn("an export this check cannot read", out)

    def test_a_value_outside_must_print_that_readme_does_not_print_warns_and_strict_fails_it(self):
        without = check_facts.MUST_PRINT - {"note_v1_bytes"}
        with Copy() as c, mock.patch.object(check_facts, "MUST_PRINT", without):
            # "abc141def" holds the digits but is not the number: it must not count as printed.
            c.replace("README.md", "141-byte structure", "fixed-size structure (id abc141def)")
            code, out = c.run()
            strict_code, strict_out = c.run("--strict")
        self.assertEqual(code, 0, out)
        self.assertIn("WARN note_v1_bytes on README.md: has a value and lists README as a surface, but README does not print it yet", out)
        self.assertEqual(strict_code, 1, strict_out)
        self.assertIn("FAIL note_v1_bytes on README.md: has a value and lists README as a surface, but README does not print it yet", strict_out)


class MustPrint(unittest.TestCase):
    """A value README printed in its slot can never silently stop being compared."""

    def must_fail(self, out: str, key: str, expected: str) -> None:
        self.assertIn(
            f"FAIL {key} on README.md: is in MUST_PRINT: README must print {expected!r} in its slot wording, but no slot pattern matched",
            out,
        )

    def floor_fails(self, out: str, printed: int) -> None:
        must = len(check_facts.MUST_PRINT)
        self.assertIn(f"count floor: {printed} README values printed and equal, at least {must} required", out)

    def test_a_reworded_label_with_a_wrong_signature_fails(self):
        good = real_fact("proof_pair_settled_tx")["value"]
        bad = good[:-1] + ("b" if good[-1] != "b" else "c")
        with Copy() as c:
            c.replace("README.md", f"[settled payment](https://explorer.solana.com/tx/{good}?cluster=devnet)",
                      f"[the settled payment](https://explorer.solana.com/tx/{bad}?cluster=devnet)")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.must_fail(out, "proof_pair_settled_tx", check_facts.explorer_tx(good))
        self.assertIn("README does not print it", out)
        self.floor_fails(out, len(check_facts.MUST_PRINT) - 1)

    def test_a_reworded_142_byte_fixed_structure_fails(self):
        with Copy() as c:
            c.replace("README.md", "a fixed 141-byte structure", "a 142-byte fixed structure")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.must_fail(out, "note_v1_bytes", "141")
        self.floor_fails(out, len(check_facts.MUST_PRINT) - 1)

    def test_dropping_a_must_print_link_fails(self):
        refused = real_fact("proof_pair_refused_tx")["value"]
        with Copy() as c:
            c.replace("README.md", f" and [refused cheat](https://explorer.solana.com/tx/{refused}?cluster=devnet)", "")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.must_fail(out, "proof_pair_refused_tx", check_facts.explorer_tx(refused))
        self.assertIn("README does not print it", out)
        self.floor_fails(out, len(check_facts.MUST_PRINT) - 1)

    def test_dropping_a_must_print_number_fails_even_with_its_digits_inside_a_token(self):
        with Copy() as c:
            c.replace("README.md", "141-byte structure", "fixed-size structure (id abc141def)")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.must_fail(out, "note_v1_bytes", "141")
        self.assertIn("README does not print it", out)

    def test_a_correct_value_reworded_out_of_its_slot_fails_and_names_the_fix(self):
        good = real_fact("proof_pair_settled_tx")["value"]
        with Copy() as c:
            c.replace("README.md", "[settled payment](", "[the settled payment](")
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.must_fail(out, "proof_pair_settled_tx", check_facts.explorer_tx(good))
        self.assertIn("appears in wording its slot patterns do not recognize; add that wording to README_SLOTS", out)

    def test_a_slot_printed_value_missing_from_must_print_fails(self):
        without = check_facts.MUST_PRINT - {"note_v1_bytes"}
        with Copy() as c, mock.patch.object(check_facts, "MUST_PRINT", without):
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"FAIL note_v1_bytes on README\.md:\d+: README prints '141' in its slot, but MUST_PRINT")

    def test_a_must_print_fact_taken_off_readme_fails(self):
        def drop_readme(d: dict[str, Any]) -> None:
            fact = d["facts"]["proof_pair_refused_tx"]
            fact["surfaces"] = [s for s in fact["surfaces"] if s != "README"]

        with Copy() as c:
            c.facts(drop_readme)
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL proof_pair_refused_tx on README.md: is in MUST_PRINT (README prints it), but FACTS.json has no such fact listing README", out)
        self.floor_fails(out, len(check_facts.MUST_PRINT) - 1)

    def test_a_must_print_fact_reset_to_pending_fails(self):
        with Copy() as c:
            c.facts(lambda d: d["facts"]["note_v1_bytes"].update(value=None, status="pending"))
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("FAIL note_v1_bytes on README.md: is in MUST_PRINT (README prints it), but the fact is pending with no value", out)


class Schema(unittest.TestCase):
    CASES: list[tuple[str, Callable[[dict[str, Any]], None], str]] = [
        ("unknown kind", lambda f: f["note_v1_bytes"].update(kind="guess"), "FAIL note_v1_bytes on docs/FACTS.json: kind 'guess'"),
        ("missing source", lambda f: f["note_v1_bytes"].pop("source"), "is missing the required field 'source'"),
        ("empty source", lambda f: f["note_v1_bytes"].update(source=" "), "source must be a non-empty string"),
        ("value without as_of", lambda f: f["note_v1_bytes"].update(as_of=None), "has a value but no as_of date"),
        ("as_of not ISO", lambda f: f["note_v1_bytes"].update(as_of="Saturday"), "is not an ISO 8601 date"),
        ("pending with a value", lambda f: f["weekend_commits"].update(value=12), "status is pending but value is 12"),
        ("measured without a value", lambda f: f["note_v1_bytes"].update(value=None), "status is computed but value is null"),
        ("misspelled surface", lambda f: f["note_v1_bytes"].update(surfaces=["Readme"]), "surfaces ['Readme'] are not known surfaces"),
        ("misspelled field", lambda f: f["note_v1_bytes"].update(dispaly="141"), "has unknown fields ['dispaly']"),
        ("unknown status", lambda f: f["note_v1_bytes"].update(status="done"), "status 'done' is not one of"),
    ]

    def test_each_schema_error_fails_naming_the_fact(self):
        for name, edit, expected in self.CASES:
            with self.subTest(name), Copy() as c:
                c.facts(lambda d: edit(d["facts"]))
                code, out = c.run()
                self.assertEqual(code, 1, out)
                self.assertIn(expected, out)

    def test_an_empty_facts_object_fails_the_count_floor(self):
        with Copy() as c:
            c.facts(lambda d: d.update(facts={}))
            code, out = c.run()
        self.assertEqual(code, 1, out)
        self.assertIn("count floor: FACTS.json has no facts", out)

    def test_a_missing_file_exits_2_not_clean(self):
        for rel in FILES:
            with self.subTest(rel), Copy() as c:
                (c.root / rel).unlink()
                code, out = c.run()
                self.assertEqual(code, 2, out)
                self.assertIn(f"ERROR cannot read {rel}", out)


def captures(key: str, text: str) -> list[str]:
    return [v for _, v in check_facts._slot_matches(check_facts.README_SLOTS[key], text.splitlines())]


class SlotPatterns(unittest.TestCase):
    """Known positives and negatives for the README wording, including wording README does not use yet."""

    POSITIVE = [
        ("senegal_remittances_pct_gdp_2023", "Remittances were 10.6% of Senegal's GDP in 2023.", ["10.6%"]),
        ("senegal_remittances_usd_2023", "Senegal received $3.27 billion in remittances in 2023.", ["$3.27 billion"]),
        ("nigeria_remittances_usd_2024", "Nigeria received $22.13 billion in 2024.", ["$22.13 billion"]),
        ("senegal_mobile_money_adults_pct_2024", "Mobile money reached 67% of Senegalese adults in 2024, up from 45% in 2021.", ["67%"]),
        ("senegal_mobile_money_adults_pct_2021", "Mobile money reached 67% of Senegalese adults in 2024, up from 45% in 2021.", ["45%"]),
        ("people_count_estimate", "That is about 7.9 million Senegalese adults with a mobile money account.", ["about 7.9 million"]),
        ("zero_bar_payments_settled", "12 of 14 zero-bar payments settled.", ["12"]),
        ("zero_bar_payments_tried", "12 of 14 zero-bar payments settled.", ["14"]),
        ("ble_direct_hop_seconds_median", "One Bluetooth hop took 2.4 s and the payment settled in 8 s.", ["2.4"]),
        ("note_to_settle_seconds_p50", "One Bluetooth hop took 2.4 s and the payment settled in 8 s.", ["8"]),
        ("payments_settled_total", "42 payments settled on devnet so far.", ["42"]),
        ("program_commit", "The program was built from commit abc1234def.", ["abc1234def"]),
        ("program_hash", "On-chain program hash `" + "ab" * 32 + "`.", ["ab" * 32]),
        ("weekend_commits", "89 commits since hacking started.", ["89"]),
        ("weekend_files_changed", " 123 files changed, 4567 insertions(+), 89 deletions(-)", ["123"]),
        ("weekend_lines_added", " 123 files changed, 4567 insertions(+), 89 deletions(-)", ["4567"]),
        ("helene_grocer_stores_cash_only", "After Helene, 8 grocery stores went cash-only.", ["8"]),
        ("helene_grocer_lost_sales_usd", "They reported $1.2 million in lost sales.", ["$1.2 million"]),
        ("square_outage_2023_duration_minutes", "Square's 2023 outage lasted 120 minutes.", ["120"]),
        ("note_v1_bytes", "The note is a fixed 141-byte structure.", ["141"]),
    ]
    NEGATIVE = [
        ("people_count_estimate", "Senegal has 11.8 million adults."),
        ("senegal_remittances_usd_2023", "Nigeria received $22.13 billion in 2024."),
        ("payments_settled_total", "12 of 14 payments settled."),
        ("ble_direct_hop_seconds_median", "A phone pays a shop's phone directly, in one hop over Bluetooth or a QR code."),
        ("note_to_settle_seconds_p50", "Sat Oct 10, 2:01 AM ET: a P-256 signed note verified by the precompile."),
        ("program_commit", "returns the server's commit, the cluster, the program id and a slot"),
        ("square_outage_2023_duration_minutes", "| Demo video (2 to 3 minutes, public) | TODO |"),
        ("note_v1_bytes", "a 64-byte low-S signature and a 33-byte compressed key"),
    ]

    def test_each_slot_captures_its_value_from_likely_wording(self):
        for key, text, expected in self.POSITIVE:
            with self.subTest(key):
                self.assertEqual(captures(key, text), expected)

    def test_each_slot_ignores_neighbouring_wording(self):
        for key, text in self.NEGATIVE:
            with self.subTest(key):
                self.assertEqual(captures(key, text), [])

    def test_every_slot_pattern_has_one_value_group(self):
        for key, slot in check_facts.README_SLOTS.items():
            for pattern in slot.patterns:
                with self.subTest(key=key, pattern=pattern):
                    self.assertEqual(re.compile(pattern).groupindex.keys(), {"v"})

    def test_the_cent_wording_refuses_a_value_it_no_longer_describes(self):
        self.assertEqual(check_facts._tenth_of_a_cent(0.0011001), "about $0.0011 (about a tenth of a cent)")
        with self.assertRaises(ValueError):
            check_facts._tenth_of_a_cent(0.005)


if __name__ == "__main__":
    unittest.main()
