import json

import pytest
from fastapi import HTTPException

from app.main import resolve_smtp_account


def test_resolves_requested_edel_mailbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SMTP_HOST", "smtp.edel.kz")
    monkeypatch.setenv(
        "SMTP_ACCOUNTS_JSON",
        json.dumps({"manager@edel.kz": {"password": "secret", "from_name": "Manager"}}),
    )

    account = resolve_smtp_account("Manager@edel.kz")

    assert account["from_address"] == "manager@edel.kz"
    assert account["username"] == "manager@edel.kz"
    assert account["host"] == "smtp.edel.kz"


def test_rejects_external_sender(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SMTP_ACCOUNTS_JSON", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        resolve_smtp_account("attacker@example.com")

    assert exc_info.value.status_code == 400


def test_does_not_fall_back_to_another_mailbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SMTP_HOST", "smtp.edel.kz")
    monkeypatch.setenv("SMTP_FROM", "direktor@edel.kz")
    monkeypatch.setenv("SMTP_USER", "direktor@edel.kz")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")

    with pytest.raises(HTTPException) as exc_info:
        resolve_smtp_account("manager@edel.kz")

    assert exc_info.value.status_code == 400
