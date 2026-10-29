import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractXlsx } from "./xlsx";
describe.skipIf(!process.env.XLSX_FIXTURE)("real private XLSX", () => {
  it("extracts the workbook without exposing its content", async () => {
    const bytes = readFileSync(process.env.XLSX_FIXTURE!);
    const parsed = await extractXlsx(new File([bytes], "request.xlsx"));
    expect(parsed.text.length).toBeGreaterThan(200);
    expect(parsed.text).toContain("Лист:");
  });
});
