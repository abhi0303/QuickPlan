import { Controller, Get, Post, Body, Param, Headers } from '@nestjs/common';
import { PeopleService } from './people.service';
import { CreatePersonDto } from './dto/create-person.dto';

@Controller('api/people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  create(@Headers() headers: Record<string, string>, @Body() dto: CreatePersonDto) {
    return this.peopleService.create(this.getUserId(headers), dto);
  }

  @Get()
  findAll(@Headers() headers: Record<string, string>) {
    return this.peopleService.findAllWithBalances(this.getUserId(headers));
  }

  @Get(':id/history')
  getHistory(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.peopleService.getHistory(this.getUserId(headers), id);
  }
}
