export class StaleSessionResponseError extends Error {
  constructor() { super("Сеанс изменён."); this.name = "AbortError"; this.staleSessionResponse = true; }
}

export const isStaleSessionResponse = error => error?.staleSessionResponse === true;

export function createSessionRequestGuard() {
  let generation = 0;
  return {
    invalidate() { generation++; },
    capture() {
      const captured = generation;
      return () => { if (captured !== generation) throw new StaleSessionResponseError(); };
    },
  };
}
