"""Bounded read-only access to live 1C register records."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from .source_reader import SourceReaderError


MAX_REGISTER_ROWS = 500

_SAFE_NAME = re.compile(r"^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$")
_REGISTER_TYPES = {
    "accumulationregister": "РегистрНакопления",
    "регистрнакопления": "РегистрНакопления",
    "informationregister": "РегистрСведений",
    "регистрсведений": "РегистрСведений",
    "accountingregister": "РегистрБухгалтерии",
    "регистрбухгалтерии": "РегистрБухгалтерии",
    "calculationregister": "РегистрРасчета",
    "регистррасчета": "РегистрРасчета",
}
_REGISTER_FQN = re.compile(
    r"Регистр(Накопления|Сведений|Бухгалтерии|Расчета)\.([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)",
    re.IGNORECASE,
)

READ_REGISTER_RECORDS_TOOL: dict[str, Any] = {
    "name": "read_register_records",
    "title": "Ограниченная выборка записей регистра 1С",
    "description": (
        "Возвращает не более 500 live-записей одного регистра для read-only аудита. "
        "Запрос строится bridge и не принимает произвольный текст запроса 1С."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "registerType": {
                "type": "string",
                "description": (
                    "AccumulationRegister, InformationRegister, AccountingRegister, "
                    "CalculationRegister или auto"
                ),
            },
            "name": {"type": "string", "description": "Имя регистра метаданных"},
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_REGISTER_ROWS,
                "default": 200,
            },
        },
        "required": ["registerType", "name"],
        "additionalProperties": False,
    },
}


def _resolve_register_type(
    name: str,
    call_tool: Callable[[str, dict[str, Any]], dict[str, Any]],
) -> str:
    result = call_tool(
        "search_code",
        {"query": name, "limit": 100, "mode": "exact"},
    )
    raw = json.dumps(result, ensure_ascii=False, default=str)
    matches = {
        f"Регистр{match.group(1)}"
        for match in _REGISTER_FQN.finditer(raw)
        if match.group(2).casefold() == name.casefold()
    }
    if len(matches) != 1:
        raise SourceReaderError(
            "Не удалось однозначно определить вид регистра; укажите registerType явно."
        )
    return matches.pop()


def read_register_records(
    arguments: dict[str, Any],
    call_tool: Callable[[str, dict[str, Any]], dict[str, Any]],
) -> dict[str, Any]:
    name = arguments.get("name")
    register_type = arguments.get("registerType")
    limit = arguments.get("limit", 200)
    if not isinstance(name, str) or not _SAFE_NAME.fullmatch(name.strip()):
        raise SourceReaderError("Укажите корректное имя регистра.")
    if not isinstance(register_type, str):
        raise SourceReaderError("Укажите корректный registerType.")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_REGISTER_ROWS:
        raise SourceReaderError(f"limit должен быть от 1 до {MAX_REGISTER_ROWS}.")

    normalized_type = register_type.strip().casefold().replace(" ", "")
    if normalized_type == "auto":
        object_type = _resolve_register_type(name.strip(), call_tool)
    else:
        try:
            object_type = _REGISTER_TYPES[normalized_type]
        except KeyError as exc:
            raise SourceReaderError("Указан неподдерживаемый registerType.") from exc

    register_fqn = f"{object_type}.{name.strip()}"
    query = (
        f"ВЫБРАТЬ ПЕРВЫЕ {limit}\n"
        "    Записи.*\n"
        "ИЗ\n"
        f"    {register_fqn} КАК Записи"
    )
    upstream = call_tool(
        "execute_query",
        {"query": query, "parameters": {}, "limit": limit},
    )
    payload = {
        "registerFqn": register_fqn,
        "rowLimit": limit,
        "sampleBounded": True,
        "readOnly": True,
        "result": upstream,
    }
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)}],
        "isError": bool(upstream.get("isError", False)) if isinstance(upstream, dict) else False,
        "registerFqn": register_fqn,
        "rowLimit": limit,
        "sampleBounded": True,
        "readOnly": True,
    }
