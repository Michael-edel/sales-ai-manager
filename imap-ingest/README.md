# IMAP ingest для ящиков edel.kz

Сервис читает письма из mailcow по IMAP и отправляет их в Cloudflare Worker через защищенный API:

```text
user@edel.kz -> IMAP ingest -> https://ai.michael.kz/api/email/ingest -> D1 email_messages
```

Worker не хранит пароль от почтового ящика. Пароль находится только в локальном `.env` этого сервиса.
В приложении администратор привязывает такой же email `@edel.kz` к пользователю. После загрузки письма Worker назначает письмо этому пользователю по `mailbox_email`.

## Настройка

```powershell
cd imap-ingest
Copy-Item .env.example .env
notepad .env
```

Заполните:

- `IMAP_USERNAME` — ящик пользователя, например `direktor@edel.kz` или `manager1@edel.kz`;
- `IMAP_PASSWORD` — пароль или app password от этого ящика;
- `MAILBOX_NAME` — понятное имя ящика для интерфейса;
- `STATE_DB` — отдельный sqlite-файл состояния для каждого запуска/ящика;
- `EMAIL_INGEST_TOKEN` — тот же секрет, который задан в Worker через `npx wrangler secret put EMAIL_INGEST_TOKEN`.

Для mailcow `mail-edel.edel.kz` используется порт `143` + `STARTTLS`.

Если нужно читать несколько ящиков, запустите несколько экземпляров сервиса с разными `.env`/`STATE_DB`. Например:

```text
direktor@edel.kz -> STATE_DB=imap_ingest_direktor.sqlite3
manager1@edel.kz -> STATE_DB=imap_ingest_manager1.sqlite3
buh@edel.kz -> STATE_DB=imap_ingest_buh.sqlite3
```

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
