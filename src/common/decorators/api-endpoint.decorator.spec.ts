import { Controller, Get, HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger';

import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { ApiEndpoint } from '@/common/decorators/api-endpoint.decorator';

class ResponseDto {
  id: string;
}
class OtherDto {
  other: string;
}

function metadataOf(
  options: Parameters<typeof ApiEndpoint>[0],
): (key: string) => unknown {
  @Controller('probe')
  class ProbeController {
    @Get()
    @ApiEndpoint(options)
    handler() {
      return null;
    }
  }

  const handler = ProbeController.prototype.handler;
  return (key: string) => Reflect.getMetadata(key, handler);
}

describe('ApiEndpoint', () => {
  it('documents the operation and defaults the status to 200', () => {
    const meta = metadataOf({ summary: 'Do a thing', description: 'Details' });

    expect(meta(DECORATORS.API_OPERATION)).toMatchObject({
      summary: 'Do a thing',
      description: 'Details',
    });
    expect(meta(HTTP_CODE_METADATA)).toBe(HttpStatus.OK);
  });

  it('honours an explicit status code for both the code and the response', () => {
    const meta = metadataOf({
      summary: 'Create',
      statusCode: HttpStatus.CREATED,
      responseType: ResponseDto,
    });

    expect(meta(HTTP_CODE_METADATA)).toBe(HttpStatus.CREATED);
    const responses = meta(DECORATORS.API_RESPONSE) as Record<string, unknown>;
    expect(responses).toHaveProperty(String(HttpStatus.CREATED));
  });

  it('adds the seven default error responses', () => {
    const meta = metadataOf({ summary: 'Do a thing' });
    const responses = meta(DECORATORS.API_RESPONSE) as Record<string, unknown>;

    expect(Object.keys(responses).sort()).toEqual(
      ['400', '401', '403', '404', '409', '422', '500'].sort(),
    );
  });

  it('can be told to document no default errors', () => {
    const meta = metadataOf({
      summary: 'Do a thing',
      includeDefaultErrors: false,
    });

    expect(meta(DECORATORS.API_RESPONSE) ?? {}).toEqual({});
  });

  it('replaces the defaults with an explicit error list', () => {
    const meta = metadataOf({
      summary: 'Do a thing',
      errorResponses: [
        { status: HttpStatus.TOO_MANY_REQUESTS, description: 'Slow down' },
      ],
    });
    const responses = meta(DECORATORS.API_RESPONSE) as Record<string, unknown>;

    expect(Object.keys(responses)).toEqual(['429']);
  });

  it('documents a one-of response when several schemas are possible', () => {
    const meta = metadataOf({
      summary: 'Do a thing',
      responseSchemas: [ResponseDto, OtherDto],
    });

    const responses = meta(DECORATORS.API_RESPONSE) as Record<
      string,
      { schema?: { oneOf?: unknown[] } }
    >;
    expect(responses['200'].schema?.oneOf).toHaveLength(2);
  });

  it('ignores an empty schema list', () => {
    const meta = metadataOf({ summary: 'Do a thing', responseSchemas: [] });
    const responses = meta(DECORATORS.API_RESPONSE) as Record<string, unknown>;

    expect(responses['200']).toBeUndefined();
  });

  it('guards the route by default', () => {
    const meta = metadataOf({ summary: 'Do a thing' });

    expect(meta(GUARDS_METADATA)).toEqual([JwtAuthGuard]);
    expect(meta(DECORATORS.API_SECURITY)).toEqual([{ jwt: [] }]);
  });

  it('leaves a public route unguarded', () => {
    const meta = metadataOf({ summary: 'Log in', includeAuth: false });

    expect(meta(GUARDS_METADATA)).toBeUndefined();
  });
});
