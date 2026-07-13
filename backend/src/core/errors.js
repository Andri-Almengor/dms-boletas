export class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message); this.name = 'AppError'; this.code = code; this.status = status; this.details = details;
  }
}
export const badRequest = (message, details) => new AppError('VALIDATION_ERROR', message, 400, details);
export const forbidden = (message = 'No cuenta con permiso para realizar esta acción.') => new AppError('FORBIDDEN', message, 403);
export const notFound = (message = 'No se encontró el registro solicitado.') => new AppError('NOT_FOUND', message, 404);
export const unauthorized = (message = 'La sesión no es válida o expiró.') => new AppError('UNAUTHORIZED', message, 401);
