from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SalesRequest(Base):
    __tablename__ = "requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    client_company: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_contact_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    michael_manager: Mapped[str | None] = mapped_column(Text, nullable=True)
    communication_channel: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_file_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_result: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class EmailMessage(Base):
    __tablename__ = "email_messages"
    __table_args__ = (UniqueConstraint("mailbox_email", "message_uid", name="uq_email_messages_mailbox_uid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mailbox_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    mailbox_email: Mapped[str | None] = mapped_column(Text, nullable=True)
    michael_manager: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_uid: Mapped[str] = mapped_column(Text, nullable=False)
    from_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    to_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    attachment_names: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_request_id: Mapped[int | None] = mapped_column(ForeignKey("requests.id"), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
