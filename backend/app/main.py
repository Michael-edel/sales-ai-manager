from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base, engine, get_db
from app.models import EmailMessage, SalesRequest
from app.schemas import EmailCheckResponse, EmailMessageResponse, SalesRequestResponse, TextProcessRequest
from io import BytesIO

from app.services.ai_service import analyze_image_request, analyze_request, transcribe_audio
from app.services.file_parser import (
    extract_text_from_upload,
    image_to_data_url,
    is_supported_audio,
    is_supported_image,
    read_upload_bytes,
)
from app.services.email_service import fetch_new_emails


settings = get_settings()

app = FastAPI(title="Sales AI Manager", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE requests ADD COLUMN IF NOT EXISTS client_company TEXT"))
        connection.execute(text("ALTER TABLE requests ADD COLUMN IF NOT EXISTS client_contact_name TEXT"))
        connection.execute(text("ALTER TABLE requests ADD COLUMN IF NOT EXISTS michael_manager TEXT"))
        connection.execute(text("ALTER TABLE requests ADD COLUMN IF NOT EXISTS communication_channel TEXT"))
        connection.execute(text("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS mailbox_name TEXT"))
        connection.execute(text("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS mailbox_email TEXT"))
        connection.execute(text("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS michael_manager TEXT"))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def build_context_prefix(
    client_company: str = "",
    client_contact_name: str = "",
    michael_manager: str = "",
    communication_channel: str = "",
) -> str:
    parts = [
        f"Компания клиента: {client_company.strip()}" if client_company.strip() else "",
        f"Контакт/менеджер клиента: {client_contact_name.strip()}" if client_contact_name.strip() else "",
        f"Менеджер Michael: {michael_manager.strip()}" if michael_manager.strip() else "",
        f"Канал связи: {communication_channel.strip()}" if communication_channel.strip() else "",
    ]
    context = "\n".join(part for part in parts if part)
    return f"Контекст заявки:\n{context}\n\n" if context else ""


@app.post("/api/requests/text", response_model=SalesRequestResponse)
def process_text(payload: TextProcessRequest, db: Session = Depends(get_db)) -> SalesRequest:
    original_text = payload.original_text.strip()
    if not original_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Текст заявки пустой.")

    original_text = (
        build_context_prefix(
            payload.client_company or "",
            payload.client_contact_name or "",
            payload.michael_manager or "",
            payload.communication_channel or "",
        )
        + original_text
    )
    item = SalesRequest(
        source_type="text",
        client_company=payload.client_company,
        client_contact_name=payload.client_contact_name,
        michael_manager=payload.michael_manager,
        communication_channel=payload.communication_channel,
        original_text=original_text,
        uploaded_file_name=None,
        ai_result=analyze_request(original_text),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/requests/upload", response_model=SalesRequestResponse)
async def upload_file(
    file: UploadFile = File(...),
    manager_note: str = Form(""),
    client_company: str = Form(""),
    client_contact_name: str = Form(""),
    michael_manager: str = Form(""),
    communication_channel: str = Form(""),
    db: Session = Depends(get_db),
) -> SalesRequest:
    filename = file.filename or "uploaded-file"
    context_prefix = build_context_prefix(client_company, client_contact_name, michael_manager, communication_channel)
    if is_supported_image(filename):
        content = await read_upload_bytes(file)
        original_text = f"{context_prefix}Загружено изображение для vision-анализа: {filename}"
        if manager_note.strip():
            original_text = f"{original_text}\n\nПояснение менеджера:\n{manager_note.strip()}"
        image_note = f"{context_prefix}{manager_note}".strip()
        ai_result = analyze_image_request(image_to_data_url(filename, content), filename, image_note)
        source_type = "image"
    elif is_supported_audio(filename):
        content = await read_upload_bytes(file)
        transcription = transcribe_audio(BytesIO(content), filename, manager_note)
        original_text = f"{context_prefix}Голосовое сообщение: {filename}\n\nТранскрибация:\n{transcription}"
        if manager_note.strip():
            original_text = f"{original_text}\n\nПояснение менеджера:\n{manager_note.strip()}"
        ai_result = analyze_request(original_text)
        source_type = "audio"
    else:
        extracted_text = await extract_text_from_upload(file)
        original_text = extracted_text
        if manager_note.strip():
            original_text = f"Пояснение менеджера:\n{manager_note.strip()}\n\nТекст из файла:\n{extracted_text}"
        original_text = f"{context_prefix}{original_text}"
        ai_result = analyze_request(original_text)
        source_type = "file"

    item = SalesRequest(
        source_type=source_type,
        client_company=client_company or None,
        client_contact_name=client_contact_name or None,
        michael_manager=michael_manager or None,
        communication_channel=communication_channel or None,
        original_text=original_text,
        uploaded_file_name=filename,
        ai_result=ai_result,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/requests", response_model=list[SalesRequestResponse])
def list_requests(db: Session = Depends(get_db)) -> list[SalesRequest]:
    return db.query(SalesRequest).order_by(desc(SalesRequest.created_at)).limit(100).all()


@app.get("/api/requests/{request_id}", response_model=SalesRequestResponse)
def get_request(request_id: int, db: Session = Depends(get_db)) -> SalesRequest:
    item = db.get(SalesRequest, request_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена.")
    return item


@app.post("/api/email/check", response_model=EmailCheckResponse)
def check_email(db: Session = Depends(get_db)) -> EmailCheckResponse:
    imported, skipped, total_seen = fetch_new_emails(db)
    return EmailCheckResponse(imported=imported, skipped=skipped, total_seen=total_seen)


@app.get("/api/email/messages", response_model=list[EmailMessageResponse])
def list_email_messages(db: Session = Depends(get_db)) -> list[EmailMessage]:
    return db.query(EmailMessage).order_by(desc(EmailMessage.received_at), desc(EmailMessage.created_at)).limit(100).all()


@app.post("/api/email/messages/{email_id}/process", response_model=SalesRequestResponse)
def process_email(email_id: int, db: Session = Depends(get_db)) -> SalesRequest:
    email_item = db.get(EmailMessage, email_id)
    if not email_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Письмо не найдено.")
    if email_item.processed_request_id:
        existing = db.get(SalesRequest, email_item.processed_request_id)
        if existing:
            return existing

    email_text = build_email_analysis_text(email_item)
    lowered = email_text.lower()
    client_company = "ТОО KBI Energy" if "kbi" in lowered or "кби" in lowered else None
    context = build_context_prefix(
        client_company or "",
        email_item.from_address or "",
        email_item.michael_manager or "",
        "Email",
    )
    original_text = f"{context}{email_text}"
    request_item = SalesRequest(
        source_type="email",
        client_company=client_company,
        client_contact_name=email_item.from_address,
        michael_manager=email_item.michael_manager,
        communication_channel="Email",
        original_text=original_text,
        uploaded_file_name=email_item.attachment_names,
        ai_result=analyze_request(original_text),
    )
    db.add(request_item)
    db.flush()
    email_item.processed_request_id = request_item.id
    db.commit()
    db.refresh(request_item)
    return request_item


def build_email_analysis_text(email_item: EmailMessage) -> str:
    parts = [
        "Входящее письмо из mailcow.",
        f"От: {email_item.from_address or 'уточняется'}",
        f"Кому: {email_item.to_address or 'уточняется'}",
        f"Почтовый ящик Michael: {email_item.mailbox_email or 'уточняется'}",
        f"Ответственный менеджер Michael: {email_item.michael_manager or 'уточняется'}",
        f"Тема: {email_item.subject or 'без темы'}",
        f"Дата письма: {email_item.received_at.isoformat() if email_item.received_at else 'уточняется'}",
        "",
        "Тело письма:",
        email_item.body_text or "уточняется",
    ]
    if email_item.attachment_names:
        parts.extend(["", "Вложения:", email_item.attachment_names])
    if email_item.attachment_text:
        parts.extend(["", "Текст из поддерживаемых вложений:", email_item.attachment_text])
    return "\n".join(parts)
