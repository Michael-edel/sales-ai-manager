import json
import logging
import os
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from typing import Any

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel


app = FastAPI(title="Sales AI Manager Email Bridge")


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    from_address: str | None = None


@app.get("/health")
def health(x_email_bridge_token: str | None = Header(default=None)) -> dict[str, Any]:
    verify_token(x_email_bridge_token)
    return {
        "status": "ok",
        "service": "email-bridge",
        "smtp_configured": smtp_accounts_count() > 0,
        "smtp_accounts_count": smtp_accounts_count(),
    }


@app.post("/send")
def send_email(
    payload: SendEmailRequest,
    x_email_bridge_token: str | None = Header(default=None),
) -> dict[str, Any]:
    verify_token(x_email_bridge_token)
    to_address = payload.to.strip()
    subject = payload.subject.strip()
    body = payload.body.strip()
    if not to_address or "@" not in to_address:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный email получателя.")
    if not subject:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Тема письма пустая.")
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Текст письма пустой.")

    account = resolve_smtp_account(payload.from_address)
    smtp_host = str(account["host"])
    smtp_port = int(account["port"])
    smtp_user = str(account["username"])
    smtp_password = str(account["password"])
    starttls = bool(account["starttls"])
    from_address = str(account["from_address"])
    from_name = str(account["from_name"])

    message = EmailMessage()
    message["From"] = f"{from_name} <{from_address}>" if from_name else from_address
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=25) as smtp:
            if starttls:
                smtp.starttls(context=ssl.create_default_context())
            if smtp_user:
                smtp.login(smtp_user, smtp_password)
            smtp.send_message(message)
    except Exception as exc:
        logging.exception("SMTP send failed for mailbox %s", from_address)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="SMTP не отправил письмо. Проверьте учетную запись и журнал email-bridge.",
        ) from exc

    return {
        "sent": True,
        "status": "sent",
        "to": to_address,
        "from_address": from_address,
        "detail": "Письмо отправлено.",
    }


def verify_token(value: str | None) -> None:
    expected = os.getenv("EMAIL_BRIDGE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email bridge token не настроен.",
        )
    if value is None or not secrets.compare_digest(value, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный email bridge token.")


def smtp_from_address() -> str:
    return (os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "").strip()


def smtp_accounts_count() -> int:
    return len(load_smtp_accounts()) + (1 if global_smtp_account() else 0)


def resolve_smtp_account(requested_address: str | None) -> dict[str, object]:
    requested = (requested_address or "").strip().lower()
    if requested and ("@" not in requested or not requested.endswith("@edel.kz")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Разрешена отправка только с ящика @edel.kz.")

    accounts = load_smtp_accounts()
    if requested and requested in accounts:
        return normalize_smtp_account(requested, accounts[requested])

    fallback = global_smtp_account()
    if fallback and (not requested or requested == str(fallback["from_address"]).lower()):
        return fallback

    if requested:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Отправка с этого ящика не настроена в email-bridge.",
        )
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="SMTP-аккаунты не настроены.")


def load_smtp_accounts() -> dict[str, dict[str, object]]:
    raw = os.getenv("SMTP_ACCOUNTS_JSON", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMTP_ACCOUNTS_JSON содержит некорректный JSON.",
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="SMTP_ACCOUNTS_JSON должен быть объектом.")
    return {
        str(address).strip().lower(): value
        for address, value in data.items()
        if isinstance(value, dict)
    }


def normalize_smtp_account(address: str, value: dict[str, object]) -> dict[str, object]:
    host = str(value.get("host") or os.getenv("SMTP_HOST") or "").strip()
    username = str(value.get("username") or address).strip()
    password = str(value.get("password") or "")
    if not host or not username or not password:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"SMTP-аккаунт {address} настроен не полностью.",
        )
    return {
        "host": host,
        "port": int(value.get("port") or os.getenv("SMTP_PORT") or 587),
        "username": username,
        "password": password,
        "starttls": value.get("starttls", True) not in {False, 0, "0", "false", "no"},
        "from_address": address,
        "from_name": str(value.get("from_name") or os.getenv("SMTP_FROM_NAME") or "ТОО Michael").strip(),
    }


def global_smtp_account() -> dict[str, object] | None:
    address = smtp_from_address().lower()
    host = os.getenv("SMTP_HOST", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    if not address or not host or not password:
        return None
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587")),
        "username": os.getenv("SMTP_USER", "").strip() or address,
        "password": password,
        "starttls": os.getenv("SMTP_STARTTLS", "true").lower() not in {"0", "false", "no"},
        "from_address": address,
        "from_name": os.getenv("SMTP_FROM_NAME", "ТОО Michael").strip(),
    }
