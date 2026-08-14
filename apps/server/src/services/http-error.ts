export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message: string, code = "NOT_FOUND") => new HttpError(404, code, message);
export const conflict = (message: string, code = "CONFLICT") => new HttpError(409, code, message);
export const badRequest = (message: string, code = "BAD_REQUEST") => new HttpError(400, code, message);
