
import { resolve } from 'node:path';

import { config } from 'dotenv';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

config({
  path: resolve(import.meta.dirname, '../../../.env'),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL must be configured before seeding.',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
  }),
});

const categories = [
  {
    name: 'AI',
    slug: 'ai',
  },
  {
    name: 'Development',
    slug: 'development',
  },
  {
    name: 'Design',
    slug: 'design',
  },
  {
    name: 'Productivity',
    slug: 'productivity',
  },
  {
    name: 'E-commerce',
    slug: 'e-commerce',
  },
  {
    name: 'Business',
    slug: 'business',
  },
  {
    name: 'Communication',
    slug: 'communication',
  },
  {
    name: 'Other',
    slug: 'other',
  },
] as const;

async function main(): Promise<void> {
  for (const category of categories) {
    await prisma.category.upsert({
      where: {
        slug: category.slug,
      },
      update: {
        name: category.name,
      },
      create: {
        name: category.name,
        slug: category.slug,
      },
    });
  }

  const total = await prisma.category.count();

  console.log(
    `Category seeding completed. Total categories: ${total}`,
  );
}

try {
  await main();
} catch (error) {
  console.error('Category seeding failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
