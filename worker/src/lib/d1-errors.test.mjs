import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import { isD1DailyQuotaError } from "./d1-errors";

const readQuota = "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.";
const writeQuota = readQuota.replace("row read limit", "row write limit");
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

async function failAuthenticatedRead(error) {
  const env = { DB: { prepare: () => { throw error; } } };
  return worker.fetch(new Request("https://ai.michael.kz/api/auth/me", {
    headers: { Cookie: "sales_ai_session=fixture-session" },
  }), env);
}

describe("confirmed D1 daily quota errors", () => {
  it.each([readQuota, writeQuota])("returns safe 503 and a UTC reset retry hint", async message => {
    const response = await failAuthenticatedRead(new Error("D1_ERROR: " + message));
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(86400);
    const result = await response.json();
    expect(result.error_code).toBe("D1_DAILY_LIMIT");
    expect(result.error_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.detail).toContain("00:00 UTC");
    expect(JSON.stringify(result)).not.toContain("D1_ERROR");
    expect(JSON.stringify(result)).not.toContain("free tier");
  });
  it("recognizes a known quota wrapped as an Error cause", () => {
    expect(isD1DailyQuotaError(new Error("D1 query failed", { cause: new Error(readQuota) }))).toBe(true);
  });
  it.each(["D1_ERROR: database is locked", "D1_ERROR: no such table: app_users", "D1_ERROR: query exceeded time limit", "D1_ERROR: Too many rows", "daily row read limit"]) ("does not mask another database error: %s", async message => {
    const error = new Error(message);
    expect(isD1DailyQuotaError(error)).toBe(false);
    const response = await failAuthenticatedRead(error);
    expect(response.status).toBe(500);
    expect((await response.json()).error_code).toBeUndefined();
  });
});
