import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class CompareAuditDto {
  @Type(() => Number)
  @IsInt({ message: 'old debe ser un entero' })
  old: number;

  @Type(() => Number)
  @IsInt({ message: 'new debe ser un entero' })
  new: number;
}
