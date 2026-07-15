"""Read-only source access for a configured DumpConfigToFiles directory."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
import re
from threading import RLock
from typing import Any


CATEGORY_NAMES = {
    "Documents": "Документ",
    "Catalogs": "Справочник",
    "CommonModules": "ОбщийМодуль",
    "DataProcessors": "Обработка",
    "Reports": "Отчет",
    "InformationRegisters": "РегистрСведений",
    "AccumulationRegisters": "РегистрНакопления",
    "AccountingRegisters": "РегистрБухгалтерии",
    "CalculationRegisters": "РегистрРасчета",
    "BusinessProcesses": "БизнесПроцесс",
    "Tasks": "Задача",
    "PlansOfCharacteristicTypes": "ПланВидовХарактеристик",
    "PlansOfExchange": "ПланОбмена",
    "ChartsOfAccounts": "ПланСчетов",
    "PlansOfAccounts": "ПланСчетов",
    "ChartsOfCalculationTypes": "ПланВидовРасчета",
    "PlansOfCalculationTypes": "ПланВидовРасчета",
}

MODULE_SUFFIXES = {
    "ObjectModule.bsl": "МодульОбъекта",
    "ManagerModule.bsl": "МодульМенеджера",
    "RecordSetModule.bsl": "МодульНабораЗаписей",
    "CommandModule.bsl": "МодульКоманды",
    "ValueManagerModule.bsl": "МодульМенеджераЗначения",
    "FormModule.bsl": "МодульФормы",
}


class SourceReaderError(ValueError):
    """Raised for a safe, user-actionable read_source failure."""

    status_code = 400


class SourceNotConfiguredError(SourceReaderError):
    status_code = 503


class SourceNotFoundError(SourceReaderError):
    status_code = 404


def _path_within_root(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _base_module_name(parts: tuple[str, ...]) -> str | None:
    if len(parts) < 2:
        return None

    category = CATEGORY_NAMES.get(parts[0], parts[0])
    object_name = parts[1]
    file_name = parts[-1]
    if parts[0] == "CommonModules" and file_name == "Module.bsl" and "Forms" not in parts:
        suffix = "Модуль"
    else:
        suffix = MODULE_SUFFIXES.get(file_name, Path(file_name).stem)

    for index, part in enumerate(parts):
        if part in {"Forms", "Commands"} and index + 1 < len(parts):
            child_kind = "Форма" if part == "Forms" else "Команда"
            return f"{category}.{object_name}.{child_kind}.{parts[index + 1]}.{suffix}"
    return f"{category}.{object_name}.{suffix}"


def module_name_from_relative(relative_path: Path) -> str | None:
    """Mirror mcp-1c dump module names for base and extension modules."""
    parts = tuple(relative_path.parts)
    if len(parts) >= 4 and parts[0] == "Расширения":
        base_name = _base_module_name(parts[2:])
        return f"ext.{parts[1]}.{base_name}" if base_name else None
    return _base_module_name(parts)


READ_SOURCE_TOOL: dict[str, Any] = {
    "name": "read_source",
    "title": "Чтение исходного кода модуля",
    "description": (
        "Полностью читает один BSL-модуль из read-only выгрузки DumpConfigToFiles. "
        "Работает только при явной настройке ONEC_MCP_DUMP_PATH."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "module": {
                "type": "string",
                "description": (
                    "Полное имя модуля, например "
                    "Документ.ЗаказКлиента.МодульОбъекта"
                ),
            }
        },
        "required": ["module"],
        "additionalProperties": False,
    },
}

READ_METHOD_SOURCE_TOOL: dict[str, Any] = {
    "name": "read_method_source",
    "title": "Чтение процедуры или функции 1С",
    "description": (
        "Читает одну точно указанную процедуру или функцию из BSL-модуля "
        "read-only выгрузки, сохраняя исходные номера строк."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "module": {
                "type": "string",
                "description": "Полное имя модуля, например Документ.ЗаказКлиента.МодульОбъекта",
            },
            "method": {
                "type": "string",
                "description": "Точное имя процедуры или функции без скобок",
            },
        },
        "required": ["module", "method"],
        "additionalProperties": False,
    },
}

LIST_MODULE_METHODS_TOOL = {
    "name": "list_module_methods",
    "title": "Список методов модуля 1С",
    "description": "Возвращает процедуры и функции одного BSL-модуля без исходного текста.",
    "inputSchema": {
        "type": "object",
        "properties": {"module": {"type": "string"}},
        "required": ["module"],
        "additionalProperties": False,
    },
}

RESOLVE_SYMBOL_TOOL = {
    "name": "resolve_symbol",
    "title": "Разрешение символа BSL",
    "description": "Находит точные объявления процедуры или функции в read-only выгрузке.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "module": {"type": "string"},
        },
        "required": ["symbol"],
        "additionalProperties": False,
    },
}

FIND_REFERENCES_TOOL = {
    "name": "find_references",
    "title": "Поиск ссылок на символ BSL",
    "description": "Ищет ограниченный список точных употреблений символа в BSL-модулях.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "module": {"type": "string"},
            "maxResults": {"type": "integer", "minimum": 1, "maximum": 100},
        },
        "required": ["symbol"],
        "additionalProperties": False,
    },
}

GET_SOURCE_CHECKSUM_TOOL = {
    "name": "get_source_checksum",
    "title": "Checksum исходного модуля",
    "description": "Возвращает SHA-256 и размер BSL-модуля без передачи исходного текста.",
    "inputSchema": {
        "type": "object",
        "properties": {"module": {"type": "string"}},
        "required": ["module"],
        "additionalProperties": False,
    },
}

ESTIMATE_TOOL_PAYLOAD_TOOL = {
    "name": "estimate_tool_payload",
    "title": "Оценка payload исходного кода",
    "description": "Оценивает размер ответа read_source или read_method_source до передачи клиенту.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "tool": {"type": "string", "enum": ["read_source", "read_method_source"]},
            "module": {"type": "string"},
            "method": {"type": "string"},
        },
        "required": ["tool", "module"],
        "additionalProperties": False,
    },
}

_METHOD_NAME = re.compile(r"^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$")


class SourceReader:
    """Resolve module IDs to files while keeping every read inside dump root."""

    def __init__(self, dump_path: str = "") -> None:
        self._configured_path = dump_path.strip()
        self._root: Path | None = None
        self._index: dict[str, Path] = {}
        self._ambiguous: set[str] = set()
        self._indexed = False
        self._lock = RLock()
        if self._configured_path:
            candidate = Path(self._configured_path).expanduser()
            if candidate.is_dir():
                self._root = candidate.resolve(strict=True)

    @property
    def configured(self) -> bool:
        return bool(self._configured_path)

    @property
    def available(self) -> bool:
        return self._root is not None and self._root.is_dir()

    def status(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "available": self.available,
            "modules": len(self._index),
            "indexed": self._indexed,
        }

    def _build_index_locked(self) -> None:
        if self._root is None:
            raise SourceNotConfiguredError("read_source не настроен: укажите ONEC_MCP_DUMP_PATH.")
        if self._indexed:
            return

        index: dict[str, Path] = {}
        ambiguous: set[str] = set()
        for path in self._root.rglob("*.bsl"):
            try:
                resolved = path.resolve(strict=True)
            except OSError:
                continue
            if not resolved.is_file() or not _path_within_root(self._root, resolved):
                continue
            module_name = module_name_from_relative(path.relative_to(self._root))
            if not module_name:
                continue
            if module_name in index:
                ambiguous.add(module_name)
                index.pop(module_name, None)
                continue
            if module_name not in ambiguous:
                index[module_name] = resolved
        self._index = index
        self._ambiguous = ambiguous
        self._indexed = True

    def read(self, arguments: dict[str, Any]) -> dict[str, Any]:
        module = arguments.get("module")
        if not isinstance(module, str) or not module.strip():
            raise SourceReaderError("Для read_source укажите module.")
        module = module.strip()

        with self._lock:
            if not self.available:
                raise SourceNotConfiguredError("read_source не настроен: укажите ONEC_MCP_DUMP_PATH.")
            self._build_index_locked()
            if module in self._ambiguous:
                raise SourceReaderError("Для указанного модуля найдено несколько исходных файлов.")
            path = self._index.get(module)
            if path is None or self._root is None:
                raise SourceNotFoundError("Исходный модуль не найден в read-only выгрузке.")
            try:
                resolved = path.resolve(strict=True)
            except OSError as exc:
                raise SourceNotFoundError("Исходный модуль больше недоступен.") from exc
            if not resolved.is_file() or not _path_within_root(self._root, resolved):
                raise SourceNotFoundError("Исходный модуль недоступен в пределах dump-каталога.")
            try:
                source = resolved.read_text(encoding="utf-8-sig")
            except UnicodeDecodeError as exc:
                raise SourceReaderError("Исходный модуль не является UTF-8 текстом.") from exc
            except OSError as exc:
                raise SourceNotFoundError("Не удалось прочитать исходный модуль.") from exc
            relative_path = resolved.relative_to(self._root).as_posix()

        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "module": module,
                            "relativePath": relative_path,
                            "source": source,
                            "sourceComplete": True,
                        },
                        ensure_ascii=False,
                    ),
                }
            ],
            "sourceComplete": True,
            "isError": False,
        }

    def read_method(self, arguments: dict[str, Any]) -> dict[str, Any]:
        method = arguments.get("method")
        if not isinstance(method, str) or not _METHOD_NAME.fullmatch(method.strip()):
            raise SourceReaderError("Для read_method_source укажите корректное имя method.")
        method = method.strip()

        full_result = self.read(arguments)
        payload = json.loads(full_result["content"][0]["text"])
        source = payload["source"]
        declaration = re.compile(
            rf"^[ \t]*(?P<kind>Процедура|Функция)[ \t]+{re.escape(method)}[ \t]*\(",
            re.IGNORECASE | re.MULTILINE,
        )
        matches = list(declaration.finditer(source))
        if not matches:
            raise SourceNotFoundError("Процедура или функция не найдена в указанном модуле.")
        if len(matches) > 1:
            raise SourceReaderError("В модуле найдено несколько методов с указанным именем.")

        match = matches[0]
        kind = match.group("kind")
        terminator_name = "КонецПроцедуры" if kind.casefold() == "процедура" else "КонецФункции"
        terminator = re.compile(
            rf"^[ \t]*{terminator_name}[ \t]*;?[ \t]*\r?$",
            re.IGNORECASE | re.MULTILINE,
        ).search(source, match.start())
        if terminator is None:
            raise SourceReaderError("Не найден конец указанной процедуры или функции.")

        line_start = source.count("\n", 0, match.start()) + 1
        line_end = source.count("\n", 0, terminator.start()) + 1
        scoped_source = "\n" * (line_start - 1) + source[match.start():terminator.end()]
        scoped_payload = {
            **payload,
            "method": method,
            "kind": "procedure" if kind.casefold() == "процедура" else "function",
            "source": scoped_source,
            "sourceComplete": True,
            "sourceScope": "method",
            "sourceLineStart": line_start,
            "sourceLineEnd": line_end,
            "moduleTotalLines": len(source.splitlines()),
        }
        return {
            "content": [{"type": "text", "text": json.dumps(scoped_payload, ensure_ascii=False)}],
            "sourceComplete": True,
            "sourceScope": "method",
            "isError": False,
        }

    def list_methods(self, arguments: dict[str, Any]) -> dict[str, Any]:
        payload = json.loads(self.read(arguments)["content"][0]["text"])
        source = payload["source"]
        declaration = re.compile(
            r"^[ \t]*(?P<kind>Процедура|Функция)[ \t]+(?P<name>[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)[^\r\n]*",
            re.IGNORECASE | re.MULTILINE,
        )
        methods = []
        for match in declaration.finditer(source):
            methods.append({
                "name": match.group("name"),
                "kind": "procedure" if match.group("kind").casefold() == "процедура" else "function",
                "line": source.count("\n", 0, match.start()) + 1,
                "export": bool(re.search(r"\bЭкспорт\b", match.group(0), re.IGNORECASE)),
            })
        result = {"module": payload["module"], "methods": methods, "count": len(methods)}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False}

    def resolve_symbol(self, arguments: dict[str, Any]) -> dict[str, Any]:
        symbol = self._validated_symbol(arguments)
        module = arguments.get("module")
        candidates = self._module_candidates(module)
        declaration = re.compile(
            rf"^[ \t]*(?P<kind>Процедура|Функция)[ \t]+{re.escape(symbol)}[ \t]*\(",
            re.IGNORECASE | re.MULTILINE,
        )
        matches = []
        for module_name, path in candidates:
            source = self._read_indexed_path(path)
            for match in declaration.finditer(source):
                matches.append({
                    "module": module_name,
                    "symbol": symbol,
                    "kind": "procedure" if match.group("kind").casefold() == "процедура" else "function",
                    "line": source.count("\n", 0, match.start()) + 1,
                })
                if len(matches) >= 50:
                    break
            if len(matches) >= 50:
                break
        result = {"symbol": symbol, "matches": matches, "count": len(matches), "truncated": len(matches) >= 50}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False}

    def find_references(self, arguments: dict[str, Any]) -> dict[str, Any]:
        symbol = self._validated_symbol(arguments)
        max_results = arguments.get("maxResults", 50)
        if not isinstance(max_results, int) or isinstance(max_results, bool) or not 1 <= max_results <= 100:
            raise SourceReaderError("maxResults должен быть целым числом от 1 до 100.")
        pattern = re.compile(rf"(?<![A-Za-zА-Яа-яЁё0-9_]){re.escape(symbol)}(?![A-Za-zА-Яа-яЁё0-9_])", re.IGNORECASE)
        matches = []
        truncated = False
        for module_name, path in self._module_candidates(arguments.get("module")):
            source = self._read_indexed_path(path)
            for line_number, line in enumerate(source.splitlines(), 1):
                if pattern.search(line):
                    if len(matches) >= max_results:
                        truncated = True
                        break
                    matches.append({"module": module_name, "line": line_number, "snippet": line.strip()[:300]})
            if truncated:
                break
        result = {"symbol": symbol, "references": matches, "count": len(matches), "truncated": truncated}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False}

    def checksum(self, arguments: dict[str, Any]) -> dict[str, Any]:
        payload = json.loads(self.read(arguments)["content"][0]["text"])
        encoded = payload["source"].encode("utf-8")
        result = {
            "module": payload["module"],
            "sourceBytes": len(encoded),
            "sourceLines": len(payload["source"].splitlines()),
            "sha256": hashlib.sha256(encoded).hexdigest(),
        }
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False}

    def estimate_payload(self, arguments: dict[str, Any]) -> dict[str, Any]:
        tool = arguments.get("tool")
        if tool not in {"read_source", "read_method_source"}:
            raise SourceReaderError("estimate_tool_payload поддерживает только read_source и read_method_source.")
        result = self.read_method(arguments) if tool == "read_method_source" else self.read(arguments)
        payload = json.loads(result["content"][0]["text"])
        estimate = {
            "tool": tool,
            "module": payload["module"],
            "method": payload.get("method"),
            "sourceBytes": len(payload["source"].encode("utf-8")),
            "responseBytes": len(json.dumps(result, ensure_ascii=False).encode("utf-8")),
        }
        return {"content": [{"type": "text", "text": json.dumps(estimate, ensure_ascii=False)}], "isError": False}

    def _validated_symbol(self, arguments: dict[str, Any]) -> str:
        symbol = arguments.get("symbol")
        if not isinstance(symbol, str) or not _METHOD_NAME.fullmatch(symbol.strip()):
            raise SourceReaderError("Укажите корректное имя symbol.")
        return symbol.strip()

    def _module_candidates(self, module: Any) -> list[tuple[str, Path]]:
        with self._lock:
            if not self.available:
                raise SourceNotConfiguredError("Исходники не настроены: укажите ONEC_MCP_DUMP_PATH.")
            self._build_index_locked()
            if module is None:
                return sorted(self._index.items())
            if not isinstance(module, str) or not module.strip():
                raise SourceReaderError("module должен быть непустой строкой.")
            path = self._index.get(module.strip())
            if path is None:
                raise SourceNotFoundError("Исходный модуль не найден в read-only выгрузке.")
            return [(module.strip(), path)]

    def _read_indexed_path(self, path: Path) -> str:
        if self._root is None:
            raise SourceNotConfiguredError("Исходники не настроены.")
        resolved = path.resolve(strict=True)
        if not resolved.is_file() or not _path_within_root(self._root, resolved):
            raise SourceNotFoundError("Исходный модуль недоступен в пределах dump-каталога.")
        return resolved.read_text(encoding="utf-8-sig")
