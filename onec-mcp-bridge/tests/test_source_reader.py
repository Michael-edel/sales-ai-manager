import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from app.source_reader import SourceNotConfiguredError, SourceNotFoundError, SourceReader


class SourceReaderTests(unittest.TestCase):
    def test_reads_base_module_without_bom(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = root / "Documents" / "ЗаказКлиента" / "Ext" / "ObjectModule.bsl"
            module.parent.mkdir(parents=True)
            module.write_text("\ufeffПроцедура Проверка()\nКонецПроцедуры", encoding="utf-8")

            result = SourceReader(str(root)).read({"module": "Документ.ЗаказКлиента.МодульОбъекта"})
            payload = json.loads(result["content"][0]["text"])

            self.assertTrue(result["sourceComplete"])
            self.assertEqual(payload["source"], "Процедура Проверка()\nКонецПроцедуры")
            self.assertEqual(payload["relativePath"], "Documents/ЗаказКлиента/Ext/ObjectModule.bsl")

    def test_reads_only_requested_method_with_original_line_numbers(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = root / "Documents" / "ЗаказКлиента" / "Ext" / "ObjectModule.bsl"
            module.parent.mkdir(parents=True)
            module.write_bytes((
                "Префикс = 1;\r\n" * 4
                + "Функция РассчитатьСебестоимость() Экспорт\r\n"
                + "\tВозврат 42;\r\n"
                + "КонецФункции;\r\n"
                + "Хвост = 2;\r\n"
            ).encode("utf-8"))

            result = SourceReader(str(root)).read_method({
                "module": "Документ.ЗаказКлиента.МодульОбъекта",
                "method": "РассчитатьСебестоимость",
            })
            payload = json.loads(result["content"][0]["text"])

            self.assertEqual(payload["sourceScope"], "method")
            self.assertEqual(payload["kind"], "function")
            self.assertEqual(payload["sourceLineStart"], 5)
            self.assertEqual(payload["sourceLineEnd"], 7)
            self.assertEqual(payload["source"].splitlines()[4:], [
                "Функция РассчитатьСебестоимость() Экспорт",
                "\tВозврат 42;",
                "КонецФункции;",
            ])
            self.assertNotIn("Хвост", payload["source"])

    def test_reads_extension_form_module(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = (
                root
                / "Расширения"
                / "Продажи"
                / "Documents"
                / "ЗаказКлиента"
                / "Forms"
                / "ФормаДокумента"
                / "Ext"
                / "FormModule.bsl"
            )
            module.parent.mkdir(parents=True)
            module.write_text("Функция Тест()\nКонецФункции", encoding="utf-8")

            result = SourceReader(str(root)).read(
                {"module": "ext.Продажи.Документ.ЗаказКлиента.Форма.ФормаДокумента.МодульФормы"}
            )

            self.assertTrue(result["sourceComplete"])

    def test_rejects_symlink_outside_dump(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, tempfile.TemporaryDirectory() as outside_dir:
            root = Path(temp_dir)
            secret = Path(outside_dir) / "secret.bsl"
            secret.write_text("Секрет", encoding="utf-8")
            link = root / "CommonModules" / "Leak" / "Ext" / "Module.bsl"
            link.parent.mkdir(parents=True)
            try:
                link.symlink_to(secret)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks are unavailable on this Windows environment")

            with self.assertRaises(SourceNotFoundError):
                SourceReader(str(root)).read({"module": "ОбщийМодуль.Leak.Модуль"})

    def test_unconfigured_reader_fails_closed(self) -> None:
        reader = SourceReader("")
        self.assertFalse(reader.available)
        with self.assertRaises(SourceNotConfiguredError):
            reader.read({"module": "Документ.ЗаказКлиента.МодульОбъекта"})

    def test_v09_source_navigation_tools(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            first = root / "Documents" / "ЗаказКлиента" / "Ext" / "ObjectModule.bsl"
            second = root / "CommonModules" / "Продажи" / "Ext" / "Module.bsl"
            first.parent.mkdir(parents=True)
            second.parent.mkdir(parents=True)
            first_source = (
                "Функция РассчитатьСебестоимость() Экспорт\n"
                "    Возврат Продажи.РассчитатьСебестоимость();\n"
                "КонецФункции\n"
            )
            first.write_text(first_source, encoding="utf-8")
            second.write_text(
                "Функция РассчитатьСебестоимость()\nВозврат 1;\nКонецФункции\n",
                encoding="utf-8",
            )
            reader = SourceReader(str(root))

            methods = json.loads(reader.list_methods({
                "module": "Документ.ЗаказКлиента.МодульОбъекта"
            })["content"][0]["text"])
            self.assertEqual(methods["methods"][0]["name"], "РассчитатьСебестоимость")
            self.assertTrue(methods["methods"][0]["export"])

            resolved = json.loads(reader.resolve_symbol({
                "symbol": "РассчитатьСебестоимость"
            })["content"][0]["text"])
            self.assertEqual(resolved["count"], 2)

            references = json.loads(reader.find_references({
                "symbol": "РассчитатьСебестоимость",
                "maxResults": 10,
            })["content"][0]["text"])
            self.assertEqual(references["count"], 3)

            checksum = json.loads(reader.checksum({
                "module": "Документ.ЗаказКлиента.МодульОбъекта"
            })["content"][0]["text"])
            self.assertEqual(checksum["sha256"], hashlib.sha256(first_source.encode()).hexdigest())

            estimate = json.loads(reader.estimate_payload({
                "tool": "read_method_source",
                "module": "Документ.ЗаказКлиента.МодульОбъекта",
                "method": "РассчитатьСебестоимость",
            })["content"][0]["text"])
            self.assertGreater(estimate["responseBytes"], estimate["sourceBytes"])


if __name__ == "__main__":
    unittest.main()
