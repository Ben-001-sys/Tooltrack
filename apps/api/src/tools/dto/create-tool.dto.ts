
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const TOOL_ACCESS_TYPES = [
  'FREE',
  'SUBSCRIPTION',
  'LICENSED',
] as const;

export type ToolAccessType =
  (typeof TOOL_ACCESS_TYPES)[number];

export class CreateToolDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  websiteUrl?: string;

  @IsIn(TOOL_ACCESS_TYPES)
  accessType!: ToolAccessType;

  @IsUUID('4')
  categoryId!: string;
}
