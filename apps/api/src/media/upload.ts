import {
  BadRequestException,
  PayloadTooLargeException,
  RequestTimeoutException,
} from '@nestjs/common';
import busboy from 'busboy';
import type { Request } from 'express';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { MAX_FILE_BYTES, MAX_REQUEST_BYTES } from './inspect.js';
import type { MediaStorage } from './storage.js';
export async function receiveUpload(
  req: Request,
  key: string,
  storage: MediaStorage,
) {
  if (!/^multipart\/form-data\s*;/i.test(req.headers['content-type'] ?? ''))
    throw new BadRequestException('Use multipart/form-data with one file');
  if (Number(req.headers['content-length'] ?? 0) > MAX_REQUEST_BYTES)
    throw new PayloadTooLargeException('Maximum file size is 20 MiB');
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: req.headers,
      preservePath: true,
      defParamCharset: 'utf8',
      limits: {
        files: 1,
        fields: 0,
        parts: 2,
        fileSize: MAX_FILE_BYTES + 1,
        headerPairs: 100,
      },
    });
  } catch {
    throw new BadRequestException('Invalid multipart upload');
  }
  let fileStream: Readable | undefined;
  let writing: Promise<void> = Promise.resolve();
  let filename = '';
  let bytes = 0;
  let total = 0;
  let failure: Error | undefined;
  const envelope = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      callback(
        total > MAX_REQUEST_BYTES
          ? new PayloadTooLargeException('Maximum file size is 20 MiB')
          : null,
        chunk,
      );
    },
  });
  const done = new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      req.unpipe(envelope);
      envelope.unpipe(parser);
      // Busboy emits limits while updating its parser state. Destroy after that callback.
      queueMicrotask(() => {
        fileStream?.destroy(error);
        parser.destroy();
      });
      reject(error);
    };
    envelope.on('error', fail);
    parser.on('error', () =>
      fail(new BadRequestException('Incomplete or malformed multipart upload')),
    );
    parser.on('filesLimit', () =>
      fail(new BadRequestException('Upload exactly one file')),
    );
    parser.on('fieldsLimit', () =>
      fail(new BadRequestException('Upload fields are not accepted')),
    );
    parser.on('partsLimit', () =>
      fail(new BadRequestException('Upload exactly one file')),
    );
    parser.on('file', (name, file, info) => {
      fileStream = file;
      file.on('error', () => {});
      if (name !== 'file' || !info.filename) {
        file.resume();
        fail(new BadRequestException('Upload one named file part'));
        return;
      }
      filename = info.filename
        .replace(/\\/g, '/')
        .split('/')
        .pop()!
        // Strip control characters from display-only metadata.
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim();
      if (
        !filename ||
        filename.length > 255 ||
        filename === '.' ||
        filename === '..'
      ) {
        file.resume();
        fail(new BadRequestException('Invalid filename'));
        return;
      }
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(null, chunk);
        },
      });
      counter.on('error', fail);
      file.on('error', (error) => counter.destroy(error));
      file.on('limit', () =>
        fail(new PayloadTooLargeException('Maximum file size is 20 MiB')),
      );
      writing = storage.stage(key, file.pipe(counter)).catch((error: Error) => {
        fail(error);
      });
    });
    parser.on('close', () => {
      if (!failure) resolve();
    });
    const abort = () => fail(new BadRequestException('Upload interrupted'));
    req.once('aborted', abort);
    req.once('error', abort);
    const timer = setTimeout(
      () => fail(new RequestTimeoutException('Upload timed out')),
      120000,
    );
    timer.unref();
    parser.once('close', () => {
      clearTimeout(timer);
      req.off('aborted', abort);
      req.off('error', abort);
    });
    req.pipe(envelope).pipe(parser);
  });
  try {
    await done;
    await writing;
    if (failure) throw failure;
    if (!filename || bytes === 0)
      throw new BadRequestException('Select a non-empty file');
    if (bytes > MAX_FILE_BYTES)
      throw new PayloadTooLargeException('Maximum file size is 20 MiB');
    return { originalFilename: filename, sizeBytes: bytes };
  } finally {
    await writing;
    req.unpipe(envelope);
    envelope.destroy();
    parser.destroy();
  }
}
