import { IsUrl } from 'class-validator';

export class CreateAuditDto {
  @IsUrl({}, { message: 'La URL proporcionada no es válida' })
  url: string;
}
