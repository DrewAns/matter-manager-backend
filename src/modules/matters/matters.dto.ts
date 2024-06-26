import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateMatterDto {
  @IsString()
  @IsUUID()
  clientId: string;

  @IsString()
  @IsUUID()
  statusId: string;

  @IsString()
  project: string;

  @IsString()
  @Matches(/\d{6}-\w{1,3}$/, {
    message: 'File number must be in XXXXXX-XXX format',
  })
  fileNumber: string;

  @IsDateString()
  @IsOptional()
  closedAt: string = null;
}

export class UpdateMatterDto {
  @IsString()
  @IsUUID()
  matterId: string;

  @IsString()
  @IsUUID()
  statusId: string;

  @IsString()
  project: string;

  @IsString()
  @Matches(/\d{6}-\w{1,3}$/, {
    message: 'File number must be in XXXXXX-XXX format',
  })
  fileNumber: string;

  @IsDateString()
  @IsOptional()
  closedAt: string = null;
}

export class DeleteMatterDto {
  @IsString()
  @IsUUID()
  matterId: string;
}

export class CreateAssignmentDto {
  @IsString()
  @IsUUID()
  userId: string;

  @IsString()
  @IsOptional()
  assignedBy?: string = null;
}
