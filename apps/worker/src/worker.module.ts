import { Module } from '@nestjs/common';

// Same modular monolith, separate process. No queue implementation selected.
@Module({})
export class WorkerModule {}
