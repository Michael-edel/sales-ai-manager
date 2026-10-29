import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {extractDocx} from "./docx";
const path=process.env.MICHAEL_DOCX_FIXTURE;
describe.skipIf(!path)("real private DOCX",()=>{it("extracts the source document",async()=>{const result=await extractDocx(new File([readFileSync(path!)],"request.docx"));expect(result.text.length).toBeGreaterThan(500);expect(result.text).toContain(" | ");});});
