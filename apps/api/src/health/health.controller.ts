import { Controller, Get } from '@nestjs/common';

import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@AllowAnonymous()
@Controller('api/v1/health')
export class HealthController {
  @Get()
  checkHealth(): {
    status: string;
    service: string;
  } {
    return {
      status: 'ok',
      service: 'tooltrack-api',
    };
  }
}
