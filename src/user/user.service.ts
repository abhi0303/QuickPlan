import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExpenseScope } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { OnboardingService } from '../onboarding/onboarding.service';

/** What the owner of an account is allowed to see about themselves. */
const PROFILE = {
  id: true,
  name: true,
  email: true,
  upiIds: true,
  termsVersion: true,
  termsAcceptedAt: true,
  createdAt: true,
  updatedAt: true,
  settings: true,
} as const;

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
        termsVersion: dto.termsVersion,
        // From the server clock, never the client's: a timestamp the caller
        // chooses is not evidence of anything.
        termsAcceptedAt: new Date(),
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
      select: PROFILE,
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
        // undefined leaves the list alone; [] clears it.
        upiIds: dto.upiIds,
      },
      // An explicit select, because `include` on its own returns every scalar
      // on User - passwordHash and passwordChangedAt included.
      select: PROFILE,
    });
  }

  /**
   * Its own route rather than a field on PATCH /api/user/me, so that accepting
   * terms can never happen as a side effect of editing a profile.
   */
  async acceptTerms(userId: string, version: string) {
    await this.ensureUserExists(userId);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { termsVersion: version, termsAcceptedAt: new Date() },
      select: { termsVersion: true, termsAcceptedAt: true },
    });

    return user;
  }

  /**
   * Erasure for somebody entangled with other people.
   *
   * Their own data goes. Group expenses and settlements stay, with the account
   * reduced to a tombstone: deleting those rows would silently rewrite three
   * other people's balances, and a stranger's debt quietly changing is worse
   * for them than a row reading "Removed user".
   *
   * The User row itself stays for the same reason - group balances point at
   * it, and Group.createdById cascades, so deleting the row would take whole
   * groups and everybody's expenses in them along with it.
   */
  async deleteAccount(userId: string, currentPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || user.deletedAt) {
      throw new NotFoundException('Account not found.');
    }

    if (!user.passwordHash || !(await this.verifyPassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is not correct.');
    }

    const tombstone = `deleted-${user.id}@removed.invalid`;

    await this.prisma.$transaction([
      // Personal ledger: theirs alone, so it goes.
      this.prisma.expense.deleteMany({ where: { ownerId: userId, scope: ExpenseScope.PERSONAL } }),
      this.prisma.task.deleteMany({ where: { userId } }),
      this.prisma.reminder.deleteMany({ where: { userId } }),
      this.prisma.budget.deleteMany({ where: { userId } }),
      this.prisma.budgetPlan.deleteMany({ where: { userId } }),
      // Including group ones: otherwise it keeps writing expenses after they
      // have gone.
      this.prisma.recurringExpense.deleteMany({ where: { userId } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
      this.prisma.userMission.deleteMany({ where: { userId } }),
      this.prisma.idempotencyKey.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId } }),
      // Both directions, so they leave everyone else's friend list too.
      this.prisma.friendship.deleteMany({
        where: { OR: [{ userId }, { friendId: userId }] },
      }),
      // Theirs, and the ones naming them in somebody else's feed - the body
      // text carries their name, so leaving those would leave the name behind.
      this.prisma.notification.deleteMany({
        where: { OR: [{ userId }, { actorId: userId }] },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          name: 'Removed user',
          // Keeps the unique index satisfied and frees the real address for
          // signing up again.
          email: tombstone,
          passwordHash: null,
          // Ends every session that is still open.
          passwordChangedAt: new Date(),
          emailVerifiedAt: null,
          upiIds: [],
          deletedAt: new Date(),
        },
      }),
    ]);

    return { deleted: true, message: 'Your account has been deleted.' };
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
