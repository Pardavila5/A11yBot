import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListAiTracesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(['audit_summary', 'compare_summary', 'rule_explain'])
  operation?: 'audit_summary' | 'compare_summary' | 'rule_explain';

  @IsOptional()
  @IsIn(['openai', 'heuristic'])
  source?: 'openai' | 'heuristic';

  @IsOptional()
  @IsInt()
  @Min(1)
  auditId?: number;
}
