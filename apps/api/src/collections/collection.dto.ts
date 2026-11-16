import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CollectionDto {
  // Creation requires a name; PATCH validates it only when supplied.
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined, {
    groups: ['update'],
  })
  @Transform(trim)
  @IsString({ always: true })
  @IsNotEmpty({ always: true })
  @MaxLength(120, { always: true })
  name!: string;

  @Transform(trim)
  @IsOptional({ always: true })
  @IsString({ always: true })
  @MaxLength(1500, { always: true })
  description?: string | null;
}
