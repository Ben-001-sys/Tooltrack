import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class ToolTagsDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: TransformFnParams): unknown =>
    Array.isArray(value)
      ? value.map((id: unknown) =>
          typeof id === 'string' ? id.toLowerCase() : id,
        )
      : value,
  )
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  tagIds?: string[];
}
