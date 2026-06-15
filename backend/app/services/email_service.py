import imaplib
from datetime import datetime
from email import message_from_bytes
from email.header import decode_header
from email.message import Message
from email.utils import parsedate_to_datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import MailAccount, get_settings
from app.models import EmailMessage
from app.services.file_parser import DOCUMENT_EXTENSIONS, extract_text_from_document_bytes


def fetch_new_emails(db: Session, limit: int = 20) -> tuple[int, int, int]:
    settings = get_settings()
    accounts = settings.mail_account_list
    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="IMAP не настроен. Укажите MAIL_ACCOUNTS в .env.",
        )

    imported = 0
    skipped = 0
    total_seen = 0

    errors: list[str] = []
    for account in accounts:
        try:
            account_imported, account_skipped, account_total = _fetch_account_emails(db, account, limit)
            imported += account_imported
            skipped += account_skipped
            total_seen += account_total
        except Exception as exc:
            errors.append(f"{account.email}: {exc}")

    if errors and imported == 0 and total_seen == 0:
        raise HTTPException(status_code=502, detail=f"Не удалось проверить почту: {'; '.join(errors)}")

    return imported, skipped, total_seen


def _fetch_account_emails(db: Session, account: MailAccount, limit: int) -> tuple[int, int, int]:
    imported = 0
    skipped = 0
    total_seen = 0

    if not account.imap_host:
        raise RuntimeError("не указан IMAP host")

    with imaplib.IMAP4_SSL(account.imap_host, account.imap_port) as mailbox:
        mailbox.login(account.email, account.password)
        status_code, _ = mailbox.select(account.imap_folder)
        if status_code != "OK":
            raise RuntimeError(f"не удалось открыть IMAP-папку {account.imap_folder}")

        status_code, data = mailbox.uid("search", None, "UNSEEN")
        if status_code != "OK":
            raise RuntimeError("не удалось получить список новых писем по IMAP")

        uids = data[0].split()[-limit:]
        total_seen = len(uids)
        for uid_bytes in uids:
            uid = uid_bytes.decode("ascii", errors="ignore")
            exists = (
                db.query(EmailMessage)
                .filter(EmailMessage.mailbox_email == account.email, EmailMessage.message_uid == uid)
                .first()
            )
            if exists:
                skipped += 1
                continue

            status_code, message_data = mailbox.uid("fetch", uid, "(RFC822)")
            if status_code != "OK" or not message_data:
                skipped += 1
                continue

            raw_message = _first_message_bytes(message_data)
            if raw_message is None:
                skipped += 1
                continue

            parsed = parse_email_message(uid, raw_message, account)
            db.add(parsed)
            imported += 1

        db.commit()
        mailbox.logout()

    return imported, skipped, total_seen


def parse_email_message(uid: str, raw_message: bytes, account: MailAccount) -> EmailMessage:
    msg = message_from_bytes(raw_message)
    body_parts: list[str] = []
    attachment_names: list[str] = []
    attachment_text_parts: list[str] = []

    for part in msg.walk():
        content_disposition = part.get_content_disposition()
        filename = _decode_value(part.get_filename())
        content_type = part.get_content_type()

        if filename:
            attachment_names.append(filename)
            extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            if extension in DOCUMENT_EXTENSIONS:
                payload = part.get_payload(decode=True) or b""
                if payload:
                    try:
                        extracted = extract_text_from_document_bytes(filename, payload)
                        if extracted:
                            attachment_text_parts.append(f"Вложение {filename}:\n{extracted}")
                    except HTTPException as exc:
                        attachment_text_parts.append(f"Вложение {filename}: не удалось прочитать ({exc.detail})")
            continue

        if content_disposition == "attachment":
            continue

        if content_type == "text/plain":
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                body_parts.append(payload.decode(charset, errors="replace").strip())
        elif content_type == "text/html" and not body_parts:
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                body_parts.append(_strip_html(payload.decode(charset, errors="replace")).strip())

    received_at = _parse_date(msg.get("Date"))
    return EmailMessage(
        mailbox_name=account.name,
        mailbox_email=account.email,
        michael_manager=account.michael_manager,
        message_uid=uid,
        from_address=_decode_value(msg.get("From")),
        to_address=_decode_value(msg.get("To")),
        subject=_decode_value(msg.get("Subject")),
        body_text="\n\n".join(part for part in body_parts if part).strip(),
        attachment_names="\n".join(attachment_names) if attachment_names else None,
        attachment_text="\n\n".join(attachment_text_parts) if attachment_text_parts else None,
        received_at=received_at,
    )


def _first_message_bytes(message_data) -> bytes | None:
    for item in message_data:
        if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], bytes):
            return item[1]
    return None


def _decode_value(value: str | None) -> str | None:
    if not value:
        return None
    decoded_parts = []
    for part, charset in decode_header(value):
        if isinstance(part, bytes):
            decoded_parts.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded_parts.append(part)
    return "".join(decoded_parts).strip()


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value)
    except Exception:
        return None


def _strip_html(html: str) -> str:
    import re

    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<br\s*/?>", "\n", text)
    text = re.sub(r"(?s)</p>", "\n", text)
    text = re.sub(r"(?s)<.*?>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    return text
