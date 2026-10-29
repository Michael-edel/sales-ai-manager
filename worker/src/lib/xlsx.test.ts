import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractXlsx } from "./xlsx";

function workbook(sheet: string, shared = "<sst><si><t>Автомат</t></si></sst>") {
  const parts: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="Заявка" r:id="r1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/sharedStrings.xml": strToU8(shared),
  };
  return new File([zipSync(parts)], "request.xlsx");
}
describe("private XLSX extraction in the Worker", () => {
  it("extracts shared, inline and cached values while retaining empty columns", async () => {
    const file = workbook(`<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>16А</t></is></c><c r="D1"><f>2+3</f><v>5</v></c></row></sheetData></worksheet>`);
    const result = await extractXlsx(file);
    expect(result.text).toContain("Автомат |  | 16А | 5");
  });
  it("rejects malformed, empty and external entity files safely", async () => {
    await expect(extractXlsx(new File(["bad"], "x.xlsx"))).rejects.toThrow(/не удалось прочитать/i);
    await expect(extractXlsx(workbook(`<worksheet><sheetData/></worksheet>`))).rejects.toThrow(/не найдено/);
    await expect(extractXlsx(workbook(`<!DOCTYPE worksheet [<!ENTITY x SYSTEM "file:///secret">]><worksheet/>`))).rejects.toThrow(/структура/i);
  });
});
