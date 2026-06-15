from datetime import datetime

from pydantic import BaseModel, Field


class TextProcessRequest(BaseModel):
    original_text: str = Field(..., min_length=1)
    client_company: str | None = None
    client_contact_name: str | None = None
    michael_manager: str | None = None
    communication_channel: str | None = None


class SalesRequestResponse(BaseModel):
    id: int
    source_type: str
    client_company: str | None
    client_contact_name: str | None
    michael_manager: str | None
    communication_channel: str | None
    original_text: str
    uploaded_file_name: str | None
    ai_result: str
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailMessageResponse(BaseModel):
    id: int
    mailbox_name: str | None
    mailbox_email: str | None
    michael_manager: str | None
    message_uid: str
    from_address: str | None
    to_address: str | None
    subject: str | None
    body_text: str
    attachment_names: str | None
    attachment_text: str | None
    processed_request_id: int | None
    received_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailCheckResponse(BaseModel):
    imported: int
    skipped: int
    total_seen: int
