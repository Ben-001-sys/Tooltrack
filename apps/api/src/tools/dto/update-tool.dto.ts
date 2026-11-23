import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TOOL_ACCESS_TYPES, type ToolAccessType } from './create-tool.dto.js';
import { ToolTagsDto } from './tool-tags.dto.js';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;
const supplied = (_object: unknown, value: unknown): boolean =>
  value !== undefined;

export class UpdateToolDto extends ToolTagsDto {
  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1500)
  description?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  websiteUrl?: string | null;

  @ValidateIf(supplied)
  @Transform(trim)
  @IsIn(TOOL_ACCESS_TYPES)
  accessType?: ToolAccessType;

  @ValidateIf(supplied)
  @Transform(trim)
  @IsUUID('4')
  categoryId?: string;
}
