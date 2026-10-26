import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../auth/database.service.js';
import { LocalMediaStorage } from './storage.js';
import { receiveUpload } from './upload.js';
import { inspectMedia } from './inspect.js';
export const mediaSelect = {
  id: true,
  brandId: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  durationMs: true,
  origin: true,
  createdAt: true,
} as const;
@Injectable()
export class MediaService {
  private active = 0;
  constructor(
    private readonly db: DatabaseService,
    readonly storage: LocalMediaStorage,
  ) {}
  async brand(ownerUserId: string, id: string) {
    if (
      !(await this.db.client.brand.findFirst({
        where: { id, organization: { ownerUserId } },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Brand not found');
  }
  async upload(ownerUserId: string, brandId: string, req: Request) {
    await this.brand(ownerUserId, brandId);
    if (this.active >= 2)
      throw new ServiceUnavailableException(
        'Media uploads are busy; try again shortly',
      );
    this.active++;
    const storageKey = randomUUID();
    let committed = false;
    let initialized = false;
    try {
      // Resolve configuration before receiving any bytes.
      await this.storage.path(storageKey, true);
      initialized = true;
      const upload = await receiveUpload(req, storageKey, this.storage);
      const details = await inspectMedia(
        await this.storage.path(storageKey, true),
      );
      await this.storage.publish(storageKey);
      const asset = await this.db.client.mediaAsset.create({
        data: {
          ...upload,
          ...details,
          storageKey,
          brand: { connect: { id: brandId, organization: { ownerUserId } } },
        },
        select: mediaSelect,
      });
      committed = true;
      return asset;
    } finally {
      try {
        if (!committed && initialized) await this.storage.remove(storageKey);
      } finally {
        this.active--;
      }
    }
  }
  async list(ownerUserId: string, brandId: string) {
    await this.brand(ownerUserId, brandId);
    return this.db.client.mediaAsset.findMany({
      where: { brandId, brand: { organization: { ownerUserId } } },
      select: mediaSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
  async asset(ownerUserId: string, id: string) {
    const asset = await this.db.client.mediaAsset.findFirst({
      where: { id, brand: { organization: { ownerUserId } } },
    });
    if (!asset) throw new NotFoundException('Media not found');
    return asset;
  }
  async metadata(ownerUserId: string, id: string) {
    const { storageKey: _, ...asset } = await this.asset(ownerUserId, id);
    void _;
    return asset;
  }
}
