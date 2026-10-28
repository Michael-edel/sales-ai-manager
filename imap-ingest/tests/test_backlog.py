import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from app import main


class FakeImap:
    def __init__(self):
        self.selected_readonly = False
        self.fetch_queries = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def select(self, mailbox, readonly=False):
        self.selected_readonly = readonly
        return "OK", []

    def uid(self, command, uid, query):
        self.fetch_queries.append((command, uid, query))
        return "OK", [(b"header", b"From: client@example.com\r\n\r\nRequest")]


class BacklogTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / "state.sqlite3"
        main.ensure_state_db(self.state)
        self.config = main.Config(
            imap_host="mail.example.com", imap_port=143, imap_ssl=False,
            imap_starttls=True, imap_username="manager@edel.kz", imap_password="test-only",
            imap_mailbox="INBOX", imap_search="ALL", max_messages_per_poll=25,
            poll_interval_seconds=60, state_db=self.state,
            worker_ingest_url="https://example.com/api/email/ingest", email_ingest_token="test-only",
            mailbox_name="Test", michael_manager="", attachment_text_max_chars=1000,
            attachment_binary_max_bytes=1024, attachment_total_max_bytes=2048,
        )

    def seed(self, uids):
        for uid in uids:
            main.mark_ingested(self.state, self.config.imap_username, "validity", str(uid), f"uid-{uid}")

    def poll(self, uids, accepted=True):
        client = FakeImap()
        submitted = []

        def build_payload(config, uidvalidity, uid, raw):
            return {"message_uid": uid}

        def post(config, payload):
            submitted.append(payload["message_uid"])
            return {"ok": accepted}

        with patch.object(main, "connect_imap", return_value=client), \
             patch.object(main, "get_uidvalidity", return_value="validity"), \
             patch.object(main, "search_uids", return_value=[str(uid) for uid in uids]), \
             patch.object(main, "build_ingest_payload", side_effect=build_payload), \
             patch.object(main, "post_to_worker", side_effect=post):
            summary = main.run_once(self.config)
        self.assertTrue(client.selected_readonly)
        self.assertTrue(all(command == "FETCH" and query == "(BODY.PEEK[])"
                            for command, uid, query in client.fetch_queries))
        return summary, submitted

    def test_drains_old_backlog_when_latest_window_already_ingested(self):
        self.seed(range(41, 81))
        first, submitted = self.poll(range(1, 81))
        self.assertEqual(submitted, [str(uid) for uid in range(40, 15, -1)])
        self.assertEqual(first, {"found": 80, "skipped": 40, "ingested": 25, "errors": 0})
        second, submitted = self.poll(range(1, 81))
        self.assertEqual(submitted, [str(uid) for uid in range(15, 0, -1)])
        self.assertEqual(second["ingested"], 15)
        third, submitted = self.poll(range(1, 81))
        self.assertEqual(submitted, [])
        self.assertEqual(third["skipped"], 80)

    def test_failed_posts_are_bounded_and_retried_without_marking_ingested(self):
        self.config = replace(self.config, max_messages_per_poll=2)
        failed, submitted = self.poll(range(1, 7), accepted=False)
        self.assertEqual(submitted, ["6", "5"])
        self.assertEqual(failed["errors"], 2)
        self.assertFalse(main.was_ingested(self.state, self.config.imap_username, "validity", "6"))
        retried, submitted = self.poll(range(1, 7))
        self.assertEqual(submitted, ["6", "5"])
        self.assertEqual(retried["ingested"], 2)


if __name__ == "__main__":
    unittest.main()
