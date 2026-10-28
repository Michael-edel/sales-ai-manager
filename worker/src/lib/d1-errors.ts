const DAILY_QUOTA_MARKERS = [
  "Your account has exceeded D1's free tier daily row read limit.",
  "Your account has exceeded D1's free tier daily row write limit.",
];

export function isD1DailyQuotaError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    const message = current.message;
    if (DAILY_QUOTA_MARKERS.some(marker => message.includes(marker))) return true;
    current = current.cause;
  }
  return false;
}
