import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AiAuditOptionsDto } from './ai-audit-options.dto';

export class AiRuleExplainQueryDto extends AiAuditOptionsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxOccurrences?: number;
}
