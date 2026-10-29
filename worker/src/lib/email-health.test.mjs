import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import { emailSmtpHealthPresentation } from "../../../frontend/src/components/email/email-utils.js";

let env, externalFetch;
beforeEach(() => {
  env = {
    EMAIL_BRIDGE_URL: "https://email.example.test",
    EMAIL_BRIDGE_TOKEN: "fixture-bridge-token",
    DB: {
      prepare: sql => {
        if (sql.includes("FROM smtp_settings")) return { first: async () => null };
        if (!sql.includes("FROM auth_sessions")) throw new Error("Unexpected database mutation or query");
        return { bind: () => ({ first: async () => ({
          id: 1, username: "fixture", display_name: "Fixture", role: "manager", email_address: "fixture@edel.kz",
          last_seen_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
        }) }) };
      },
    },
  };
  externalFetch = vi.fn();
  vi.stubGlobal("fetch", externalFetch);
});
afterEach(() => vi.unstubAllGlobals());

async function health(authenticated = true) {
  const response = await worker.fetch(new Request("https://ai.michael.kz/api/email/smtp/health", {
    headers: authenticated ? { Cookie: "sales_ai_session=fixture-session" } : {},
  }), env);
  return { status: response.status, data: await response.json() };
}
const reply = data => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

describe("SMTP health without sending mail", () => {
  it("requires a session and does not contact a bridge without a URL", async () => {
    expect((await health(false)).status).toBe(401);
    env.EMAIL_BRIDGE_URL = "";
    const result = await health();
    expect(result.data).toMatchObject({ configured: false, reachable: false, status: "not_configured" });
    expect(emailSmtpHealthPresentation(result.data)).toEqual({ className: "warn", text: "SMTP: подключение не настроено" });
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it("distinguishes an available bridge without SMTP accounts from configured SMTP", async () => {
    externalFetch.mockResolvedValueOnce(reply({ service: "email-bridge", status: "ok", smtp_configured: false }));
    const result = await health();
    expect(result.data).toMatchObject({ configured: true, reachable: true, smtp_configured: false, status: "smtp_not_configured" });
    expect(emailSmtpHealthPresentation(result.data)).toEqual({ className: "warn", text: "SMTP: почтовые аккаунты не настроены" });
  });

  it("reports configuration only, performs GET health and never attempts login or sending", async () => {
    externalFetch.mockResolvedValueOnce(reply({ service: "email-bridge", status: "ok", smtp_configured: true }));
    const result = await health();
    expect(result.data).toMatchObject({ configured: true, reachable: true, smtp_configured: true, status: "ok" });
    expect(emailSmtpHealthPresentation(result.data)).toEqual({ className: "ok", text: "SMTP настроен · отправка не проверена" });
    expect(externalFetch).toHaveBeenCalledTimes(1);
    const [url, options] = externalFetch.mock.calls[0];
    expect(url).toBe("https://email.example.test/health");
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect(options.headers.get("X-Email-Bridge-Token")).toBe(env.EMAIL_BRIDGE_TOKEN);
    expect(JSON.stringify(result.data)).not.toContain(env.EMAIL_BRIDGE_TOKEN);
  });

  it.each([undefined, "true", 1])("does not treat missing or malformed SMTP flag %s as configured", async flag => {
    externalFetch.mockResolvedValueOnce(reply({ service: "email-bridge", status: "ok", smtp_configured: flag }));
    const result = await health();
    expect(result.data).toMatchObject({ reachable: true, smtp_configured: null, status: "smtp_unknown" });
    expect(emailSmtpHealthPresentation(result.data)).toEqual({ className: "warn", text: "SMTP: настройки не подтверждены" });
  });

  it.each(["<html>Login</html>", JSON.stringify({ status: "ok" }), JSON.stringify({ service: "other", status: "ok", smtp_configured: true })])("rejects an unrelated HTTP 200 response", async body => {
    externalFetch.mockResolvedValueOnce(new Response(body));
    const result = await health();
    expect(result.data).toMatchObject({ reachable: false, status: "invalid_response" });
    expect(emailSmtpHealthPresentation(result.data).className).toBe("error");
  });

  it("reports bridge HTTP and network failures without returning raw upstream details", async () => {
    externalFetch.mockResolvedValueOnce(new Response("private upstream diagnostics", { status: 530 }));
    const http = await health();
    expect(http.data).toMatchObject({ reachable: false, status: "error", detail: "Email bridge вернул HTTP 530." });
    externalFetch.mockRejectedValueOnce(new Error("private connection details"));
    const network = await health();
    expect(network.data).toMatchObject({ reachable: false, status: "unreachable" });
    expect(JSON.stringify([http, network])).not.toContain("private");
    expect(emailSmtpHealthPresentation(network.data).text).toBe("SMTP: сервис недоступен");
  });

  it("does not label initial loading or a failed health request as missing configuration", () => {
    expect(emailSmtpHealthPresentation(null).text).toBe("SMTP: проверка…");
    expect(emailSmtpHealthPresentation({ status: "error", configured: false, reachable: false }).className).toBe("error");
  });
});
