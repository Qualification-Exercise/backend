export function apiError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}
