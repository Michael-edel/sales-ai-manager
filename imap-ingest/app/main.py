from __future__ import annotations

import argparse
import email
import imaplib
import json
import os
import re
import sqlite3
import ssl
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.utils import getaddresses, parsedate_to_datetime
from html import unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


HTML_STYLE_RE = re.compile(r"<style[\s\S]*?</style>", re.IGNORECASE)
HTML_SCRIPT_RE = re.compile(r"<script[\s\S]*?</script>", re.IGNORECASE)
HTML_TAG_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class Config:
    imap_host: str
    imap_port: int
    imap_ssl: bool
    imap_starttls: bool
    imap_username: str
    imap_password: str
    imap_mailbox: str
    imap_search: str
    max_messages_per_poll: int
    poll_interval_seconds: int
    state_db: Path
    worker_ingest_url: str
    email_ingest_token: str
    mailbox_name: str
    michael_manager: str
    attachment_text_max_chars: int


def main() -> int:
    base_dir = Path(__file__).resolve().parents[1]
    load_dotenv(base_dir / ".env")

    parser = argparse.ArgumentParser(description="Read direktor@edel.kz through IMAP and ingest mail into sales-ai-manager.")
    parser.add_argument("--once", action="store_true", help="Run one poll and exit.")
    args = parser.parse_args()

    config = load_config(base_dir)
    ensure_state_db(config.state_db)

    if args.once:
        summary = run_once(config)
        print(format_summary(summary))
        return 0

    print("IMAP ingest started. Press Ctrl+C to stop.")
    while True:
        try:
            summary = run_once(config)
            print(format_summary(summary))
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
        time.sleep(config.poll_interval_seconds)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def load_config(base_dir: Path) -> Config:
    state_db = Path(getenv("STATE_DB", "imap_ingest_state.sqlite3"))
    if not state_db.is_absolute():
        state_db = base_dir / state_db

    return Config(
        imap_host=require_env("IMAP_HOST"),
        imap_port=getenv_int("IMAP_PORT", 143),
        imap_ssl=getenv_bool("IMAP_SSL", False),
        imap_starttls=getenv_bool("IMAP_STARTTLS", True),
        imap_username=require_env("IMAP_USERNAME"),
        imap_password=require_env("IMAP_PASSWORD"),
        imap_mailbox=getenv("IMAP_MAILBOX", "INBOX"),
        imap_search=getenv("IMAP_SEARCH", "ALL"),
        max_messages_per_poll=getenv_int("MAX_MESSAGES_PER_POLL", 25),
        poll_interval_seconds=getenv_int("POLL_INTERVAL_SECONDS", 60),
        state_db=state_db,
        worker_ingest_url=require_env("WORKER_INGEST_URL"),
        email_ingest_token=require_env("EMAIL_INGEST_TOKEN"),
        mailbox_name=getenv("MAILBOX_NAME", "direktor@edel.kz mailcow"),
        michael_manager=getenv("MICHAEL_MANAGER", ""),
        attachment_text_max_chars=getenv_int("ATTACHMENT_TEXT_MAX_CHARS", 60000),
    )


def require_env(name: str) -> str:
    value = getenv(name, "")
    if not value or value.startswith("change-this"):
        raise SystemExit(f"{name} is required. Fill imap-ingest/.env first.")
    return value


def getenv(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def getenv_bool(name: str, default: bool) -> bool:
    value = getenv(name, str(default)).lower()
    return value in {"1", "true", "yes", "y", "on"}


def getenv_int(name: str, default: int) -> int:
    value = getenv(name, str(default))
    try:
        return int(value)
    except ValueError:
        return default


def ensure_state_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingested_messages (
              mailbox_email TEXT NOT NULL,
              uidvalidity TEXT NOT NULL,
              uid TEXT NOT NULL,
              message_uid TEXT NOT NULL,
              ingested_at TEXT NOT NULL,
              PRIMARY KEY (mailbox_email, uidvalidity, uid)
            )
            """
        )


def run_once(config: Config) -> dict[str, int]:
    summary = {"found": 0, "skipped": 0, "ingested": 0, "errors": 0}
    with connect_imap(config) as client:
        status, _ = client.select(config.imap_mailbox, readonly=True)
        require_ok(status, f"select {config.imap_mailbox}")
        uidvalidity = get_uidvalidity(client)
        uids = search_uids(client, config.imap_search)
        summary["found"] = len(uids)

        for uid in uids[-config.max_messages_per_poll:]:
            if was_ingested(config.state_db, config.imap_username, uidvalidity, uid):
                summary["skipped"] += 1
                continue

            try:
                raw_message = fetch_raw_message(client, uid)
                payload = build_ingest_payload(config, uidvalidity, uid, raw_message)
                result = post_to_worker(config, payload)
                if result.get("ok"):
                    mark_ingested(config.state_db, config.imap_username, uidvalidity, uid, payload["message_uid"])
                    summary["ingested"] += 1
                else:
                    summary["errors"] += 1
            except Exception as exc:
                summary["errors"] += 1
                print(f"ERROR uid={uid}: {exc}", file=sys.stderr)

    return summary


def connect_imap(config: Config):
    if config.imap_ssl:
        client = imaplib.IMAP4_SSL(config.imap_host, config.imap_port, timeout=30)
    else:
        client = imaplib.IMAP4(config.imap_host, config.imap_port, timeout=30)
        if config.imap_starttls:
            client.starttls(ssl.create_default_context())
    status, _ = client.login(config.imap_username, config.imap_password)
    require_ok(status, "login")
    return client


def require_ok(status: str, action: str) -> None:
    if status.upper() != "OK":
        raise RuntimeError(f"IMAP {action} failed: {status}")


def get_uidvalidity(client: imaplib.IMAP4) -> str:
    _, values = client.response("UIDVALIDITY")
    if values and values[0]:
        return decode_bytes(values[0])
    return "unknown"


def search_uids(client: imaplib.IMAP4, criterion: str) -> list[str]:
    parts = tuple(part for part in criterion.split() if part)
    status, data = client.uid("SEARCH", None, *(parts or ("ALL",)))
    require_ok(status, f"search {criterion}")
    if not data or not data[0]:
        return []
    return [decode_bytes(uid) for uid in data[0].split()]


def fetch_raw_message(client: imaplib.IMAP4, uid: str) -> bytes:
    status, data = client.uid("FETCH", uid, "(BODY.PEEK[])")
    require_ok(status, f"fetch {uid}")
    for item in data:
        if isinstance(item, tuple) and item[1]:
            return item[1]
    raise RuntimeError(f"Empty IMAP response for uid {uid}")


def build_ingest_payload(config: Config, uidvalidity: str, uid: str, raw_message: bytes) -> dict[str, object]:
    msg = email.message_from_bytes(raw_message, policy=policy.default)
    if not isinstance(msg, EmailMessage):
        raise RuntimeError("Unable to parse message as EmailMessage")

    body_text = extract_body_text(msg)
    attachment_names, attachment_text = extract_attachments(msg, config.attachment_text_max_chars)
    message_uid = f"imap:{config.imap_username}:{config.imap_mailbox}:{uidvalidity}:{uid}"

    return {
        "mailbox_name": config.mailbox_name,
        "mailbox_email": config.imap_username,
        "michael_manager": config.michael_manager,
        "message_uid": message_uid,
        "from_address": normalize_addresses(msg.get("from")),
        "to_address": normalize_addresses(msg.get("to")),
        "subject": str(msg.get("subject") or "Без темы"),
        "body_text": body_text,
        "attachment_names": attachment_names,
        "attachment_text": attachment_text,
        "received_at": normalize_message_date(msg.get("date")),
    }


def extract_body_text(msg: EmailMessage) -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []

    for part in msg.walk():
        if part.is_multipart():
            continue
        if part.get_content_disposition() == "attachment":
            continue
        content_type = part.get_content_type()
        try:
            content = part.get_content()
        except Exception:
            continue
        if not isinstance(content, str):
            continue
        if content_type == "text/plain":
            plain_parts.append(content.strip())
        elif content_type == "text/html":
            html_parts.append(html_to_text(content))

    text = "\n\n".join(part for part in plain_parts if part).strip()
    if text:
        return text
    return "\n\n".join(part for part in html_parts if part).strip()


def extract_attachments(msg: EmailMessage, max_chars: int) -> tuple[list[str], str]:
    names: list[str] = []
    text_parts: list[str] = []
    current_chars = 0

    for part in msg.walk():
        if part.is_multipart():
            continue
        filename = part.get_filename()
        disposition = part.get_content_disposition()
        if not filename and disposition != "attachment":
            continue

        display_name = filename or "attachment"
        names.append(display_name)

        content_type = part.get_content_type()
        if content_type not in {"text/plain", "text/csv", "text/html"}:
            continue

        try:
            content = part.get_content()
        except Exception:
            continue
        if not isinstance(content, str):
            continue

        text = html_to_text(content) if content_type == "text/html" else content.strip()
        if not text:
            continue

        remaining = max_chars - current_chars
        if remaining <= 0:
            break
        clipped = text[:remaining]
        text_parts.append(f"Вложение {display_name}:\n{clipped}")
        current_chars += len(clipped)

    return names, "\n\n".join(text_parts).strip()


def normalize_addresses(value: object) -> str:
    if not value:
        return ""
    addresses = []
    for name, address in getaddresses([str(value)]):
        item = address or name
        if item:
            addresses.append(item)
    return ", ".join(addresses)


def normalize_message_date(value: object) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    try:
        parsed = parsedate_to_datetime(str(value))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except Exception:
        return str(value)


def html_to_text(value: str) -> str:
    text = HTML_STYLE_RE.sub(" ", value)
    text = HTML_SCRIPT_RE.sub(" ", text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = HTML_TAG_RE.sub(" ", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    return text.strip()


def post_to_worker(config: Config, payload: dict[str, object]) -> dict[str, object]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        config.worker_ingest_url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {config.email_ingest_token}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "sales-ai-manager-imap-ingest/1.0",
        },
    )
    try:
        with urlopen(request, timeout=45) as response:
            response_body = response.read().decode("utf-8")
            return json.loads(response_body) if response_body else {"ok": True}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Worker HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Worker connection error: {exc}") from exc


def was_ingested(path: Path, mailbox_email: str, uidvalidity: str, uid: str) -> bool:
    with sqlite3.connect(path) as conn:
        row = conn.execute(
            """
            SELECT 1 FROM ingested_messages
            WHERE mailbox_email = ? AND uidvalidity = ? AND uid = ?
            """,
            (mailbox_email, uidvalidity, uid),
        ).fetchone()
    return row is not None


def mark_ingested(path: Path, mailbox_email: str, uidvalidity: str, uid: str, message_uid: object) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ingested_messages (
              mailbox_email, uidvalidity, uid, message_uid, ingested_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (mailbox_email, uidvalidity, uid, str(message_uid), datetime.now(timezone.utc).isoformat()),
        )


def decode_bytes(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def format_summary(summary: dict[str, int]) -> str:
    return (
        f"found={summary['found']} "
        f"skipped={summary['skipped']} "
        f"ingested={summary['ingested']} "
        f"errors={summary['errors']}"
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Stopped.")
        raise SystemExit(0)
