import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';
import { QueueEntryStatus } from '../entities/queue-entry.entity';

export class UpdateRouteDto {
  @IsOptional() @IsString() @MaxLength(100)
  declare origin?: string;

  @IsOptional() @IsString() @MaxLength(100)
  declare destination?: string;

  @IsOptional() @IsString() @MaxLength(500)
  declare description?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  declare stages?: string[];

  @IsOptional() @IsBoolean()
  declare isActive?: boolean;

  @IsOptional()
  declare fare?: string
}

export class UpdateQueueDto {
  @IsOptional() @IsEnum(QueueEntryStatus)
  declare status?: QueueEntryStatus;

  @IsOptional() @IsUUID()
  declare routeId?: string;
}
