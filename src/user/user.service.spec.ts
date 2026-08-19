import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

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
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should register a new user with default settings', async () => {
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
    expect(mockPrismaService.user.create).toHaveBeenCalled();
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
