import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async createUser(dto: CreateUserDto) {
    if (!dto?.name || !dto.name.trim() || !dto?.email || !dto.email.trim()) {
      throw new BadRequestException('Both name and email are mandatory fields to create a user.');
    }

    const email = dto.email.trim();
    const name = dto.name.trim();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException(`User with email ${email} already exists.`);
    }

    return this.prisma.user.create({
      data: {
        name,
        email,
        settings: {
          create: {
            inputLanguage: 'AUTO',
            outputLanguage: 'SAME',
            notificationsEnabled: true,
            defaultReminderOffsetMinutes: 15,
            defaultPriority: 'MEDIUM',
            defaultCategory: 'General',
            currency: 'INR',
          },
        },
      },
      include: { settings: true },
    });
  }

  async ensureUserExists(userId: string) {
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          id: userId,
          name: 'QuickPlan User',
          settings: {
            create: {
              inputLanguage: 'AUTO',
              outputLanguage: 'SAME',
              notificationsEnabled: true,
              defaultReminderOffsetMinutes: 15,
              defaultPriority: 'MEDIUM',
              defaultCategory: 'General',
              currency: 'INR',
            },
          },
        },
        include: { settings: true },
      });
    }

    return user;
  }

  async getUserProfile(userId: string) {
    const user = await this.ensureUserExists(userId);
    return user;
  }

  async updateUserProfile(userId: string, dto: UpdateUserDto) {
    await this.ensureUserExists(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        email: dto.email,
      },
      include: { settings: true },
    });
  }

  async getSettings(userId: string) {
    const user = await this.ensureUserExists(userId);
    return user.settings;
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    await this.ensureUserExists(userId);
    return this.prisma.userSettings.update({
      where: { userId },
      data: dto,
    });
  }
}
