import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AiTraceStatsDto {
  @IsOptional()
  @IsIn(['audit_summary', 'compare_summary', 'rule_explain'])
  operation?: 'audit_summary' | 'compare_summary' | 'rule_explain';

  @IsOptional()
  @IsIn(['openai', 'heuristic'])
  source?: 'openai' | 'heuristic';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  sinceDays?: number;
}
