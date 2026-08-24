import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { OnboardingService } from '../onboarding/onboarding.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private onboarding: OnboardingService,
  ) {}

  async createUser(dto: CreateUserDto) {
    if (!dto?.name || !dto.name.trim() || !dto?.email || !dto.email.trim()) {
      throw new BadRequestException('Both name and email are mandatory fields to create a user.');
    }

    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException(`User with email ${email} already exists.`);
    }

    const passwordHash = dto.password ? await this.hashPassword(dto.password) : undefined;

    return this.prisma.user.create({
      data: {
        name,
        email,
        ...(passwordHash ? { passwordHash } : {}),
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
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        settings: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await promisify(scryptCallback)(password, salt, 64)) as Buffer;
    return `scrypt:${salt}:${derivedKey.toString('hex')}`;
  }

  async verifyPassword(password: string, storedHash: string) {
    const [algorithm, salt, hash] = storedHash.split(':');
    if (algorithm !== 'scrypt' || !salt || !hash) return false;

    const derivedKey = (await promisify(scryptCallback)(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hash, 'hex');
    return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
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

    // Embedded so the client can decide whether to open the tour on login
    // without a second round trip.
    return { ...user, onboarding: this.onboarding.summarise(user) };
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
