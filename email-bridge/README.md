# Email Bridge

Отдельный FastAPI-сервис для SMTP-отправки писем через mailcow/Yandex/другой SMTP.

Cloudflare Worker вызывает этот сервис по HTTPS. SMTP-логин и пароль хранятся только на сервере `email-bridge`, не в Worker и не в браузере.

## Локальный запуск

```powershell
cd email-bridge
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:EMAIL_BRIDGE_TOKEN="change-this-email-token"
$env:SMTP_HOST="mail.your-domain.kz"
$env:SMTP_PORT="587"
$env:SMTP_USER="manager@your-domain.kz"
$env:SMTP_PASSWORD="smtp-password"
$env:SMTP_FROM="manager@your-domain.kz"
$env:SMTP_FROM_NAME="ТОО Michael"
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8090/health -Headers @{"X-Email-Bridge-Token"="change-this-email-token"}
```

## Подключение к Worker

Для локального `wrangler dev` добавьте в `worker/.dev.vars`:

```env
EMAIL_BRIDGE_URL=http://127.0.0.1:8090
EMAIL_BRIDGE_TOKEN=change-this-email-token
```

Для production задайте:

```powershell
cd worker
npx wrangler secret put EMAIL_BRIDGE_TOKEN
```

`EMAIL_BRIDGE_URL` добавьте как Worker variable в Cloudflare Dashboard или в `worker/wrangler.toml`, если URL не секретный.
