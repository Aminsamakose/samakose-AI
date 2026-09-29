export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, details?: unknown) => new ApiError(400, 'bad_request', m, details);
export const unauthorized = (m = 'Sign in required') => new ApiError(401, 'unauthorized', m);
export const forbidden = (m = 'You do not have permission to do this') => new ApiError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new ApiError(404, 'not_found', m);
export const conflict = (m: string, details?: unknown) => new ApiError(409, 'conflict', m, details);
export const unprocessable = (m: string, details?: unknown) => new ApiError(422, 'invalid_state', m, details);
export const tooMany = (m = 'Too many attempts. Try again later.') => new ApiError(429, 'rate_limited', m);
/** A validation failure tied to named fields, so forms can show the message beside the input. */
export const fieldError = (fields: Record<string, string>) => new ApiError(400, 'validation_failed', 'Some fields need attention', fields);
