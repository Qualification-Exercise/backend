/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpStatus, Type } from '@nestjs/common';

export interface IApiErrorResponse {
  status: HttpStatus;
  description: string;
}

export interface IApiEndpointDecoratorOptions {
  summary: string;
  description?: string;
  statusCode?: HttpStatus;
  responseType?: Type<any>;
  responseSchemas?: Type<any>[];
  errorResponses?: IApiErrorResponse[];
  includeDefaultErrors?: boolean;
  includeAuth?: boolean;
}
