"""Tests for tools/measure/exp_pay_001.py (PLAN.md task 3.6). Standard library unittest, no network.

Fixtures (tools/measure/fixtures/exp_pay_001.json) are getTransaction and notes API answers recorded
2026-10-10, unchanged. Expected values come from docs/FACTS.json (read here) or from its source text
(cited beside each constant), never from memory.

Run: python3 -m unittest tools/measure/test_exp_pay_001.py -v
"""

import contextlib
import copy
import csv
import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exp_pay_001 as exp  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
with open(os.path.join(HERE, "fixtures", "exp_pay_001.json")) as fh:
    FIX = json.load(fh)
with open(os.path.join(REPO, "docs", "FACTS.json")) as fh:
    FACTS = json.load(fh)["facts"]
with open(os.path.join(REPO, "config", "pins.json")) as fh:
    PINS = json.load(fh)

PROGRAM = PINS["programId"]
SERVER_KEY = bytes.fromhex(PINS["serverEd25519PublicKey"])
IPHONE_SETTLED = FACTS["proof_pair_iphone_settled_tx"]["value"]
IPHONE_REFUSED = FACTS["proof_pair_iphone_refused_tx"]["value"]
TEST_SETTLED = FACTS["proof_pair_settled_tx"]["value"]
TEST_REFUSED = FACTS["proof_pair_refused_tx"]["value"]
# docs/FACTS.json proof_pair_iphone_settled_tx source: "amount 250000 base units, serial 0,
# allowance 10652706154269594633"; proof_pair_iphone_refused_tx source: the same allowance and serial.
IPHONE_AMOUNT, IPHONE_SERIAL, IPHONE_ALLOWANCE = 250000, 0, 10652706154269594633


def redeem(signature):
    rows = exp.extract_redeems(copy.deepcopy(FIX["transactions"][signature]), PROGRAM)
    assert len(rows) == 1, rows
    return rows[0]


LOG_COLUMNS = ["time", "payer_phone", "merchant_phone", "airplane_mode", "transport", "note_id", "serial", "cheat"]


def log_row(signature, airplane="y", by_note_id=True, shift=0, cheat=None):
    """One attempt-log row for a fixture redeem. Its time is the block time (plus shift) written in ET,
    as a person reads it off the merchant phone. Phone B paid both iPhone fixtures (protocol section 2)."""
    row = redeem(signature)
    when = dt.datetime.fromtimestamp(FIX["transactions"][signature]["blockTime"] + shift, exp.ET)
    return {"time": when.strftime("%Y-%m-%d %H:%M:%S"), "payer_phone": "B", "merchant_phone": "A",
            "airplane_mode": airplane, "transport": "camera", "note_id": row["note_id"] if by_note_id else "",
            "serial": "" if by_note_id else str(row["serial"]),
            "cheat": cheat if cheat is not None else ("y" if signature == IPHONE_REFUSED else "n")}


def write_log(rows, fmt="csv"):
    path = os.path.join(tempfile.mkdtemp(), "attempts." + fmt)
    with open(path, "w", newline="") as fh:
        if fmt == "json":
            json.dump(rows, fh)
        else:
            writer = csv.DictWriter(fh, fieldnames=LOG_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)
    return path


class Ed25519(unittest.TestCase):
    # RFC 8032 section 7.1, TEST 1 and TEST 2 (checked against rfc-editor.org/rfc/rfc8032.txt).
    VECTORS = [
        ("d75a980182b10ab7d54bfed3c964073a" "0ee172f3daa62325af021a68f707511a", "",
         "e5564300c360ac729086e2cc806e828a" "84877f1eb8e5d974d873e06522490155"
         "5fb8821590a33bacc61e39701cf9b46b" "d25bf5f0595bbe24655141438e7a100b"),
        ("3d4017c3e843895a92b70aa74d1b7ebc" "9c982ccf2ec4968cc0cd55f12af4660c", "72",
         "92a009a9f0d4cab8720e820b5f642540" "a2b27b5416503f8fb3762223ebdb69da"
         "085ac1e43e15996e458f3613d0f11d8c" "387b2eaeb4302aeeb00d291612bb0c00"),
    ]

    def test_rfc8032_vectors_verify(self):
        for public, message, signature in self.VECTORS:
            self.assertTrue(exp.ed25519_verify(bytes.fromhex(public), bytes.fromhex(message), bytes.fromhex(signature)))

    def test_a_changed_message_or_signature_fails(self):
        public, _, signature = self.VECTORS[1]
        self.assertFalse(exp.ed25519_verify(bytes.fromhex(public), b"\x73", bytes.fromhex(signature)))
        bad = bytearray(bytes.fromhex(signature))
        bad[10] ^= 1
        self.assertFalse(exp.ed25519_verify(bytes.fromhex(public), b"\x72", bytes(bad)))


class NoteDecoder(unittest.TestCase):
    def test_iphone_settled_note_matches_facts(self):
        row = redeem(IPHONE_SETTLED)
        self.assertEqual(row["note_id"], FACTS["proof_pair_iphone_settled_note_id"]["value"])
        self.assertEqual((row["amount_units"], row["serial"], row["allowance_id"]),
                         (IPHONE_AMOUNT, IPHONE_SERIAL, IPHONE_ALLOWANCE))
        self.assertIsNone(row["error"])
        self.assertIsNone(row["error_code"])
        self.assertEqual(row["signature"], IPHONE_SETTLED)
        self.assertEqual(exp.check_note_binding(row, PINS), [])

    def test_iphone_refused_note_matches_facts(self):
        settled, refused = redeem(IPHONE_SETTLED), redeem(IPHONE_REFUSED)
        self.assertEqual(refused["note_id"], FACTS["proof_pair_iphone_refused_note_id"]["value"])
        self.assertEqual((refused["amount_units"], refused["serial"], refused["allowance_id"]),
                         (IPHONE_AMOUNT, IPHONE_SERIAL, IPHONE_ALLOWANCE))
        self.assertEqual(refused["error_code"], exp.SERIAL_USED)
        # FACTS: "the same payer key as proof_pair_iphone_settled_tx and a different payee key hash".
        self.assertEqual(refused["payer_key_hash"], settled["payer_key_hash"])
        self.assertNotEqual(refused["payee_key_hash"], settled["payee_key_hash"])
        self.assertEqual(exp.check_note_binding(refused, PINS), [])

    def test_note_id_is_sha256_of_the_141_note_bytes(self):
        tx = FIX["transactions"][IPHONE_SETTLED]
        keys = exp.account_keys(tx)
        pre = next(ix for ix in tx["transaction"]["message"]["instructions"]
                   if keys[ix["programIdIndex"]] == exp.SECP256R1_PROGRAM)
        decoded = exp.decode_precompile(exp.b58decode(pre["data"]))
        self.assertEqual(len(decoded["message"]), 141)
        self.assertEqual(decoded["message"][:16], b"LOKA-PAY-NOTE-V1")
        self.assertEqual(exp.decode_note(decoded["message"])["note_id"],
                         FACTS["proof_pair_iphone_settled_note_id"]["value"])

    def test_test_key_pair_decodes_with_a_compute_budget_instruction_first(self):
        # The 2:01 AM transactions carry 3 instructions; the iPhone ones carry 2.
        self.assertEqual(len(FIX["transactions"][TEST_SETTLED]["transaction"]["message"]["instructions"]), 3)
        settled, refused = redeem(TEST_SETTLED), redeem(TEST_REFUSED)
        self.assertEqual(settled["instruction_index"], 2)
        self.assertEqual(settled["payer_key_hash"], refused["payer_key_hash"])
        self.assertEqual((settled["allowance_id"], settled["serial"]), (refused["allowance_id"], refused["serial"]))
        self.assertNotEqual(settled["payer_key_hash"], redeem(IPHONE_SETTLED)["payer_key_hash"])
        self.assertEqual(refused["error_code"], exp.SERIAL_USED)

    def test_precompile_shape_is_enforced(self):
        tx = FIX["transactions"][IPHONE_SETTLED]
        good = exp.b58decode(tx["transaction"]["message"]["instructions"][0]["data"])
        two_signatures = bytes([2]) + good[1:]
        with self.assertRaises(exp.DecodeError):
            exp.decode_precompile(two_signatures)
        short_message = good[:12] + (140).to_bytes(2, "little") + good[14:]
        with self.assertRaises(exp.DecodeError):
            exp.decode_precompile(short_message)
        other_index = good[:4] + (0).to_bytes(2, "little") + good[6:]
        with self.assertRaises(exp.DecodeError):
            exp.decode_precompile(other_index)
        with self.assertRaises(exp.DecodeError):
            exp.decode_precompile(good[:15])

    def test_redeem_without_the_precompile_before_it_is_refused(self):
        tx = copy.deepcopy(FIX["transactions"][IPHONE_SETTLED])
        tx["transaction"]["message"]["instructions"].pop(0)
        with self.assertRaises(exp.DecodeError):
            exp.extract_redeems(tx, PROGRAM)

    def test_base58_round_trip(self):
        raw = exp.b58decode(IPHONE_SETTLED)
        self.assertEqual(len(raw), 64)
        self.assertEqual(exp.b58encode(raw), IPHONE_SETTLED)
        self.assertEqual(exp.b58encode(exp.b58decode(PROGRAM)), PROGRAM)


class Confirmation(unittest.TestCase):
    def test_signed_confirmations_verify_and_match_the_chain(self):
        for signature, status, code in ((IPHONE_SETTLED, 1, 0), (IPHONE_REFUSED, 2, exp.SERIAL_USED)):
            row = redeem(signature)
            body = FIX["notes"][row["note_id"]]
            conf = exp.decode_conf(exp.b64url_decode(body["conf"]), SERVER_KEY)
            self.assertTrue(conf["verified"])
            self.assertEqual((conf["status"], conf["error_code"]), (status, code))
            self.assertEqual(conf["tx_signature"], signature)
            self.assertEqual(conf["note_id"], row["note_id"])
            self.assertEqual(conf["uploaded_at"], body["uploadedAt"])
            self.assertEqual(conf["block_time"], body["blockTime"])
            self.assertEqual(exp.attach_conf(row, {"http_status": 200, "body": body}, SERVER_KEY), [])

    def test_settle_seconds_come_from_the_signed_times(self):
        row = redeem(IPHONE_SETTLED)
        body = FIX["notes"][row["note_id"]]
        exp.attach_conf(row, {"http_status": 200, "body": body}, SERVER_KEY)
        self.assertEqual(row["settle_seconds"], body["blockTime"] - body["uploadedAt"])
        self.assertEqual(row["uploaded_at"], body["uploadedAt"])
        refused = redeem(IPHONE_REFUSED)
        exp.attach_conf(refused, {"http_status": 200, "body": FIX["notes"][refused["note_id"]]}, SERVER_KEY)
        self.assertNotIn("settle_seconds", refused)  # only settled payments have a settle time

    def test_a_tampered_confirmation_fails(self):
        row = redeem(IPHONE_SETTLED)
        body = dict(FIX["notes"][row["note_id"]])
        wire = bytearray(exp.b64url_decode(body["conf"]))
        wire[135] ^= 1  # last byte of uploaded at
        import base64
        body["conf"] = base64.urlsafe_b64encode(bytes(wire)).decode().rstrip("=")
        problems = exp.attach_conf(row, {"http_status": 200, "body": body}, SERVER_KEY)
        self.assertTrue(any("Ed25519" in p for p in problems), problems)
        self.assertNotIn("settle_seconds", row)

    def test_a_missing_note_is_a_problem_not_a_pass(self):
        row = redeem(IPHONE_SETTLED)
        self.assertNotEqual(exp.attach_conf(row, {"http_status": 404, "body": None}, SERVER_KEY), [])


class Classifier(unittest.TestCase):
    def test_settled_then_cheat(self):
        rows = exp.classify([redeem(IPHONE_SETTLED), redeem(IPHONE_REFUSED)], set())
        self.assertEqual([r["class"] for r in rows], ["settled", "refused_cheat"])
        self.assertEqual(rows[1]["cheat_of"], IPHONE_SETTLED)

    def test_a_6011_without_an_earlier_settled_note_is_failed_other(self):
        rows = exp.classify([redeem(IPHONE_REFUSED)], set())
        self.assertEqual(rows[0]["class"], "failed_other")
        self.assertIn("no earlier settled note", rows[0]["reason"])

    def test_chain_order_decides(self):
        rows = exp.classify([redeem(IPHONE_REFUSED), redeem(IPHONE_SETTLED)], set())
        self.assertEqual([r["class"] for r in rows], ["failed_other", "settled"])

    def test_the_same_note_again_is_a_duplicate_not_a_cheat(self):
        settled, again = redeem(IPHONE_SETTLED), redeem(IPHONE_REFUSED)
        again["note_id"] = settled["note_id"]
        rows = exp.classify([settled, again], set())
        self.assertEqual(rows[1]["class"], "duplicate")
        self.assertEqual(rows[1]["duplicate_of"], IPHONE_SETTLED)

    def test_other_failures_are_failed_other(self):
        row = redeem(IPHONE_REFUSED)
        row["error_code"], row["error"] = 6005, '{"InstructionError": [1, {"Custom": 6005}]}'
        self.assertEqual(exp.classify([row], set())[0]["class"], "failed_other")

    def test_counts_exclude_cheats_and_excluded_payers(self):
        rows = exp.classify([redeem(TEST_SETTLED), redeem(TEST_REFUSED), redeem(IPHONE_SETTLED),
                             redeem(IPHONE_REFUSED)], {redeem(TEST_SETTLED)["payer_key_hash"]})
        for row in rows:
            row["in_window"] = True
        self.assertEqual([r["excluded"] for r in rows], [True, True, False, False])
        counts = exp.count_window(rows)
        self.assertEqual((counts["payments_reached_chain"], counts["payments_settled"], counts["refused_cheats"]),
                         (1, 1, 1))
        rows[2]["in_window"] = False
        self.assertEqual(exp.count_window(rows)["payments_settled"], 0)


class Helpers(unittest.TestCase):
    def test_percentile_matches_postgres_percentile_cont(self):
        self.assertEqual(exp.percentile_cont([4, 1, 3, 2], 0.5), 2.5)
        self.assertAlmostEqual(exp.percentile_cont([1, 2, 3, 4], 0.95), 3.85)
        self.assertEqual(exp.percentile_cont([7], 0.95), 7)
        self.assertIsNone(exp.percentile_cont([], 0.5))

    def test_times(self):
        want = int(dt.datetime(2026, 10, 10, 20, 15, tzinfo=dt.timezone.utc).timestamp())
        self.assertEqual(exp.parse_when("2026-10-10 16:15", 0), want)  # no offset means US Eastern (EDT)
        self.assertEqual(exp.parse_when("2026-10-10T16:15:00-04:00", 0), want)
        self.assertEqual(exp.parse_when(str(want), 0), want)
        self.assertEqual(exp.parse_when("now", want + 5.7), want + 5)

    def test_error_parsing(self):
        self.assertEqual(exp.chain_error(None), (None, None))
        self.assertEqual(exp.chain_error({"InstructionError": [1, {"Custom": 6011}]})[0], 6011)
        self.assertIsNone(exp.chain_error({"InstructionError": [0, "InvalidAccountData"]})[0])


class EndToEnd(unittest.TestCase):
    """main() with the network replaced by the fixtures."""

    def listing(self, signatures):
        out = []
        for signature in signatures:
            tx = FIX["transactions"][signature]
            out.append({"signature": signature, "slot": tx["slot"], "blockTime": tx["blockTime"], "err": tx["meta"]["err"]})
        return sorted(out, key=lambda s: -s["slot"])

    def run_main(self, argv, listing, attempts=None, fmt="csv"):
        """attempts: attempt-log rows; by default both iPhone fixture payments, logged by note id with
        airplane_mode y (the tool refuses to count without a log)."""
        if attempts is None:
            attempts = [log_row(IPHONE_SETTLED), log_row(IPHONE_REFUSED)]
        argv = argv + ["--attempt-log", write_log(attempts, fmt)]
        notes = FIX["notes"]
        out = tempfile.mkdtemp()
        json_out, md_out = os.path.join(out, "draft.json"), os.path.join(out, "draft.md")
        with mock.patch.object(exp.Rpc, "signatures", lambda self, address, before=None, limit=1000: listing), \
                mock.patch.object(exp.Rpc, "transaction", lambda self, s: copy.deepcopy(FIX["transactions"][s])), \
                mock.patch.object(exp, "fetch_note", lambda api, note_id, log: {
                    "http_status": 200 if note_id in notes else 404, "body": notes.get(note_id)}):
            with contextlib.redirect_stdout(io.StringIO()):
                code = exp.main(argv + ["--json-out", json_out, "--md-out", md_out, "--rpc-delay", "0"],
                                now=FIX["transactions"][IPHONE_REFUSED]["blockTime"] + 60, log=lambda m: None)
        report = md = None
        if os.path.exists(json_out):
            with open(json_out) as fh:
                report = json.load(fh)
        if os.path.exists(md_out):
            with open(md_out) as fh:
                md = fh.read()
        return code, report, md

    def test_window_with_the_iphone_pair(self):
        start = FIX["transactions"][IPHONE_SETTLED]["blockTime"] - 60
        code, report, md = self.run_main(["--from", str(start)], self.listing(
            [TEST_SETTLED, TEST_REFUSED, IPHONE_SETTLED, IPHONE_REFUSED]))
        self.assertEqual(code, 0, report and report["checks"])
        c = report["counts"]
        self.assertEqual((c["payments_reached_chain"], c["payments_settled"], c["refused_cheats"]), (1, 1, 1))
        self.assertEqual(c["settle_seconds"]["n"], 1)
        self.assertEqual({p["signature"] for p in report["payments"] if p["in_window"]}, {IPHONE_SETTLED, IPHONE_REFUSED})
        self.assertEqual(len(report["signatures"]), 4)  # every listed signature is in the JSON
        self.assertIn(exp.EXPLORER % IPHONE_SETTLED, md)
        self.assertIn("--from %d" % start, report["recompute"])

    def test_a_cheat_whose_original_settled_before_the_window_is_still_a_cheat(self):
        start = FIX["transactions"][IPHONE_REFUSED]["blockTime"] - 60  # after the 4:23 PM settle
        code, report, _ = self.run_main(["--from", str(start)], self.listing([IPHONE_SETTLED, IPHONE_REFUSED]))
        self.assertEqual(code, 0, report and report["checks"])
        cheat = next(p for p in report["payments"] if p["signature"] == IPHONE_REFUSED)
        self.assertEqual((cheat["class"], cheat["cheat_of"]), ("refused_cheat", IPHONE_SETTLED))
        self.assertEqual(report["counts"]["payments_reached_chain"], 0)

    def test_an_empty_window_fails_the_floor(self):
        start = FIX["transactions"][IPHONE_REFUSED]["blockTime"] + 10
        code, report, md = self.run_main(["--from", str(start)], self.listing([IPHONE_SETTLED, IPHONE_REFUSED]))
        self.assertEqual(code, 2)
        self.assertTrue(any(p.startswith("floor:") for p in report["checks"]["problems"]))
        self.assertIn("Checks FAILED", md)

    def test_a_listing_that_never_reaches_the_window_start_fails_coverage(self):
        start = FIX["transactions"][IPHONE_SETTLED]["blockTime"] - 60
        later = start + 10 ** 6  # far after the window and the settle margin, so nothing is fetched
        page = [{"signature": "1" * 64 + str(i), "slot": 1, "blockTime": later, "err": None} for i in range(1000)]
        code, report, _ = self.run_main(["--from", str(start), "--max-pages", "1"], page)
        self.assertEqual(code, 2)
        self.assertTrue(any(p.startswith("coverage:") for p in report["checks"]["problems"]), report["checks"])

    def test_the_test_key_is_excluded_even_without_a_confirmation(self):
        # The 2:01 AM notes have no record on the notes API (fixture notes hold only the iPhone pair).
        start = FIX["transactions"][TEST_SETTLED]["blockTime"] - 60
        code, report, _ = self.run_main(
            ["--from", str(start), "--to", str(start + 600)], self.listing([TEST_SETTLED, TEST_REFUSED]))
        self.assertEqual(code, 2)  # only the floor fails: nothing countable in the window
        self.assertEqual([p.split(":")[0] for p in report["checks"]["problems"]], ["floor"])
        self.assertTrue(all(p["excluded"] for p in report["payments"]))
        self.assertEqual([p["class"] for p in report["payments"]], ["settled", "refused_cheat"])

    def test_a_failed_fetch_writes_nothing(self):
        def boom(self, address, before=None, limit=1000):
            raise exp.FetchError("rpc getSignaturesForAddress: HTTP 503")
        out = tempfile.mkdtemp()
        json_out = os.path.join(out, "draft.json")
        with mock.patch.object(exp.Rpc, "signatures", boom), \
                mock.patch.object(exp.Rpc, "transaction", lambda self, s: copy.deepcopy(FIX["transactions"][s])):
            code = exp.main(["--from", "1791663300", "--to", "1791668437", "--json-out", json_out,
                             "--md-out", os.path.join(out, "draft.md"),
                             "--attempt-log", write_log([log_row(IPHONE_SETTLED)])], now=1791668437, log=lambda m: None)
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(json_out))


class AttemptLog(unittest.TestCase):
    """Counting is opt-in: only redeems that match an attempt-log row with airplane_mode y count."""

    PAIR = [IPHONE_SETTLED, IPHONE_REFUSED]
    listing = EndToEnd.listing  # the same fixture harness, without running EndToEnd's tests twice
    run_main = EndToEnd.run_main

    def start(self):
        return str(FIX["transactions"][IPHONE_SETTLED]["blockTime"] - 60)

    def test_an_unlogged_payment_is_excluded_and_listed(self):
        # The cheat is logged; the settled payment is not (a teammate's test, a rehearsal).
        code, report, md = self.run_main(["--from", self.start()], self.listing(self.PAIR),
                                         attempts=[log_row(IPHONE_REFUSED)])
        self.assertEqual(code, 0, report and report["checks"])
        c = report["counts"]
        self.assertEqual((c["payments_reached_chain"], c["payments_settled"], c["refused_cheats"]), (0, 0, 1))
        self.assertEqual(c["not_in_attempt_log"], 1)
        self.assertEqual([p["signature"] for p in report["not_in_attempt_log"]], [IPHONE_SETTLED])
        self.assertEqual(c["settled_in_window_logged_or_not"], 1)  # the server stat still sees it
        section = md.split("## Not in the attempt log, excluded")[1].split("\n## ")[0]
        self.assertIn(IPHONE_SETTLED, section)  # listed with its full signature, never dropped
        self.assertNotIn(IPHONE_REFUSED, section)
        self.assertEqual(report["per_allowance"], {})
        self.assertIn("**0 of 0 settled.**", md)

    def test_a_logged_airplane_payment_counts(self):
        code, report, md = self.run_main(["--from", self.start()], self.listing(self.PAIR),
                                         attempts=[log_row(IPHONE_SETTLED)])
        self.assertEqual(code, 0, report and report["checks"])
        c = report["counts"]
        self.assertEqual((c["payments_reached_chain"], c["payments_settled"]), (1, 1))
        self.assertEqual(c["settle_seconds"]["n"], 1)
        self.assertEqual([p["signature"] for p in report["not_in_attempt_log"]], [IPHONE_REFUSED])
        self.assertIn("matched to an on-chain payment", c["denominator"])
        self.assertIn("**1 of 1 settled.** Denominator: 1 attempt-log rows with airplane_mode y", md)
        self.assertEqual(report["tried_never_reached_chain"], [])
        settled = next(p for p in report["payments"] if p["signature"] == IPHONE_SETTLED)
        self.assertEqual((settled["log_row"], settled["airplane_mode"], settled["transport"]), (1, "y", "camera"))

    def test_a_row_without_a_note_id_matches_by_payer_serial_and_time(self):
        phone = "B=" + redeem(IPHONE_SETTLED)["payer_key_hash"]
        for shift, matched in ((exp.MATCH_SECONDS, True), (exp.MATCH_SECONDS + 1, False)):
            with self.subTest(shift=shift):
                code, report, _ = self.run_main(
                    ["--from", self.start(), "--phone", phone], self.listing(self.PAIR),
                    attempts=[log_row(IPHONE_SETTLED, by_note_id=False, shift=-shift), log_row(IPHONE_REFUSED)])
                self.assertEqual(report["counts"]["payments_settled"], 1 if matched else 0)
                self.assertEqual(len(report["tried_never_reached_chain"]), 0 if matched else 1)
                self.assertEqual(code, 0, report["checks"])
                self.assertIn("--phone " + phone, report["recompute"])

    def test_a_logged_wifi_payment_is_excluded_from_the_headline(self):
        code, report, md = self.run_main(["--from", self.start()], self.listing(self.PAIR),
                                         attempts=[log_row(IPHONE_SETTLED, airplane="n"), log_row(IPHONE_REFUSED)],
                                         fmt="json")
        self.assertEqual(code, 0, report and report["checks"])
        c = report["counts"]
        self.assertEqual((c["payments_reached_chain"], c["payments_settled"], c["refused_cheats"]), (0, 0, 1))
        self.assertEqual(c["logged_airplane_n"], 1)
        self.assertEqual(c["not_in_attempt_log"], 0)
        self.assertEqual([p["signature"] for p in report["logged_airplane_n"]], [IPHONE_SETTLED])
        self.assertIn(IPHONE_SETTLED, md.split("## In the attempt log with airplane_mode n")[1].split("\n## ")[0])

    def test_a_logged_try_with_no_chain_match_is_listed_as_never_reached(self):
        lost = log_row(IPHONE_SETTLED)
        lost["note_id"] = "ab" * 32  # a note that never reached Solana
        code, report, md = self.run_main(["--from", self.start()], self.listing(self.PAIR),
                                         attempts=[lost, log_row(IPHONE_REFUSED)])
        self.assertEqual(code, 0, report and report["checks"])
        self.assertEqual([a["row"] for a in report["tried_never_reached_chain"]], [1])
        self.assertEqual(report["counts"]["tried_never_reached_chain"], 1)
        self.assertEqual(report["counts"]["payments_settled"], 0)
        self.assertIn("`abababababababab`", md.split("## Tried, never reached the chain")[1].split("\n## ")[0])

    def test_running_without_a_log_refuses(self):
        out = tempfile.mkdtemp()
        json_out, md_out = os.path.join(out, "draft.json"), os.path.join(out, "draft.md")
        said, listing = [], self.listing(self.PAIR)
        # The network is faked with the fixtures, so a regression that counts without a log exits 0 here.
        with mock.patch.object(exp.Rpc, "signatures", lambda rpc, address, before=None, limit=1000: listing), \
                mock.patch.object(exp.Rpc, "transaction", lambda rpc, s: copy.deepcopy(FIX["transactions"][s])), \
                mock.patch.object(exp, "fetch_note", lambda api, note_id, log: {
                    "http_status": 200, "body": FIX["notes"].get(note_id)}):
            code = exp.main(["--from", self.start(), "--json-out", json_out, "--md-out", md_out, "--rpc-delay", "0"],
                            now=FIX["transactions"][IPHONE_REFUSED]["blockTime"] + 60, log=said.append)
        self.assertEqual(code, 64)
        self.assertFalse(os.path.exists(json_out) or os.path.exists(md_out))
        self.assertTrue(any("--attempt-log is required" in m for m in said), said)

    def test_a_malformed_log_refuses(self):
        bad = log_row(IPHONE_SETTLED)
        bad["airplane_mode"] = "maybe"
        with self.assertRaises(exp.LogError) as caught:
            exp.load_attempt_log(write_log([bad]), 0)
        self.assertIn("write y or n", str(caught.exception))
        code, report, _ = self.run_main(["--from", self.start()], self.listing(self.PAIR), attempts=[bad])
        self.assertEqual((code, report), (64, None))


if __name__ == "__main__":
    unittest.main()
