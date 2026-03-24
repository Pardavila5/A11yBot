import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAuditDto {
  @IsOptional()
  @IsIn(['running', 'completed', 'failed'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
