import { afterEach, describe, expect, it, vi } from "vitest";
import { saveTextDraft } from "../../../frontend/src/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("draft creation response contract", () => {
  it.each([null, [], "ok", {}, { id: 0, source_type: "text_draft" }, { id: -1, source_type: "text_draft" }, { id: 1.5, source_type: "text_draft" }, { id: "1", source_type: "text_draft" }, { id: 1, source_type: "text" }])("rejects invalid HTTP 200 response %# before the caller can clear its draft", async value => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(saveTextDraft("Автомат — 10 шт", {}, "fixture-submission-key")).rejects.toThrow("Сервер не подтвердил сохранение заявки");
  });
  it("rejects a truncated HTTP 200 body and allows retrying the same payload and key", async () => {
    const saved = { id: 5, source_type: "text_draft", original_text: "Автомат — 10 шт", ai_result: "" };
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"id":', { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(saved), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", mockFetch);
    const args = [saved.original_text, { client_company: "Тест" }, "fixture-submission-key"];
    await expect(saveTextDraft(...args)).rejects.toThrow("Сервер не подтвердил сохранение заявки");
    await expect(saveTextDraft(...args)).resolves.toEqual(saved);
    expect(mockFetch.mock.calls[0]).toEqual(mockFetch.mock.calls[1]);
  });
});
