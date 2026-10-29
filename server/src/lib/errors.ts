export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'solicitud_invalida', msg, details);
export const unauthorized = (msg = 'Sesión no válida o expirada') => new AppError(401, 'no_autenticado', msg);
export const forbidden = (msg = 'No tienes permiso para realizar esta acción') => new AppError(403, 'sin_permiso', msg);
export const notFound = (msg = 'Registro no encontrado') => new AppError(404, 'no_encontrado', msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'conflicto', msg, details);
export const tooMany = (msg: string) => new AppError(429, 'demasiados_intentos', msg);
