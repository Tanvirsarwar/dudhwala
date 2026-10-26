import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';
import { InvalidTransitionError } from '@dudhwala/shared';
import { AppError } from './errors.js';
import '../access/request-augment.js';


export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : `req_${randomUUID()}`;
  res.setHeader('x-request-id', req.requestId);
  next();
}

/** Uniform error body (API_SPECIFICATION §1.1). Stack traces never reach clients. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requestId = req.requestId;
    res.setHeader('cache-control', 'no-store');

    if (exception instanceof AppError) {
      if (exception.retryAfterSec) res.setHeader('retry-after', String(exception.retryAfterSec));
      res.status(exception.status).json({ error: { code: exception.code, message: exception.message, details: exception.details, requestId } });
      return;
    }
    if (exception instanceof InvalidTransitionError) {
      res.status(HttpStatus.CONFLICT).json({ error: { code: 'INVALID_TRANSITION', message: 'এই অবস্থায় এই পরিবর্তন করা যাবে না', details: { from: exception.from, to: exception.to }, requestId } });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHENTICATED' : 'VALIDATION_FAILED';
      res.status(status).json({ error: { code, message: exception.message, requestId } });
      return;
    }
    this.logger.error({ requestId, err: exception instanceof Error ? exception.stack : String(exception) });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId } });
  }
}

/** Validates input with a zod schema; unknown keys are rejected (strict objects). */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Invalid request',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}
