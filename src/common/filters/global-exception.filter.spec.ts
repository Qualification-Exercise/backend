import {
  HttpException,
  HttpStatus,
  ArgumentsHost,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { GlobalExceptionFilter } from './global-exception.filter';

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | string[] | object;
  error?: string;
  stack?: string;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockArgumentsHost: jest.Mocked<ArgumentsHost>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockLogger: jest.SpyInstance;
  let mockConfigGet: jest.Mock;
  let mockResponseStatus: jest.Mock;
  let mockResponseJson: jest.Mock;

  beforeEach(() => {
    mockConfigGet = jest.fn();
    mockConfigService = {
      get: mockConfigGet,
    } as unknown as jest.Mocked<ConfigService>;

    mockRequest = {
      url: '/test/path',
      method: 'GET',
    };

    mockResponseStatus = jest.fn().mockReturnThis();
    mockResponseJson = jest.fn().mockReturnThis();
    mockResponse = {
      status: mockResponseStatus,
      json: mockResponseJson,
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as jest.Mocked<ArgumentsHost>;

    filter = new GlobalExceptionFilter(mockConfigService);

    // Mock Logger methods
    mockLogger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('HttpException handling', () => {
    it('should handle HttpException with string message', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException(
        'Test error message',
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Test error message',
          path: '/test/path',
        }),
      );
    });

    it('should handle HttpException with object response', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException(
        { message: 'Validation failed', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Validation failed',
          error: 'Bad Request',
        }),
      );
    });

    it('should handle HttpException with array message', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException(
        { message: ['Error 1', 'Error 2'], error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: ['Error 1', 'Error 2'],
        }),
      );
    });

    it('should handle HttpException with 404 status', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockLogger).not.toHaveBeenCalled(); // Should use warn, not error
    });

    it('should log client errors (4xx) as warnings', () => {
      mockConfigGet.mockReturnValue('development');
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const exception = new HttpException(
        'Bad Request',
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(warnSpy).toHaveBeenCalledWith(
        'Client Error',
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          path: '/test/path',
        }) as ErrorResponse,
      );
    });
  });

  describe('Error handling', () => {
    it('should handle generic Error in development mode', () => {
      mockConfigGet.mockReturnValue('development');
      const error = new Error('Test error');
      error.stack = 'Error stack trace';

      filter.catch(error, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Test error',
          error: 'Internal Server Error',
          stack: 'Error stack trace',
        }),
      );
    });

    it('should handle generic Error in production mode', () => {
      mockConfigGet.mockReturnValue('production');
      const error = new Error('Test error');
      error.stack = 'Error stack trace';

      filter.catch(error, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          error: 'Internal Server Error',
        }),
      );

      const callArgs =
        (mockResponseJson.mock.calls[0]?.[0] as ErrorResponse) ||
        ({} as ErrorResponse);
      expect(callArgs.stack).toBeUndefined();
    });

    it('should log server errors (5xx) as errors', () => {
      mockConfigGet.mockReturnValue('development');
      const error = new Error('Server error');

      filter.catch(error, mockArgumentsHost);

      expect(mockLogger).toHaveBeenCalledWith(
        'Internal Server Error',
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          path: '/test/path',
        }) as ErrorResponse,
      );
    });

    it('should include stack trace in development mode for Error', () => {
      mockConfigGet.mockReturnValue('development');
      const error = new Error('Test error');
      error.stack = 'Stack trace here';

      filter.catch(error, mockArgumentsHost);

      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: 'Stack trace here',
        }),
      );
    });

    it('should not include stack trace in production mode', () => {
      mockConfigGet.mockReturnValue('production');
      const error = new Error('Test error');
      error.stack = 'Stack trace here';

      filter.catch(error, mockArgumentsHost);

      const callArgs =
        (mockResponseJson.mock.calls[0]?.[0] as ErrorResponse) ||
        ({} as ErrorResponse);
      expect(callArgs.stack).toBeUndefined();
    });
  });

  describe('Unknown error handling', () => {
    it('should handle unknown error type in development mode', () => {
      mockConfigGet.mockReturnValue('development');
      const unknownError = { someProperty: 'value' };

      filter.catch(unknownError, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Unknown error occurred',
          error: 'Internal Server Error',
        }),
      );
    });

    it('should handle unknown error type in production mode', () => {
      mockConfigGet.mockReturnValue('production');
      const unknownError = { someProperty: 'value' };

      filter.catch(unknownError, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
        }),
      );
    });

    it('should handle null error', () => {
      mockConfigGet.mockReturnValue('development');

      filter.catch(null, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it('should handle undefined error', () => {
      mockConfigGet.mockReturnValue('development');

      filter.catch(undefined, mockArgumentsHost);

      expect(mockResponseStatus).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });
  });

  describe('Request information', () => {
    it('should include request URL in error response', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException('Error', HttpStatus.BAD_REQUEST);
      mockRequest.url = '/api/users/123';

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/users/123',
        }),
      );
    });

    it('should include request method in error response', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException('Error', HttpStatus.BAD_REQUEST);
      mockRequest.method = 'POST';

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/test/path',
        }),
      );
    });

    it('should include timestamp in error response', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException('Error', HttpStatus.BAD_REQUEST);
      const beforeTime = new Date().toISOString();

      filter.catch(exception, mockArgumentsHost);

      const afterTime = new Date().toISOString();
      const callArgs =
        (mockResponseJson.mock.calls[0]?.[0] as ErrorResponse) ||
        ({} as ErrorResponse);

      expect(callArgs.timestamp).toBeDefined();
      expect(callArgs.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(callArgs.timestamp >= beforeTime).toBe(true);
      expect(callArgs.timestamp <= afterTime).toBe(true);
    });
  });

  describe('Environment configuration', () => {
    it('should use development mode when NODE_ENV is development', () => {
      mockConfigGet.mockReturnValue('development');
      const error = new Error('Test error');
      error.stack = 'Stack trace';

      filter.catch(error, mockArgumentsHost);

      expect(mockConfigGet).toHaveBeenCalledWith('NODE_ENV', 'development');
      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: 'Stack trace',
        }),
      );
    });

    it('should use production mode when NODE_ENV is production', () => {
      mockConfigGet.mockReturnValue('production');
      const error = new Error('Test error');
      error.stack = 'Stack trace';

      filter.catch(error, mockArgumentsHost);

      expect(mockResponseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
        }),
      );

      const callArgs =
        (mockResponseJson.mock.calls[0]?.[0] as ErrorResponse) ||
        ({} as ErrorResponse);
      expect(callArgs.stack).toBeUndefined();
    });

    it('should default to development mode when NODE_ENV is not set', () => {
      mockConfigGet.mockReturnValue('development');
      const error = new Error('Test error');
      error.stack = 'Stack trace';

      filter.catch(error, mockArgumentsHost);

      expect(mockConfigGet).toHaveBeenCalledWith('NODE_ENV', 'development');
    });
  });

  describe('Error logging', () => {
    it('should log error details for 5xx errors', () => {
      mockConfigGet.mockReturnValue('development');
      const error = new Error('Server error');
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      filter.catch(error, mockArgumentsHost);

      expect(errorSpy).toHaveBeenCalledWith(
        'Internal Server Error',
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          path: '/test/path',
          method: 'GET',
        }),
      );
    });

    it('should log warning for 4xx errors', () => {
      mockConfigGet.mockReturnValue('development');
      const exception = new HttpException(
        'Client error',
        HttpStatus.BAD_REQUEST,
      );
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      filter.catch(exception, mockArgumentsHost);

      expect(warnSpy).toHaveBeenCalledWith(
        'Client Error',
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
        }),
      );
    });

    it('should include error message in log for Error instances', () => {
      mockConfigGet.mockReturnValue('development');
      const error = new Error('Specific error message');
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      filter.catch(error, mockArgumentsHost);

      expect(errorSpy).toHaveBeenCalledWith(
        'Internal Server Error',
        expect.objectContaining({
          message: 'Specific error message',
        }),
      );
    });
  });
});
