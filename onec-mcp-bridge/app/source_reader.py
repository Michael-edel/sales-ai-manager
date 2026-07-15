"""Read-only source access for a configured DumpConfigToFiles directory."""

from __future__ import annotations

import json
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
