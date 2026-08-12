import { HttpException, HttpStatus } from '@nestjs/common';

import { apiError } from '@/common/api-error';
import { errorMessage } from '@/common/errors';

describe('errorMessage', () => {
  it('unwraps the apiError payload an HttpException hides behind "Http Exception"', () => {
    const err = new HttpException(
      apiError('INDEXER_REQUEST_FAILED', 'Indexer request failed', {
        status: 404,
      }),
      HttpStatus.BAD_REQUEST,
    );

    expect(String(err)).toContain('Http Exception');
    expect(errorMessage(err)).toContain('INDEXER_REQUEST_FAILED');
    expect(errorMessage(err)).toContain('404');
  });

  it('falls back to the stack for plain errors and String() for the rest', () => {
    expect(errorMessage(new Error('boom'))).toContain('boom');
    expect(errorMessage('boom')).toBe('boom');
  });
});
