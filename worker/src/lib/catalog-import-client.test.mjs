import { beforeEach, describe, expect, it, vi } from "vitest";
import { importCatalogFile, readImportCheckpoint } from "../../../frontend/src/lib/catalog-import.mjs";

const id = "64cc1b5e-ed46-419b-84eb-fb9fb9f9f019";
const makeFile = (count = 205) => new File([JSON.stringify({ schemaVersion: 1, sourceSystem: "michael-cabinet",
  exportedAt: "2026-10-28T11:59:39.758Z", environment: "test",
  offers: Array.from({ length: count }, (_, n) => ({ id: `offer:${n}` })) })], "private-catalog.json");
let storage, values, api, metadata, received, uploaded;
beforeEach(() => {
  values = new Map();
  storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  received = 0; uploaded = [];
  api = {
    create: vi.fn(async meta => { metadata = meta; return { id, storageVersion: 2 }; }),
    get: vi.fn(async () => ({ id, storageVersion: 2, expectedCount: metadata.offerCount,
      exportedAt: metadata.exportedAt, environment: metadata.environment, contentHash: metadata.contentHash,
      receivedCount: received, batches: uploaded.map(index => ({ index, offerCount: Math.min(100, metadata.offerCount - index * 100) })) })),
    upload: vi.fn(async (_, index, offers) => { uploaded.push(index); received += offers.length; return { receivedCount: received }; }),
    commit: vi.fn(async () => ({ activeSnapshot: { id, offerCount: metadata.offerCount } })),
  };
});
const run = file => importCatalogFile(file, { api, storage, userId: 7, signal: new AbortController().signal });

describe("resumable private catalogue import", () => {
  it("resumes a failed upload with the same import and skips confirmed batches after a reload", async () => {
    const file = makeFile();
    const upload = api.upload;
    api.upload = vi.fn(async (...args) => { if (args[1] === 1) throw new Error("offline"); return upload(...args); });
    await expect(run(file)).rejects.toThrow("offline");
    expect(readImportCheckpoint(storage, 7).id).toBe(id);
    expect(api.commit).not.toHaveBeenCalled();
    api.upload = upload;
    await expect(run(file)).resolves.toEqual({ activeSnapshot: { id, offerCount: 205 } });
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(uploaded).toEqual([0, 1, 2]);
    expect(readImportCheckpoint(storage, 7)).toBeNull();
  });
  it("retains checkpoint when activation is not confirmed and replays only commit", async () => {
    api.commit.mockResolvedValueOnce(null);
    await expect(run(makeFile(5))).rejects.toThrow("не подтвердил активацию");
    expect(readImportCheckpoint(storage, 7)).not.toBeNull();
    await run(makeFile(5));
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.commit).toHaveBeenCalledTimes(2);
  });
  it("refuses the legacy write-heavy server before sending the first batch", async () => {
    api.create.mockResolvedValue({ id });
    await expect(run(makeFile())).rejects.toThrow("Сервер ещё не обновлён");
    expect(api.upload).not.toHaveBeenCalled();
  });
  it("does not trust a resume manifest for a different source file", async () => {
    api.upload.mockRejectedValueOnce(new Error("offline"));
    await expect(run(makeFile())).rejects.toThrow("offline");
    const get = api.get;
    api.get = async () => ({ ...await get(), contentHash: "0".repeat(64) });
    await expect(run(makeFile())).rejects.toThrow("другому файлу");
    expect(api.upload).toHaveBeenCalledTimes(1);
  });
  it("detects duplicate IDs across batches before opening an import", async () => {
    const source = JSON.parse(await makeFile().text()); source.offers[204].id = source.offers[0].id;
    await expect(run(new File([JSON.stringify(source)], "duplicate.json"))).rejects.toThrow("повторяются ID");
    expect(api.create).not.toHaveBeenCalled();
  });
  it("does not silently start an unresumable import if browser storage is blocked", async () => {
    storage.setItem = () => { throw new Error("blocked"); };
    await expect(run(makeFile())).rejects.toThrow("не разрешает сохранять");
    expect(api.create).not.toHaveBeenCalled();
  });
  it("never stores catalogue contents, procurement prices or credentials in the checkpoint", async () => {
    api.upload.mockRejectedValueOnce(new Error("offline"));
    await expect(run(makeFile())).rejects.toThrow("offline");
    expect(Object.keys(readImportCheckpoint(storage, 7)).sort()).toEqual(["contentHash", "fileName", "id", "offerCount"]);
    expect(readImportCheckpoint(storage, 8)).toBeNull();
  });
});
