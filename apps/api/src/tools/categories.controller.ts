
import {
  Controller,
  Get,
} from '@nestjs/common';

import { PrismaService } from '../prisma/index.js';

const CATEGORY_ORDER = [
  'AI',
  'Development',
  'Design',
  'Productivity',
  'E-commerce',
  'Business',
  'Communication',
  'Other',
] as const;

@Controller('api/v1/categories')
export class CategoriesController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findAll() {
    const categories =
      await this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });

    return categories.sort((first, second) => {
      const firstPosition =
        CATEGORY_ORDER.indexOf(
          first.name as (typeof CATEGORY_ORDER)[number],
        );

      const secondPosition =
        CATEGORY_ORDER.indexOf(
          second.name as (typeof CATEGORY_ORDER)[number],
        );

      const firstRank =
        firstPosition === -1
          ? CATEGORY_ORDER.length
          : firstPosition;

      const secondRank =
        secondPosition === -1
          ? CATEGORY_ORDER.length
          : secondPosition;

      return (
        firstRank - secondRank ||
        first.name.localeCompare(second.name)
      );
    });
  }
}
