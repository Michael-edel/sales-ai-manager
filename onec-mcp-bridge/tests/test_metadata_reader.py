import json
import tempfile
import unittest
from pathlib import Path

from app.metadata_reader import MetadataReader
from app.source_reader import SourceReaderError


XML = """<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Document uuid="test-uuid">
    <Properties>
      <Name>ЗаказКлиента</Name>
      <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Заказ клиента</v8:content></v8:item></Synonym>
      <Comment>Тест</Comment>
    </Properties>
    <ChildObjects>
      <Attribute uuid="a1"><Properties><Name>Партнер</Name><Type><v8:Type>cfg:CatalogRef.Партнеры</v8:Type></Type><FillChecking>ShowError</FillChecking></Properties></Attribute>
      <TabularSection uuid="t1"><Properties><Name>Товары</Name></Properties><ChildObjects><Attribute uuid="a2"><Properties><Name>Номенклатура</Name><Type><v8:Type>cfg:CatalogRef.Номенклатура</v8:Type></Type></Properties></Attribute></ChildObjects></TabularSection>
      <Form>ФормаДокумента</Form>
      <Command>Пересчитать</Command>
    </ChildObjects>
  </Document>
</MetaDataObject>
"""


class MetadataReaderTests(unittest.TestCase):
    def test_returns_compact_object_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path = root / "Documents" / "ЗаказКлиента.xml"
            path.parent.mkdir(parents=True)
            path.write_text(XML, encoding="utf-8")

            result = MetadataReader(str(root)).read({"objectType": "Документ", "name": "ЗаказКлиента"})
            payload = json.loads(result["content"][0]["text"])

            self.assertEqual(payload["objectType"], "Документ")
            self.assertEqual(payload["synonym"], "Заказ клиента")
            self.assertEqual(payload["attributes"][0]["name"], "Партнер")
            self.assertEqual(payload["attributes"][0]["types"], ["cfg:CatalogRef.Партнеры"])
            self.assertEqual(payload["tabularSections"][0]["attributes"][0]["name"], "Номенклатура")
            self.assertEqual(payload["forms"][0]["name"], "ФормаДокумента")
            self.assertTrue(payload["metadataComplete"])

    def test_rejects_unsafe_name_and_doctype(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            documents = root / "Documents"
            documents.mkdir()
            with self.assertRaises(SourceReaderError):
                MetadataReader(str(root)).read({"objectType": "Документ", "name": "../secret"})

            (documents / "ЗаказКлиента.xml").write_text(
                '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]><MetaDataObject/>',
                encoding="utf-8",
            )
            with self.assertRaises(SourceReaderError):
                MetadataReader(str(root)).read({"objectType": "Документ", "name": "ЗаказКлиента"})


if __name__ == "__main__":
    unittest.main()
