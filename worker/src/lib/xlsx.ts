import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export class XlsxError extends Error {}
const MAX_XML = 20 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_CELLS = 100_000;
const MAX_TEXT = 120_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: false, processEntities: true, isArray: name => ["sheet", "Relationship", "si", "r", "row", "c"].includes(name) });
const arr = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v];
function xml(bytes: Uint8Array | undefined): any {
  if (!bytes) throw new XlsxError("В книге отсутствуют необходимые данные.");
  const str = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(str) || XMLValidator.validate(str) !== true) throw new XlsxError("Некорректная или неподдерживаемая структура Excel.");
  return parser.parse(str);
}
function text(v: any): string {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  return String(v["#text"] ?? "") + arr(v.t).map(text).join("") + arr(v.r).map(text).join("");
}
export async function extractXlsx(file: File): Promise<{ text: string; warnings: string[]; parser: string; pages: [] }> {
  try {
    const input = new Uint8Array(await file.arrayBuffer());
    let total = 0, entries = 0; const names = new Set<string>();
    const parts = unzipSync(input, { filter(info) {
      if (++entries > MAX_ENTRIES || names.has(info.name)) throw new XlsxError("Книга содержит слишком много или повторяющиеся файлы.");
      names.add(info.name);
      const needed = info.name === "xl/workbook.xml" || info.name === "xl/_rels/workbook.xml.rels" || info.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet[0-9]+\.xml$/.test(info.name);
      if (!needed) return false;
      total += info.originalSize;
      if (!Number.isSafeInteger(info.originalSize) || info.originalSize > MAX_XML || total > MAX_XML) throw new XlsxError("Книга слишком большая для обработки. Разделите её на несколько файлов.");
      return true;
    } });
    const book = xml(parts["xl/workbook.xml"]).workbook;
    const rels = arr(xml(parts["xl/_rels/workbook.xml.rels"]).Relationships?.Relationship);
    const links = new Map(rels.filter(r => !r["@_TargetMode"]).map(r => [String(r["@_Id"]), String(r["@_Target"])]));
    const shared = parts["xl/sharedStrings.xml"] ? arr(xml(parts["xl/sharedStrings.xml"]).sst?.si).map(text) : [];
    let cells = 0; const sections: string[] = []; let hasFormulaWithoutValue = false;
    for (const sheet of arr(book?.sheets?.sheet)) {
      let path = links.get(String(sheet["@_r:id"])) || "";
      path = path.startsWith("/") ? path.slice(1) : `xl/${path}`;
      if (!/^xl\/worksheets\/sheet[0-9]+\.xml$/.test(path)) throw new XlsxError("Не удалось безопасно открыть лист Excel.");
      const root = xml(parts[path]).worksheet; const lines: string[] = [];
      for (const row of arr(root?.sheetData?.row)) {
        const values: string[] = [];
        for (const c of arr(row.c)) {
          const ref = String(c["@_r"] || "");
          const letters = /^([A-Z]+)[1-9][0-9]*$/.exec(ref)?.[1];
          if (letters) {
            const column = [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
            if (column > 1024 || column <= values.length) throw new XlsxError("Недопустимые столбцы или порядок ячеек в Excel.");
            while (values.length < column - 1) values.push("");
          }
          if (++cells > MAX_CELLS) throw new XlsxError("В книге слишком много ячеек. Разделите её на несколько файлов.");
          const kind = String(c["@_t"] || ""); let value = c.v == null ? "" : text(c.v);
          if (kind === "s") { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n >= shared.length) throw new XlsxError("Повреждён список строк Excel."); value = shared[n]; }
          else if (kind === "inlineStr") value = text(c.is);
          else if (kind === "b") value = value === "1" ? "Да" : "Нет";
          else if (kind === "e") value = `[Ошибка Excel: ${value}]`;
          if (c.f != null && (c.v == null || value === "")) { value = "[Формула без сохранённого значения]"; hasFormulaWithoutValue = true; }
          values.push(value.replace(/[\r\n\t]+/g, " ").trim());
        }
        if (values.some(Boolean)) lines.push(values.join(" | "));
      }
      if (lines.length) sections.push(`Лист: ${String(sheet["@_name"] || "Лист")}\n${lines.join("\n")}`);
    }
    const result = sections.join("\n\n");
    if (!result) throw new XlsxError("В книге Excel не найдено заполненных ячеек.");
    if (result.length > MAX_TEXT) throw new XlsxError("Текст книги слишком большой для обработки. Разделите её на несколько файлов.");
    return { text: result, pages: [], parser: "xlsx-worker", warnings: ["Проверьте даты и форматирование чисел по исходному файлу.", ...(hasFormulaWithoutValue ? ["В книге есть формулы без сохранённого результата."] : [])] };
  } catch (error) {
    if (error instanceof XlsxError) throw error;
    throw new XlsxError("Не удалось прочитать Excel. Проверьте, что это неповреждённый файл XLSX без пароля.");
  }
}
