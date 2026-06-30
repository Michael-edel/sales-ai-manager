# Parser Service

Отдельный FastAPI-сервис для чтения `.pdf`, `.docx` и `.xlsx`.

Cloudflare Worker не запускает Python-библиотеки `PyMuPDF`, `python-docx` и `openpyxl`, поэтому документы передаются в этот сервис через HTTP. Worker сохраняет исходное имя файла, извлеченный текст и ответ ИИ в D1.

## Локальный запуск

```powershell
cd parser-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PARSER_SERVICE_TOKEN="change-this-parser-token"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
```

## Подключение к Worker

Для локального `wrangler dev` добавьте в `worker/.dev.vars`:

```env
PARSER_SERVICE_URL=http://127.0.0.1:8080
PARSER_SERVICE_TOKEN=change-this-parser-token
```

Для production задайте секрет/переменную в Cloudflare:

```powershell
cd worker
npx wrangler secret put PARSER_SERVICE_TOKEN
```

`PARSER_SERVICE_URL` можно добавить как переменную Worker в Cloudflare Dashboard или в `worker/wrangler.toml`, если URL не секретный.

## Что делает

- `.docx`: извлекает параграфы и таблицы.
- `.xlsx`: извлекает строки всех листов.
- `.pdf`: извлекает текст через PyMuPDF.
- сканированный `.pdf`: если текста нет, рендерит первые страницы в JPEG и возвращает их Worker для vision-анализа.
