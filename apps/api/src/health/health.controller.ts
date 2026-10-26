import { Public } from '../auth/auth.guard.js';
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@synvaro/contracts';

class HealthDto implements HealthResponse {
  @ApiProperty({ type: String, enum: ['ok'] })
  status = 'ok' as const;

  @ApiProperty({ type: String, enum: ['synvaro-api'] })
  service = 'synvaro-api' as const;
}

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({
    type: HealthDto,
    description: 'Process liveness; does not check external dependencies.',
  })
  getHealth(): HealthResponse {
    return { status: 'ok', service: 'synvaro-api' };
  }
}
