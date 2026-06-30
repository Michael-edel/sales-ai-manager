# Cloudflare Workers + D1 версия

Это Cloudflare-вариант API для `sales-ai-manager`.

Он заменяет Python/FastAPI + PostgreSQL на:

- Cloudflare Workers;
- Cloudflare D1;
- Wrangler;
- React static assets из `frontend/dist`.

## Что перенесено

- `GET /api/health`
- `GET /api/requests`
- `GET /api/requests/:id`
- `POST /api/requests/text`
- `POST /api/requests/upload`
- D1 таблицы `requests` и `email_messages`
- пользователи, роли и cookie-сессии в D1
- Gemini/OpenAI для текста и изображений
- Gemini/OpenAI audio transcription для голосовых
- PDF/DOCX/XLSX через внешний `parser-service`

## Что пока не перенесено

- IMAP-проверка mailcow/Yandex.
- SMTP-отправка.
- Парсинг PDF/DOCX/XLSX внутри самого Worker.

Для почты лучше сделать отдельный bridge-сервис или webhook-поток, который будет читать IMAP и отправлять письма в Worker API. Для документов уже добавлен Python-сервис `../parser-service`.

## Подготовка

Установите зависимости:

```powershell
cd worker
npm install
```

Создайте D1:

```powershell
npx wrangler d1 create sales-ai-manager
```

Скопируйте `database_id` в `worker/wrangler.toml` вместо:

```text
REPLACE_WITH_D1_DATABASE_ID
```

Примените миграции локально:

```powershell
npm run d1:migrate:local
```

Для production:

```powershell
npm run d1:migrate:remote
```

Добавьте OpenAI secret:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

## Защита доступа

Интерфейс открывается как SPA, но все API закрыты встроенной авторизацией приложения через cookie-сессии.

Логин задается в `wrangler.toml`:

```toml
ACCESS_USERNAME = "manager"
```

Пароль задается только как secret:

```powershell
npx wrangler secret put ACCESS_PASSWORD
```

Для локального запуска создайте `worker\.dev.vars` из примера:

```powershell
Copy-Item .dev.vars.example .dev.vars
notepad .dev.vars
```

В `.dev.vars` укажите свой `ACCESS_PASSWORD`. Этот файл добавлен в `.gitignore` и не должен попадать в GitHub.

Первый пользователь создается автоматически, если таблица `app_users` пустая:

```text
логин: manager
роль: admin
пароль: ACCESS_PASSWORD
```

## Parser-service для PDF/DOCX/XLSX

Worker вызывает внешний FastAPI-сервис, потому что Cloudflare Worker не запускает Python-библиотеки `PyMuPDF`, `python-docx` и `openpyxl`.

Локально:

```powershell
cd ..\parser-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PARSER_SERVICE_TOKEN="change-this-parser-token"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

В `worker/.dev.vars`:

```env
PARSER_SERVICE_URL=http://127.0.0.1:8080
PARSER_SERVICE_TOKEN=change-this-parser-token
```

Для production:

```powershell
npx wrangler secret put PARSER_SERVICE_TOKEN
```

`PARSER_SERVICE_URL` добавьте как Worker variable в Cloudflare Dashboard или в `wrangler.toml`, если URL не секретный.

## Gemini API

Gemini поддерживается как альтернативный провайдер.

Получите ключ в Google AI Studio:

```text
https://aistudio.google.com/app/apikey
```

Добавьте secret:

```powershell
npx wrangler secret put GEMINI_API_KEY
```

Чтобы использовать Gemini вместо OpenAI, измените в `wrangler.toml`:

```toml
AI_PROVIDER = "gemini"
GEMINI_MODEL = "gemini-3.5-flash"
```

Чтобы вернуться на OpenAI:

```toml
AI_PROVIDER = "openai"
```

## Локальный запуск

Соберите frontend:

```powershell
cd ..\frontend
npm install
npm run build
```

Запустите Worker:

```powershell
cd ..\worker
npm run dev
```

## Deploy

```powershell
cd frontend
npm run build
cd ..\worker
npm run deploy
```
