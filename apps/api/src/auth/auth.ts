
import { config } from 'dotenv';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const environmentPaths = [
  resolve(process.cwd(), '../../.env'),
  resolve(process.cwd(), '.env'),
];

for (const environmentPath of environmentPaths) {
  config({
    path: environmentPath,
    quiet: true,
  });
}

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const authUrl = process.env.BETTER_AUTH_URL;
const webOrigin = process.env.WEB_ORIGIN;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

if (!authSecret || authSecret.length < 32) {
  throw new Error(
    'BETTER_AUTH_SECRET must contain at least 32 characters',
  );
}

if (!authUrl) {
  throw new Error('BETTER_AUTH_URL is required');
}

if (!webOrigin) {
  throw new Error('WEB_ORIGIN is required');
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
  max: 5,
});

const authPrisma = new PrismaClient({
  adapter,
});

export const auth = betterAuth({
  database: prismaAdapter(authPrisma, {
    provider: 'postgresql',
  }),

  baseURL: authUrl,

  basePath: '/api/auth',

  secret: authSecret,

  trustedOrigins: [webOrigin],

  // Keep security behavior explicit, including subprocesses started by test runners.
  advanced: {
    disableOriginCheck: false,
    disableCSRFCheck: false,
  },

  emailAndPassword: {
    enabled: true,
  },
});
