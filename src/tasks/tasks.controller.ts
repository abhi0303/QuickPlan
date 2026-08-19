import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Headers,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('api/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  create(@Headers() headers: Record<string, string>, @Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(this.getUserId(headers), createTaskDto);
  }

  @Get()
  findAll(
    @Headers() headers: Record<string, string>,
    @Query('view') view?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
  ) {
    return this.tasksService.findAll(this.getUserId(headers), { view, category, priority });
  }

  @Get(':id')
  findOne(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.tasksService.findOne(this.getUserId(headers), id);
  }

  @Patch(':id')
  update(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ) {
    return this.tasksService.update(this.getUserId(headers), id, updateTaskDto);
  }

  @Delete(':id')
  remove(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.tasksService.remove(this.getUserId(headers), id);
  }
}
