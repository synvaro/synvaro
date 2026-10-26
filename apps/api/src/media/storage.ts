import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { constants, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export interface MediaStorage {
  stage(key: string, source: Readable): Promise<void>;
  publish(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  read(key: string, start?: number, end?: number): Promise<Readable>;
}
@Injectable()
export class LocalMediaStorage implements MediaStorage {
  private ready?: Promise<string>;
  private root() {
    if (!this.ready)
      this.ready = this.initialize().catch(() => {
        this.ready = undefined;
        throw new ServiceUnavailableException(
          'Private media storage is not configured or unavailable',
        );
      });
    return this.ready;
  }
  private async initialize() {
    const configured = process.env.MEDIA_STORAGE_ROOT;
    if (!configured || !isAbsolute(configured))
      throw new Error('Explicit absolute storage root required');
    const repository = fileURLToPath(new URL('../../../../', import.meta.url));
    const candidate = resolve(configured);
    if (
      candidate === resolve(repository) ||
      candidate.startsWith(resolve(repository) + sep)
    )
      throw new Error('Storage must be outside repository');
    await mkdir(candidate, { recursive: true, mode: 0o700 });
    const root = await realpath(candidate);
    if (
      (await lstat(candidate)).isSymbolicLink() ||
      root === resolve(repository) ||
      root.startsWith(resolve(repository) + sep)
    )
      throw new Error('No symlink storage root');
    if (((await stat(root)).mode & 0o077) !== 0)
      throw new Error('Storage must be owner-only');
    return root;
  }
  async path(key: string, staged = false) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new Error('Invalid internal object key');
    return resolve(await this.root(), key + (staged ? '.part' : ''));
  }
  async stage(key: string, source: Readable) {
    await pipeline(
      source,
      createWriteStream(await this.path(key, true), {
        flags: 'wx',
        mode: 0o600,
      }),
    );
  }
  async publish(key: string) {
    const path = await this.path(key, true);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(path, await this.path(key));
  }
  async remove(key: string) {
    await Promise.all([
      rm(await this.path(key, true), { force: true }),
      rm(await this.path(key), { force: true }),
    ]);
  }
  async read(key: string, start?: number, end?: number) {
    const handle = await open(
      await this.path(key),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    return handle.createReadStream({ start, end, autoClose: true });
  }
}
