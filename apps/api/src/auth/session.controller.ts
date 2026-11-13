import { Controller, Get } from '@nestjs/common';

import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

@Controller('api/v1/session')
export class SessionController {
  @Get()
  getCurrentSession(
    @Session() session: UserSession,
  ) {
    return {
      authenticated: true,

      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
    };
  }
}
