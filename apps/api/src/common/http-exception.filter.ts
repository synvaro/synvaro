import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorResponse } from '@synvaro/contracts';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;
    // Never expose exception payloads, stack traces, request bodies or credentials.
    const message =
      statusCode >= 500
        ? 'Internal server error'
        : exception instanceof HttpException
          ? exception.message
          : 'Request failed';
    if (statusCode >= 500) {
      this.logger.error('Unhandled request failure');
    }
    const body: ApiErrorResponse = { statusCode, message };
    host.switchToHttp().getResponse<Response>().status(statusCode).json(body);
  }
}
