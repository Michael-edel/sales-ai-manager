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
- OpenAI Responses API для текста и изображений
- OpenAI audio transcription для голосовых

## Что пока не перенесено

- IMAP-проверка mailcow/Yandex.
- SMTP-отправка.
- Парсинг PDF/DOCX/XLSX внутри Worker.

Для почты лучше сделать отдельный bridge-сервис или webhook-поток, который будет читать IMAP и отправлять письма в Worker API.

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
