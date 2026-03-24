import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AiAuditOptionsDto {
  @IsOptional()
  @IsBoolean()
  forceHeuristic?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxRecommendations?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxRules?: number;
}
