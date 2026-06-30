import os
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


@app.get("/health")
def health(x_email_bridge_token: str | None = Header(default=None)) -> dict[str, Any]:
    verify_token(x_email_bridge_token)
    return {
        "status": "ok",
        "service": "email-bridge",
        "smtp_configured": bool(os.getenv("SMTP_HOST") and smtp_from_address()),
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

    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    starttls = os.getenv("SMTP_STARTTLS", "true").lower() not in {"0", "false", "no"}
    from_address = smtp_from_address()
    from_name = os.getenv("SMTP_FROM_NAME", "ТОО Michael").strip()

    if not smtp_host:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="SMTP_HOST не задан.")
    if not from_address:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="SMTP_FROM или SMTP_USER не задан.")

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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"SMTP не отправил письмо: {exc}",
        ) from exc

    return {"sent": True, "status": "sent", "to": to_address, "detail": "Письмо отправлено."}


def verify_token(value: str | None) -> None:
    expected = os.getenv("EMAIL_BRIDGE_TOKEN", "").strip()
    if expected and value != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный email bridge token.")


def smtp_from_address() -> str:
    return (os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "").strip()
