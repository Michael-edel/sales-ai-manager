export const DEFAULT_EXTERNAL_TIMEOUT_MS = 30_000;
export const AI_EXTERNAL_TIMEOUT_MS = 90_000;
export const PARSER_EXTERNAL_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_EXTERNAL_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Внешний сервис не ответил за ${Math.ceil(timeoutMs / 1000)} секунд.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
