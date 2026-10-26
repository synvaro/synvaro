import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from '../common/http-exception.filter.js';

test('SYN-001-A3: unexpected failures never expose internal exception details', () => {
  let status: number | undefined;
  let body: unknown;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      body = value;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as ArgumentsHost;
  new HttpExceptionFilter().catch(
    new Error('private connection details'),
    host,
  );
  assert.equal(status, 500);
  assert.deepEqual(body, { statusCode: 500, message: 'Internal server error' });
});
