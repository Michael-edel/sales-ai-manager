# IMAP ingest для direktor@edel.kz

Сервис читает письма из mailcow по IMAP и отправляет их в Cloudflare Worker через защищенный API:

```text
direktor@edel.kz -> IMAP ingest -> https://ai.michael.kz/api/email/ingest -> D1 email_messages
```

Worker не хранит пароль от почтового ящика. Пароль находится только в локальном `.env` этого сервиса.

## Настройка

```powershell
cd imap-ingest
Copy-Item .env.example .env
notepad .env
```

Заполните:

- `IMAP_PASSWORD` — пароль или app password от `direktor@edel.kz`;
- `EMAIL_INGEST_TOKEN` — тот же секрет, который задан в Worker через `npx wrangler secret put EMAIL_INGEST_TOKEN`.

Для mailcow `mail-edel.edel.kz` используется порт `143` + `STARTTLS`.

## Запуск проверки

```powershell
cd imap-ingest
python app\main.py --once
```

## Постоянный запуск

```powershell
cd imap-ingest
python app\main.py
```

По умолчанию сервис читает последние 25 писем из `INBOX`, не помечает их прочитанными и повторно не отправляет уже обработанные UID.
