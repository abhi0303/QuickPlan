import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';

describe('UserService (Add User & Profile Flow)', () => {
  let service: UserService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userSettings: {
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: OnboardingService,
          useValue: { summarise: jest.fn().mockReturnValue({ shouldShow: true }) },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should register a new user when mandatory name and email are provided', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);
    mockPrismaService.user.create.mockResolvedValue({
      id: 'new-user-1',
      name: 'Abhi',
      email: 'abhi@example.com',
      settings: { currency: 'INR' },
    });

    const user = await service.createUser({
      name: 'Abhi',
      email: 'abhi@example.com',
    });

    expect(user.id).toBe('new-user-1');
    expect(user.name).toBe('Abhi');
    expect(user.email).toBe('abhi@example.com');
  });

  it('should throw BadRequestException if name or email is missing', async () => {
    await expect(service.createUser({ name: '', email: 'test@example.com' })).rejects.toThrow(BadRequestException);
    await expect(service.createUser({ name: 'Abhi', email: '' })).rejects.toThrow(BadRequestException);
    await expect(service.createUser({ name: '  ', email: '  ' })).rejects.toThrow(BadRequestException);
  });

  it('should auto-ensure user exists on first request', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);
    mockPrismaService.user.create.mockResolvedValue({
      id: 'default-user-id',
      name: 'QuickPlan User',
      settings: { currency: 'INR' },
    });

    const user = await service.ensureUserExists('default-user-id');
    expect(user.id).toBe('default-user-id');
  });
});
