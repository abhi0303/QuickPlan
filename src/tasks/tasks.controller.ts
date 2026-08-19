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
import { ApiTags, ApiOperation, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@ApiTags('Tasks')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  @ApiOperation({ summary: 'Create a new task manually' })
  create(@Headers() headers: Record<string, string>, @Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(this.getUserId(headers), createTaskDto);
  }

  @Get()
  @ApiOperation({ summary: 'List tasks with optional smart view filters' })
  @ApiQuery({ name: 'view', enum: ['today', 'upcoming', 'overdue', 'completed'], required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'priority', required: false })
  findAll(
    @Headers() headers: Record<string, string>,
    @Query('view') view?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
  ) {
    return this.tasksService.findAll(this.getUserId(headers), { view, category, priority });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task by ID' })
  findOne(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.tasksService.findOne(this.getUserId(headers), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task or mark as completed' })
  update(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ) {
    return this.tasksService.update(this.getUserId(headers), id, updateTaskDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete task by ID' })
  remove(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.tasksService.remove(this.getUserId(headers), id);
  }
}
