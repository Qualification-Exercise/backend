import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { IGlobalExceptionFilterResponse } from './interfaces/global-exception-filter.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger: Logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const exposeInternals =
      this.configService.get<boolean>('EXPOSE_ERROR_STACK') === true;

    let status: number;
    let message: string | object;
    let error: string | undefined;
    let additionalData: Record<string, string | number | undefined> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as {
          message?: string | string[];
          error?: string;
        };
        message = responseObj?.message || exception.message;
        error = responseObj?.error;
      } else {
        message = exception?.message;
      }

      additionalData = exception.cause as Record<
        string,
        string | number | undefined
      >;
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exposeInternals ? exception.message : 'Internal server error';
      error = 'Internal Server Error';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exposeInternals
        ? 'Unknown error occurred'
        : 'Internal server error';
      error = 'Internal Server Error';
    }

    // Log error details
    const errorLog = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      error,
      ...(exception instanceof Error ? { stack: exception.stack } : {}),
      additional_data: additionalData,
    };

    if (status >= 500) {
      this.logger.error('Internal Server Error', errorLog);
    } else {
      this.logger.warn('Client Error', errorLog);
    }

    // Build response
    const errorResponse: IGlobalExceptionFilterResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      additional_data: additionalData,
    };

    if (error) {
      errorResponse.error = error;
    }

    if (exposeInternals && exception instanceof Error && exception.stack) {
      errorResponse.stack = exception.stack;
    }

    response.status(status).json(errorResponse);
  }
}
