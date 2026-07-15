"""Compact read-only metadata access for a 1C DumpConfigToFiles directory."""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any
from xml.etree import ElementTree

from .source_reader import SourceNotConfiguredError, SourceNotFoundError, SourceReaderError, _path_within_root


MAX_XML_BYTES = 16 * 1024 * 1024
MAX_ATTRIBUTES = 200
MAX_TABULAR_SECTIONS = 50
MAX_SECTION_ATTRIBUTES = 200
MAX_FORMS = 100
MAX_COMMANDS = 100
MAX_TYPES = 10

OBJECT_TYPES = {
    "document": ("Documents", "Документ"),
    "documents": ("Documents", "Документ"),
    "документ": ("Documents", "Документ"),
    "документы": ("Documents", "Документ"),
    "catalog": ("Catalogs", "Справочник"),
    "catalogs": ("Catalogs", "Справочник"),
    "справочник": ("Catalogs", "Справочник"),
    "справочники": ("Catalogs", "Справочник"),
    "informationregister": ("InformationRegisters", "РегистрСведений"),
    "регистрсведений": ("InformationRegisters", "РегистрСведений"),
    "accumulationregister": ("AccumulationRegisters", "РегистрНакопления"),
    "регистрнакопления": ("AccumulationRegisters", "РегистрНакопления"),
    "accountingregister": ("AccountingRegisters", "РегистрБухгалтерии"),
    "регистрбухгалтерии": ("AccountingRegisters", "РегистрБухгалтерии"),
    "calculationregister": ("CalculationRegisters", "РегистрРасчета"),
    "регистррасчета": ("CalculationRegisters", "РегистрРасчета"),
    "dataprocessor": ("DataProcessors", "Обработка"),
    "обработка": ("DataProcessors", "Обработка"),
    "report": ("Reports", "Отчет"),
    "отчет": ("Reports", "Отчет"),
    "businessprocess": ("BusinessProcesses", "БизнесПроцесс"),
    "бизнеспроцесс": ("BusinessProcesses", "БизнесПроцесс"),
    "task": ("Tasks", "Задача"),
    "задача": ("Tasks", "Задача"),
}

_SAFE_NAME = re.compile(r"^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$")

GET_EDT_METADATA_SUMMARY_TOOL: dict[str, Any] = {
    "name": "get_edt_metadata_summary",
    "title": "Компактные метаданные объекта 1С",
    "description": (
        "Возвращает компактную структуру объекта из XML-выгрузки EDT/DumpConfigToFiles: "
        "реквизиты, табличные части, формы и команды."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "objectType": {
                "type": "string",
                "description": "Тип объекта, например Документ, Справочник или РегистрСведений",
            },
            "name": {"type": "string", "description": "Имя объекта метаданных"},
        },
        "required": ["objectType", "name"],
        "additionalProperties": False,
    },
}


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: ElementTree.Element | None, name: str) -> ElementTree.Element | None:
    if element is None:
        return None
    return next((item for item in element if _local_name(item.tag) == name), None)


def _children(element: ElementTree.Element | None, name: str) -> list[ElementTree.Element]:
    if element is None:
        return []
    return [item for item in element if _local_name(item.tag) == name]


def _text(element: ElementTree.Element | None, name: str) -> str | None:
    value = _child(element, name)
    return value.text.strip() if value is not None and value.text and value.text.strip() else None


def _synonym(properties: ElementTree.Element | None) -> str | None:
    synonym = _child(properties, "Synonym")
    if synonym is None:
        return None
    for item in synonym.iter():
        if _local_name(item.tag) == "content" and item.text and item.text.strip():
            return item.text.strip()
    return None


def _types(properties: ElementTree.Element | None) -> list[str]:
    type_node = _child(properties, "Type")
    if type_node is None:
        return []
    values: list[str] = []
    for item in type_node.iter():
        if _local_name(item.tag) == "Type" and item is not type_node and item.text and item.text.strip():
            value = item.text.strip()
            if value not in values:
                values.append(value)
    return values[:MAX_TYPES]


def _attribute(element: ElementTree.Element) -> dict[str, Any]:
    properties = _child(element, "Properties")
    return {
        "name": _text(properties, "Name"),
        "synonym": _synonym(properties),
        "types": _types(properties),
        "fillChecking": _text(properties, "FillChecking"),
    }


def _named_child(element: ElementTree.Element) -> dict[str, Any]:
    properties = _child(element, "Properties")
    return {"name": _text(properties, "Name") or (element.text or "").strip() or None, "synonym": _synonym(properties)}


class MetadataReader:
    def __init__(self, dump_path: str = "") -> None:
        self._configured_path = dump_path.strip()
        self._root: Path | None = None
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

    def status(self) -> dict[str, bool]:
        return {"configured": self.configured, "available": self.available}

    def read(self, arguments: dict[str, Any]) -> dict[str, Any]:
        object_type = arguments.get("objectType")
        name = arguments.get("name")
        if not isinstance(object_type, str) or object_type.strip().casefold() not in OBJECT_TYPES:
            raise SourceReaderError("Для get_edt_metadata_summary укажите поддерживаемый objectType.")
        if not isinstance(name, str) or not _SAFE_NAME.fullmatch(name.strip()):
            raise SourceReaderError("Для get_edt_metadata_summary укажите корректное имя объекта.")
        if not self.available or self._root is None:
            raise SourceNotConfiguredError("XML-метаданные не настроены: укажите ONEC_MCP_DUMP_PATH.")

        directory, normalized_type = OBJECT_TYPES[object_type.strip().casefold()]
        candidate = self._root / directory / f"{name.strip()}.xml"
        try:
            resolved = candidate.resolve(strict=True)
        except OSError as exc:
            raise SourceNotFoundError("XML-метаданные объекта не найдены.") from exc
        if not resolved.is_file() or not _path_within_root(self._root, resolved):
            raise SourceNotFoundError("XML-метаданные недоступны в пределах dump-каталога.")
        if resolved.stat().st_size > MAX_XML_BYTES:
            raise SourceReaderError("XML-метаданные объекта превышают допустимый размер.")
        raw = resolved.read_bytes()
        if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
            raise SourceReaderError("DTD и ENTITY запрещены в XML-метаданных.")
        try:
            root = ElementTree.fromstring(raw)
        except ElementTree.ParseError as exc:
            raise SourceReaderError("XML-метаданные объекта повреждены.") from exc

        metadata_object = next(iter(root), None)
        if metadata_object is None:
            raise SourceReaderError("XML-метаданные объекта не содержат корневой объект.")
        properties = _child(metadata_object, "Properties")
        child_objects = _child(metadata_object, "ChildObjects")
        attributes = [_attribute(item) for item in _children(child_objects, "Attribute")]
        sections = []
        for section in _children(child_objects, "TabularSection")[:MAX_TABULAR_SECTIONS]:
            section_properties = _child(section, "Properties")
            section_children = _child(section, "ChildObjects")
            section_attributes = [_attribute(item) for item in _children(section_children, "Attribute")]
            sections.append({
                "name": _text(section_properties, "Name"),
                "synonym": _synonym(section_properties),
                "attributes": section_attributes[:MAX_SECTION_ATTRIBUTES],
                "attributesTruncated": len(section_attributes) > MAX_SECTION_ATTRIBUTES,
            })
        forms = [_named_child(item) for item in _children(child_objects, "Form")]
        commands = [_named_child(item) for item in _children(child_objects, "Command")]
        payload = {
            "objectType": normalized_type,
            "name": _text(properties, "Name") or name.strip(),
            "synonym": _synonym(properties),
            "comment": _text(properties, "Comment"),
            "uuid": metadata_object.attrib.get("uuid"),
            "relativePath": resolved.relative_to(self._root).as_posix(),
            "attributes": attributes[:MAX_ATTRIBUTES],
            "attributesTruncated": len(attributes) > MAX_ATTRIBUTES,
            "tabularSections": sections,
            "tabularSectionsTruncated": len(_children(child_objects, "TabularSection")) > MAX_TABULAR_SECTIONS,
            "forms": forms[:MAX_FORMS],
            "formsTruncated": len(forms) > MAX_FORMS,
            "commands": commands[:MAX_COMMANDS],
            "commandsTruncated": len(commands) > MAX_COMMANDS,
            "metadataComplete": True,
        }
        return {
            "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
            "metadataComplete": True,
            "isError": False,
        }
