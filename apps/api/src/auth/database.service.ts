import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createDatabase } from '@synvaro/database';
import { AUTH_CONFIG } from './auth.config.js';
import type { AuthConfig } from './auth.config.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client;
  constructor(@Inject(AUTH_CONFIG) config: AuthConfig) {
    this.client = createDatabase(config.databaseUrl);
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
