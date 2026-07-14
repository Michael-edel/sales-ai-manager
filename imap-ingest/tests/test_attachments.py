import base64
from email.message import EmailMessage

from app.main import extract_attachments


def build_message() -> EmailMessage:
    message = EmailMessage()
    message["From"] = "client@example.com"
    message["To"] = "manager@edel.kz"
    message["Subject"] = "Request"
    message.set_content("Body")
    message.add_attachment(b"pdf-data", maintype="application", subtype="pdf", filename="request.pdf")
    message.add_attachment("notes", subtype="plain", filename="notes.txt")
    return message


def test_extracts_supported_binary_and_text_attachments() -> None:
    names, text, attachments = extract_attachments(build_message(), 1000, 1024, 2048)

    assert names == ["request.pdf", "notes.txt"]
    assert "notes" in text
    assert len(attachments) == 1
    assert attachments[0]["filename"] == "request.pdf"
    assert base64.b64decode(str(attachments[0]["content_base64"])) == b"pdf-data"


def test_skips_binary_attachment_over_limit_but_keeps_name() -> None:
    names, _, attachments = extract_attachments(build_message(), 1000, 2, 2048)

    assert "request.pdf" in names
    assert attachments == []
