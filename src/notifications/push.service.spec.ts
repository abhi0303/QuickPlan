import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
  generateVAPIDKeys: jest.fn(),
}));

describe('PushService', () => {
  let service: PushService;

  const prisma = {
    pushSubscription: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
  };

  const env: Record<string, string> = {
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:test@example.com',
  };

  const build = async (values: Record<string, string>) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: string) => values[k] ?? d },
        },
      ],
    }).compile();
    const s = module.get(PushService);
    s.onModuleInit();
    return s;
  };

  const subs = [
    { id: 's1', endpoint: 'https://push/1', p256dh: 'a', auth: 'b' },
    { id: 's2', endpoint: 'https://push/2', p256dh: 'c', auth: 'd' },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await build(env);
  });

  it('delivers to every device the user has', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue(subs);
    (webpush.sendNotification as jest.Mock).mockResolvedValue({});

    const result = await service.sendToUser('user-1', { title: 'Hi' });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, removed: 0, failed: 0 });
  });

  it.each([404, 410])('deletes a subscription the push service reports gone (%i)', async (statusCode) => {
    prisma.pushSubscription.findMany.mockResolvedValue([subs[0]]);
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode, message: 'gone' });

    const result = await service.sendToUser('user-1', { title: 'Hi' });

    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(result).toEqual({ sent: 0, removed: 1, failed: 0 });
  });

  it('keeps a rate-limited subscription and counts the failure', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([subs[0]]);
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 429, message: 'slow down' });

    const result = await service.sendToUser('user-1', { title: 'Hi' });

    expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { failureCount: { increment: 1 } },
    });
    expect(result).toEqual({ sent: 0, removed: 0, failed: 1 });
  });

  it('drops the data bag rather than exceeding the 3KB limit', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([subs[0]]);
    (webpush.sendNotification as jest.Mock).mockResolvedValue({});

    await service.sendToUser('user-1', {
      title: 'Hi',
      data: { blob: 'x'.repeat(4000) },
    });

    const body = (webpush.sendNotification as jest.Mock).mock.calls[0][1];
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(3 * 1024);
    expect(JSON.parse(body)).toEqual({ title: 'Hi' });
  });

  it('stays disabled and sends nothing when VAPID keys are absent', async () => {
    const disabled = await build({});
    prisma.pushSubscription.findMany.mockResolvedValue(subs);

    const result = await disabled.sendToUser('user-1', { title: 'Hi' });

    expect(disabled.isEnabled()).toBe(false);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, removed: 0, failed: 0 });
  });
});
