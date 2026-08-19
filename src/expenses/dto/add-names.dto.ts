import { IsArray, IsString } from 'class-validator';

export class AddNamesDto {
  @IsArray()
  @IsString({ each: true })
  names: string[];
}
