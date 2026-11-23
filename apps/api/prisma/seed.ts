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
  throw new Error('DATABASE_URL must be configured before seeding.');
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

const departments = [
  ['finance-accounting-credit-control', 'Finance, Accounting & Credit Control'],
  [
    'marketing-e-commerce-business-development',
    'Marketing, E-Commerce & Business Development',
  ],
  ['sales-commercial-operations', 'Sales & Commercial Operations'],
  ['sourcing-procurement', 'Sourcing & Procurement'],
  ['operations', 'Operations'],
  ['production', 'Production'],
  ['delivery-logistics', 'Delivery & Logistics'],
  ['customer-experience-support', 'Customer Experience & Support (CES)'],
  ['human-resources', 'Human Resources'],
  ['quality-management', 'Quality Management'],
  ['research-development', 'Research & Development'],
  ['legal-public-relations', 'Legal & Public Relations'],
  [
    'inventory-fulfillment-warehouse-management',
    'Inventory, Fulfillment & Warehouse Management',
  ],
  ['security-loss-prevention', 'Security & Loss Prevention'],
  [
    'information-technology-digital-systems',
    'Information Technology (IT) & Digital Systems',
  ],
  ['executive-management', 'Executive Management'],
  [
    'administration-facilities-management',
    'Administration & Facilities Management',
  ],
  ['product-management-merchandising', 'Product Management & Merchandising'],
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

  for (const [department, name] of departments) {
    const slug = `cetech-${department}`;
    const tag = {
      name: `${name} - CETECH`,
      kind: 'DEPARTMENT',
      isSystem: true,
    } as const;
    await prisma.tag.upsert({
      where: { slug },
      update: tag,
      create: { slug, ...tag },
    });
  }

  console.log(
    `Seeded ${categories.length} default categories and ${departments.length} CETECH department tags.`,
  );
}

try {
  await main();
} catch (error) {
  console.error('Category and department tag seeding failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
