import { IsInt, Min } from 'class-validator';
import { AiAuditOptionsDto } from './ai-audit-options.dto';

export class AiCompareQueryDto extends AiAuditOptionsDto {
  @IsInt()
  @Min(1)
  old!: number;

  @IsInt()
  @Min(1)
  new!: number;
}
