# 1C MCP Bridge

Текущая версия bridge: `0.9.1`. Она добавляет пять локальных read-only tools по
выгрузке BSL: `list_module_methods`, `resolve_symbol`, `find_references`,
`get_source_checksum` и `estimate_tool_payload`. Инструменты не выполняют код,
не обращаются к данным базы и ограничивают число возвращаемых ссылок. Шаблон
`.env.example` публикует development allowlist из 16 инструментов. Новый
`read_register_records` строит только ограниченную выборку одного регистра и
не принимает произвольный текст запроса 1С.

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
- разделяет доступ по независимым токенам и профилям инструментов;
- ограничивает размер HTTP-запроса и частоту обращений;
- возвращает безопасные коды ошибок с `X-Request-ID`, не раскрывая stderr и внутренние пути.

Профили доступа:

- `business` (`ONEC_MCP_BRIDGE_TOKEN`) используется Worker и разрешает метаданные,
  валидацию и серверные read-only запросы через `execute_query`;
- `development` (`ONEC_MCP_INSPECTOR_TOKEN`) используется 1C AI Inspector и
  разрешает только метаданные, поиск, справку BSL, валидацию, `read_source`,
  `read_method_source`, `get_edt_metadata_summary` и инструменты навигации v0.9;
- `diagnostics` (`ONEC_MCP_DIAGNOSTICS_TOKEN`) опционален и отдельно разрешает
  `get_event_log`. Не используйте диагностический токен в приложениях.

Значения всех настроенных токенов должны отличаться. Bridge отклоняет запуск
авторизации при совпадающих токенах, поэтому один секрет нельзя использовать для
нескольких контуров.

При заданном `ONEC_MCP_DUMP_PATH` bridge публикует восемь собственных read-only
инструментов:

- `read_source` читает полный BSL-модуль;
- `read_method_source` возвращает только точную процедуру или функцию с
  исходными номерами строк, что уменьшает трафик и контекст модели;
- `get_edt_metadata_summary` преобразует XML объекта EDT/DumpConfigToFiles в
  компактный JSON с реквизитами, табличными частями, формами и командами.
- `list_module_methods` возвращает сигнатуры процедур и функций модуля;
- `resolve_symbol` находит точные объявления символа;
- `find_references` возвращает не более 100 точных употреблений символа;
- `get_source_checksum` возвращает SHA-256 без передачи исходного текста;
- `estimate_tool_payload` оценивает размер `read_source` или
  `read_method_source` до передачи результата клиенту.
- `read_register_records` возвращает не более 500 live-записей указанного
  регистра для Data Audit Agent; bridge проверяет имя, сам строит read-only
  `ВЫБРАТЬ ПЕРВЫЕ ...` и не публикует Inspector инструмент `execute_query`.

Тесты bridge запускаются в отдельном окружении:

```powershell
python -m pip install -r requirements-dev.txt
$env:PYTHONPATH = (Resolve-Path .).Path
python -m unittest discover -s tests -v
```

Инструменты принимают имена модулей и объектов, а не произвольные пути. Файлы за
пределами dump-каталога, включая symlink на внешний файл, отбрасываются. XML с
DTD/ENTITY и файлы более 16 МиБ отклоняются. Индекс BSL строится один раз на
запуск; после обновления выгрузки перезапустите bridge.

Для внешнего HTTPS-маршрута запустите именованный Cloudflare Tunnel из той же
копии репозитория: `./start-onec-mcp-tunnel.ps1`. Скрипт сам находит соседний
каталог `worker`, поэтому автозапуск не зависит от абсолютного пути checkout.

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

Обязательно задайте два разных секрета: `ONEC_MCP_BRIDGE_TOKEN` для
`sales-ai-manager` и `ONEC_MCP_INSPECTOR_TOKEN` для Inspector. Диагностический
токен оставьте пустым, пока доступ к журналу событий действительно не нужен.
Лимиты по умолчанию: тело запроса не более 1 МиБ и 120 запросов в минуту на
IP/токен. Они настраиваются через `ONEC_MCP_MAX_BODY_BYTES` и
`ONEC_MCP_RATE_LIMIT_PER_MINUTE`.

Для полного исходного текста задайте путь к read-only выгрузке 1С:

```env
ONEC_MCP_DUMP_PATH=C:\1C\DumpConfigToFiles
```

Сама выгрузка создается штатной операцией `DumpConfigToFiles`; конфигурация 1С
не изменяется. Если переменная не задана, доступны только инструменты
`mcp-1c`, а Inspector корректно показывает частичное покрытие источника.

Проверка bridge:

```powershell
python -m pytest -q
```

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
$businessToken = (Get-Content .env | Select-String 'ONEC_MCP_BRIDGE_TOKEN=(.+)').Matches[0].Groups[1].Value.Trim()
$inspectorToken = (Get-Content .env | Select-String 'ONEC_MCP_INSPECTOR_TOKEN=(.+)').Matches[0].Groups[1].Value.Trim()
Invoke-RestMethod http://127.0.0.1:8091/health -Headers @{ Authorization = "Bearer $businessToken" }
Invoke-RestMethod http://127.0.0.1:8091/tools -Headers @{ Authorization = "Bearer $inspectorToken" }
```

Лог пишется в `onec-mcp-bridge/logs/onec-mcp-bridge.log`. Файл `.env` и логи не коммитятся в git.

## Ограничения

Это не интеграция проведения документов. На текущем этапе bridge нужен, чтобы ИИ-менеджер мог безопасно получать метаданные и проверочные данные из 1С. Счета и документы по-прежнему выставляются в 1С менеджером. Ограничение частоты работает в памяти одного процесса и не заменяет Cloudflare Access/WAF перед публичным Tunnel endpoint.
