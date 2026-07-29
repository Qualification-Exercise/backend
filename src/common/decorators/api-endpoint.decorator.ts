import {
  applyDecorators,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { isEmpty } from 'lodash';
import {
  IApiEndpointDecoratorOptions,
  IApiErrorResponse,
} from './interfaces/api-endpoint-decorator.interface';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';

const DEFAULT_ERROR_RESPONSES: IApiErrorResponse[] = [
  {
    status: HttpStatus.BAD_REQUEST,
    description: 'Bad request - invalid input',
  },
  {
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - authentication required or invalid',
  },
  {
    status: HttpStatus.FORBIDDEN,
    description: 'Forbidden - insufficient permissions',
  },
  {
    status: HttpStatus.NOT_FOUND,
    description: 'Not found - resource does not exist',
  },
  {
    status: HttpStatus.CONFLICT,
    description: 'Conflict - resource already exists or state conflict',
  },
  {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'Unprocessable entity - validation failed',
  },
  {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
  },
];

export const ApiEndpoint = (options: IApiEndpointDecoratorOptions) => {
  const {
    summary,
    description,
    statusCode = HttpStatus.OK,
    responseType,
    responseSchemas,
    errorResponses,
    includeDefaultErrors = true,
    includeAuth = true,
  } = options;

  const decorators: MethodDecorator[] = [
    ApiOperation({
      summary,
      description,
    }),
    HttpCode(statusCode),
  ];

  // Add success response
  if (responseType) {
    decorators.push(
      ApiResponse({
        status: statusCode,
        type: responseType,
      }),
    );
  } else if (responseSchemas && !isEmpty(responseSchemas)) {
    decorators.push(
      ...responseSchemas.map(
        (schema) => ApiExtraModels(schema) as MethodDecorator,
      ),
      ApiResponse({
        status: statusCode,
        schema: {
          oneOf: responseSchemas.map((s) => ({ $ref: getSchemaPath(s) })),
        },
      }),
    );
  }

  // Add error responses
  const errorsToAdd =
    errorResponses || (includeDefaultErrors ? DEFAULT_ERROR_RESPONSES : []);

  errorsToAdd.forEach((error) => {
    decorators.push(
      ApiResponse({
        status: error.status,
        description: error.description,
      }),
    );
  });

  if (includeAuth) {
    decorators.push(ApiBearerAuth('jwt'));
    decorators.push(UseGuards(JwtAuthGuard));
  }

  return applyDecorators(...decorators);
};
