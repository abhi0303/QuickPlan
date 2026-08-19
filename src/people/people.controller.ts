import { Controller, Get, Post, Body, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { PeopleService } from './people.service';
import { CreatePersonDto } from './dto/create-person.dto';

@ApiTags('People & Contacts')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  @ApiOperation({ summary: 'Create contact / person' })
  create(@Headers() headers: Record<string, string>, @Body() dto: CreatePersonDto) {
    return this.peopleService.create(this.getUserId(headers), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List contacts with aggregate net balances' })
  findAll(@Headers() headers: Record<string, string>) {
    return this.peopleService.findAllWithBalances(this.getUserId(headers));
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get transaction history with contact' })
  getHistory(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.peopleService.getHistory(this.getUserId(headers), id);
  }
}
