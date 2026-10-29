import {describe,it,expect} from "vitest";
import {zipSync,strToU8} from "fflate";
import {extractDocx} from "./docx";
const file=(doc:string)=>new File([zipSync({"word/document.xml":strToU8(doc)})],"test.docx");
describe("DOCX processing",()=>{
 it("preserves paragraph, table row and cell order",async()=>{
 const doc='<w:document><w:body><w:p><w:r><w:t>Товары</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Кабель</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Итого</w:t></w:r></w:p></w:body></w:document>';
 const result=await extractDocx(file(doc));expect(result.text).toBe("Товары\nКабель | 5\nИтого");
 });
 it("ignores deleted text and rejects untrusted document structures",async()=>{
 expect((await extractDocx(file('<w:document><w:body><w:p><w:del><w:r><w:t>deleted</w:t></w:r></w:del><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>'))).text).toBe('ok');
 await expect(extractDocx(file('<!DOCTYPE w:document [<!ENTITY a SYSTEM "file:///secret">]><w:document/>'))).rejects.toThrow(/структура/i);
 await expect(extractDocx(new File(["bad"],"bad.docx"))).rejects.toThrow(/не удалось/i);
 });
});
