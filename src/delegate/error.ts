export class NoslatedStreamError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}

export class CapacityExceededError extends Error {
  name = 'CapacityExceededError';
  status = 400;
}

export class NotFoundError extends Error {
  name = 'NotFoundError';
  status = 404;
}

export class ConflictError extends Error {
  name = 'ConflictError';
  status = 409;
}
