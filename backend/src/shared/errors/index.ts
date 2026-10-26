import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorResponse } from '../types/index.js';

/**
 * Custom application error with HTTP status code.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public errorCode?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, `${resource} not found`, 'not_found');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'forbidden');
  }
}

export class ValidationError extends AppError {
  errors: string[];

  constructor(errors: string[]) {
    super(422, 'Validation failed', 'validation_error');
    this.errors = errors;
  }
}

/**
 * Register global error handler on the Fastify instance.
 */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    const isDev = process.env.NODE_ENV === 'development';

    // Zod validation errors
    if (error instanceof ZodError) {
      const body: ApiErrorResponse = {
        error: 'Validation failed',
        errors: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      };
      return reply.status(422).send(body);
    }

    // Custom application errors
    if (error instanceof ValidationError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        errors: error.errors,
        error_code: error.errorCode,
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        error_code: error.errorCode,
      });
    }

    // Fastify built-in validation (schema)
    if (error.statusCode === 400 && error.validation) {
      return reply.status(400).send({
        error: 'Bad Request',
        errors: error.validation.map((v) => v.message ?? 'Invalid input'),
      });
    }

    // JWT errors
    if (error.statusCode === 401) {
      return reply.status(401).send({
        error: 'Unauthorized',
        error_code: 'unauthorized',
      });
    }

    // Unknown errors — log and return 500
    fastify.log.error(error);

    return reply.status(500).send({
      error: isDev ? error.message : 'Internal Server Error',
      error_code: 'internal_error',
    });
  });
}
