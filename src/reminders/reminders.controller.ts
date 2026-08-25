import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { RemindersService } from './reminders.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { Public } from '../auth/public.decorator';

@ApiTags('Reminders')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  private getUserId(headers: Record<string, string>): string {
    const userId = headers['x-user-id'];

    if (!userId) {
      throw new UnauthorizedException('Authenticated user could not be resolved.');
    }

    return userId;
  }

  @Post()
  @ApiOperation({ summary: 'Create reminder with offset minutes' })
  create(@Headers() headers: Record<string, string>, @Body() dto: CreateReminderDto) {
    return this.remindersService.create(this.getUserId(headers), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all user reminders' })
  findAll(@Headers() headers: Record<string, string>) {
    return this.remindersService.findAll(this.getUserId(headers));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a reminder in place, keeping its id' })
  update(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.remindersService.update(this.getUserId(headers), id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete reminder by ID' })
  remove(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.remindersService.remove(this.getUserId(headers), id);
  }

  @Post(':id/calendar-link')
  @ApiOperation({
    summary: 'Mint a short-lived link the browser can navigate to for an .ics file',
  })
  createCalendarLink(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    // Honour the proxy headers Render sets, so the link points at the public
    // host rather than the container's own.
    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0] ?? request.protocol;
    const host = (request.headers['x-forwarded-host'] as string) ?? request.get('host');

    return this.remindersService.createCalendarLink(
      this.getUserId(headers),
      id,
      `${proto}://${host}`,
    );
  }

  /**
   * Public by design: this is a browser navigation, so no Authorization header
   * can be attached and the signed token in the query string is the
   * authorisation.
   */
  @Public()
  @Get(':id/calendar.ics')
  @ApiOperation({ summary: 'The iCalendar file for a reminder, authorised by token' })
  async getCalendarFile(
    @Param('id') id: string,
    @Query('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { filename, body } = await this.remindersService.getCalendarFile(id, token);

    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Cache-Control', 'no-store');

    return body;
  }
}
