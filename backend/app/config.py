from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class MailAccount(BaseModel):
    name: str
    email: str
    password: str
    michael_manager: str = ""
    imap_host: str = ""
    imap_port: int = 993
    imap_folder: str = "INBOX"


class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_model: str = "gpt-5.5"
    openai_transcribe_model: str = "gpt-4o-transcribe"
    mail_imap_host: str = ""
    mail_imap_port: int = 993
    mail_imap_user: str = ""
    mail_imap_password: str = ""
    mail_imap_folder: str = "INBOX"
    mail_accounts: str = ""
    mail_smtp_host: str = ""
    mail_smtp_port: int = 587
    mail_smtp_user: str = ""
    mail_smtp_password: str = ""
    database_url: str = "postgresql+psycopg://postgres:postgres@postgres:5432/sales_ai_manager"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_upload_mb: int = 15
    prompt_path: Path = Path(__file__).resolve().parents[1] / "prompts" / "sales_manager_system.md"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("openai_api_key", mode="before")
    @classmethod
    def normalize_openai_api_key(cls, value: str) -> str:
        if isinstance(value, str) and value.startswith("OPENAI_API_KEY="):
            return value.split("=", 1)[1].strip()
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def mail_account_list(self) -> list[MailAccount]:
        accounts: list[MailAccount] = []
        if self.mail_accounts.strip():
            for raw_account in self.mail_accounts.split(";"):
                parts = [part.strip() for part in raw_account.split("|")]
                if len(parts) < 3:
                    continue
                accounts.append(
                    MailAccount(
                        name=parts[0],
                        email=parts[1],
                        password=parts[2],
                        michael_manager=parts[3] if len(parts) > 3 else parts[0],
                        imap_host=parts[4] if len(parts) > 4 else self.mail_imap_host,
                        imap_port=int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else self.mail_imap_port,
                        imap_folder=parts[6] if len(parts) > 6 else self.mail_imap_folder,
                    )
                )

        if not accounts and self.mail_imap_user and self.mail_imap_password:
            accounts.append(
                MailAccount(
                    name=self.mail_imap_user,
                    email=self.mail_imap_user,
                    password=self.mail_imap_password,
                    michael_manager="",
                    imap_host=self.mail_imap_host,
                    imap_port=self.mail_imap_port,
                    imap_folder=self.mail_imap_folder,
                )
            )
        return accounts


@lru_cache
def get_settings() -> Settings:
    return Settings()
