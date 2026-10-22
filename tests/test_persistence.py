import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from persistence import atomic_json, ingestion_lock, MAX_STATE_BYTES


class PersistenceBoundaries(unittest.TestCase):
    def test_failed_atomic_replace_preserves_exact_previous_bytes_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            target = directory / "routes.json"
            target.write_bytes(b'["https://example.test/previous"]\n')
            previous = target.read_bytes()
            with patch(
                "persistence.os.replace", side_effect=OSError("synthetic disk failure")
            ):
                with self.assertRaises(OSError):
                    atomic_json(target, ["https://example.test/new"])
            self.assertEqual(target.read_bytes(), previous)
            self.assertEqual(list(directory.iterdir()), [target])

    def test_publication_limit_rejects_without_truncating_or_replacing_old_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "routes.json"
            target.write_bytes(b"[]\n")
            with self.assertRaises(ValueError):
                atomic_json(target, "x" * MAX_STATE_BYTES)
            self.assertEqual(target.read_bytes(), b"[]\n")

    def test_process_lock_rejects_overlap_and_recovers_after_abrupt_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = f"import sys,time;sys.path.insert(0,{str(ROOT / 'src')!r});from persistence import ingestion_lock\nwith ingestion_lock({tmp!r}):\n print('LOCKED',flush=True)\n time.sleep(10)\n"
            child = subprocess.Popen(
                [sys.executable, "-c", code],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                self.assertEqual(child.stdout.readline().strip(), "LOCKED")
                with self.assertRaises(RuntimeError):
                    with ingestion_lock(tmp):
                        self.fail("Concurrent writer entered the critical section")
            finally:
                child.kill()
                child.communicate(timeout=3)
            with ingestion_lock(tmp):
                self.assertTrue((Path(tmp) / ".ingest.lock").exists())
