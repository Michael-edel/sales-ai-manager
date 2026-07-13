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

При заданном `ONEC_MCP_DUMP_PATH` bridge также публикует собственный read-only
инструмент `read_source`. Он читает полный BSL-файл из выгрузки
`DumpConfigToFiles`, возвращает `sourceComplete: true` и не принимает произвольные
пути. Файлы за пределами dump-каталога, включая symlink на внешний файл,
отбрасываются. После обновления выгрузки перезапустите bridge, чтобы пересобрать
индекс модулей.

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

Для полного исходного текста задайте путь к read-only выгрузке 1С:

```env
ONEC_MCP_DUMP_PATH=C:\1C\DumpConfigToFiles
```

Сама выгрузка создается штатной операцией `DumpConfigToFiles`; конфигурация 1С
не изменяется. Если переменная не задана, доступны только инструменты
`mcp-1c`, а Inspector корректно показывает частичное покрытие источника.

5. Установите зависимости и запустите bridge:

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\onec-mcp-bridge
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\start-onec-mcp-bridge.ps1
```

6. Для production сделайте доступ к bridge только через VPN или Cloudflare Tunnel и задайте в Worker:

```powershell
cd ..\worker
npx wrangler secret put ONEC_MCP_BRIDGE_TOKEN
npx wrangler secret put ONEC_MCP_BRIDGE_URL
```

`ONEC_MCP_BRIDGE_URL` должен быть HTTPS URL до этого bridge, например `https://onec-mcp.michael.kz`.

## Автозапуск на Windows

Bridge должен запускаться рядом с базой 1С после перезагрузки сервера. Для этого добавлены скрипты:

```text
start-onec-mcp-bridge.ps1       # читает .env и запускает uvicorn на 127.0.0.1:8091
install-autostart-task.ps1      # создает задачу Windows Scheduler от SYSTEM при старте Windows
uninstall-autostart-task.ps1    # удаляет задачу автозапуска
```

Установка задачи:

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\onec-mcp-bridge
.\install-autostart-task.ps1
```

Запустить задачу сразу без перезагрузки:

```powershell
Start-ScheduledTask -TaskName SalesAiManager-1C-MCP-Bridge
```

Проверка:

```powershell
$token = (Get-Content .env | Select-String 'ONEC_MCP_BRIDGE_TOKEN=(.+)').Matches[0].Groups[1].Value.Trim()
Invoke-RestMethod http://127.0.0.1:8091/health -Headers @{ Authorization = "Bearer $token" }
```

Лог пишется в `onec-mcp-bridge/logs/onec-mcp-bridge.log`. Файл `.env` и логи не коммитятся в git.

## Ограничения

Это не интеграция проведения документов. На текущем этапе bridge нужен, чтобы ИИ-менеджер мог безопасно получать метаданные и проверочные данные из 1С. Счета и документы по-прежнему выставляются в 1С менеджером.
