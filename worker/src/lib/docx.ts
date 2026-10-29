import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
export class DocxError extends Error {}
const MAX_XML = 20 * 1024 * 1024, MAX_ENTRIES = 512, MAX_TEXT = 120_000;
type XmlNode = Record<string, unknown>;
const parser = new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false,processEntities:true});
function nodes(value: unknown): XmlNode[] { return Array.isArray(value) ? value as XmlNode[] : []; }
function plain(items: XmlNode[], depth = 0): string {
  if (depth > 128) throw new DocxError("Документ слишком сложен для обработки.");
  let result = "";
  for (const node of items) for (const [key,value] of Object.entries(node)) {
    if (key === "w:del" || key === "w:instrText" || key === ":@") continue;
    if (key === "#text") result += String(value ?? "");
    else if (key === "w:tab") result += "\t";
    else if (key === "w:br" || key === "w:cr") result += "\n";
    else result += plain(nodes(value), depth + 1);
    if (result.length > MAX_TEXT) throw new DocxError("Текст документа слишком большой. Разделите документ на части.");
  }
  return result;
}
function content(items: XmlNode[], depth = 0): string[] {
  if (depth > 128) throw new DocxError("Документ слишком сложен для обработки.");
  const result:string[]=[];
  for (const node of items) for (const [key,value] of Object.entries(node)) {
    if (key === "w:del" || key === ":@") continue;
    if (key === "w:p") { const valueText=plain(nodes(value)).trim(); if(valueText) result.push(valueText); }
    else if (key === "w:tbl") {
      for (const row of nodes(value)) if(row["w:tr"]) {
        const cells=nodes(row["w:tr"]).filter(c=>c["w:tc"]).map(c=>content(nodes(c["w:tc"]),depth+1).join(" "));
        if(cells.some(Boolean)) result.push(cells.join(" | "));
      }
    } else if (key !== "#text") result.push(...content(nodes(value),depth+1));
  }
  return result;
}
export async function extractDocx(file: File): Promise<{text:string;warnings:string[];parser:string;pages:[]}> {
  try {
    const input = new Uint8Array(await file.arrayBuffer()); let total=0,count=0; const names=new Set<string>();
    const parts=unzipSync(input,{filter(info){
      if(++count>MAX_ENTRIES||names.has(info.name)) throw new DocxError("Документ содержит слишком много или повторяющиеся файлы.");
      names.add(info.name); const needed=info.name==="word/document.xml";
      if(!needed)return false; total+=info.originalSize;
      if(!Number.isSafeInteger(info.originalSize)||total>MAX_XML) throw new DocxError("Документ слишком большой. Разделите его на части.");
      return true;
    }});
    if(!parts["word/document.xml"])throw new DocxError("В документе отсутствует основной текст.");
    const xml=new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(parts["word/document.xml"]);
    if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new DocxError("Некорректная или неподдерживаемая структура Word.");
    const body=parser.parse(xml) as XmlNode[];
    const text=content(body).join("\n").trim();
    if(!text)throw new DocxError("В документе не найден текст. Если это скан или изображения, загрузите их как PDF или изображения.");
    if(text.length>MAX_TEXT)throw new DocxError("Текст документа слишком большой. Разделите его на части.");
    return {text,warnings:["Проверьте текст и таблицы по оригиналу; изображения и колонтитулы отдельно не распознаются."],parser:"docx-worker",pages:[]};
  } catch(error) {
    if(error instanceof DocxError)throw error;
    throw new DocxError("Не удалось прочитать Word. Проверьте, что это неповреждённый файл DOCX без пароля.");
  }
}
