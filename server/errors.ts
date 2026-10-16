export class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function assert(condition: unknown, code: string, message: string, statusCode = 400): asserts condition {
  if (!condition) throw new AppError(statusCode, code, message);
}
