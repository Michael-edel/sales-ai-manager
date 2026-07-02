# 1C MCP Bridge

Локальный HTTP-мост между Cloudflare Worker приложения `sales-ai-manager` и MCP-сервером `mcp-1c`.

Cloudflare Worker не может запускать локальный `mcp-1c.exe` рядом с базой 1С. Поэтому схема такая:

```text
ai.michael.kz -> Cloudflare Worker -> HTTPS/VPN/Tunnel -> onec-mcp-bridge -> mcp-1c -> HTTP-сервис 1С
```

## Что делает bridge

- запускает `mcp-1c` как локальный процесс по stdio;
- выполняет MCP `initialize`, `tools/list`, `tools/call`;
- открывает защищенные HTTP endpoints:
  - `GET /health`
  - `GET /tools`
  - `POST /tools/call`
- требует токен `ONEC_MCP_BRIDGE_TOKEN`;
- по умолчанию разрешает только read-only/diagnostic инструменты `mcp-1c`.

## Настройка

1. Скачайте `mcp-1c` с GitHub: https://github.com/feenlace/mcp-1c
2. Установите расширение в базу 1С или настройте серверный режим по инструкции `mcp-1c`.
3. Опубликуйте HTTP-сервис 1С, например:

```powershell
1cv8.exe ENTERPRISE /F "C:\1C\Base" /HTTPPort 8080
```

4. Создайте `.env` по примеру:

```powershell
Copy-Item .env.example .env
notepad .env
```

5. Установите зависимости и запустите bridge:

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\onec-mcp-bridge
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8091
```

6. Для production сделайте доступ к bridge только через VPN или Cloudflare Tunnel и задайте в Worker:

```powershell
cd ..\worker
npx wrangler secret put ONEC_MCP_BRIDGE_TOKEN
npx wrangler secret put ONEC_MCP_BRIDGE_URL
```

`ONEC_MCP_BRIDGE_URL` должен быть HTTPS URL до этого bridge, например `https://onec-mcp.michael.kz`.

## Ограничения

Это не интеграция проведения документов. На текущем этапе bridge нужен, чтобы ИИ-менеджер мог безопасно получать метаданные и проверочные данные из 1С. Счета и документы по-прежнему выставляются в 1С менеджером.
