import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoneException, NotFoundException } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarTokenService } from './calendar-token.service';

describe('reminder calendar endpoints', () => {
  let service: RemindersService;

  const reminder = {
    id: 'rem-1',
    userId: 'user-1',
    title: 'Dentist appointment',
    dueAt: new Date('2026-08-27T08:15:00Z'),
    offsetMinutes: 15,
    recurrenceRule: null,
    sequence: 0,
  };

  const prisma = { reminder: { findFirst: jest.fn() } };
  const tokens = { mint: jest.fn(), verify: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: CalendarTokenService, useValue: tokens },
      ],
    }).compile();
    service = module.get(RemindersService);
  });

  describe('createCalendarLink', () => {
    it('builds an absolute url carrying the token', async () => {
      prisma.reminder.findFirst.mockResolvedValue({ id: 'rem-1' });
      tokens.mint.mockReturnValue({ token: 'tok', expiresAt: new Date('2026-08-25T08:20:00Z') });

      const result = await service.createCalendarLink('user-1', 'rem-1', 'https://api.example.com');

      expect(result.url).toBe('https://api.example.com/api/reminders/rem-1/calendar.ics?token=tok');
      expect(result.expiresAt.toISOString()).toBe('2026-08-25T08:20:00.000Z');
    });

    it('404s for a reminder the caller does not own', async () => {
      prisma.reminder.findFirst.mockResolvedValue(null);

      await expect(
        service.createCalendarLink('someone-else', 'rem-1', 'https://api.example.com'),
      ).rejects.toThrow(NotFoundException);
      expect(tokens.mint).not.toHaveBeenCalled();
    });
  });

  describe('getCalendarFile', () => {
    it('returns the file and a slugged filename', async () => {
      tokens.verify.mockReturnValue({ ok: true, reminderId: 'rem-1', userId: 'user-1' });
      prisma.reminder.findFirst.mockResolvedValue(reminder);

      const result = await service.getCalendarFile('rem-1', 'tok');

      expect(result.filename).toBe('dentist-appointment.ics');
      expect(result.body).toContain('BEGIN:VCALENDAR');
      expect(result.body).toContain('UID:rem-1@quickplan.app');
    });

    /** 410 rather than 404, so the client can say "expired" and re-mint. */
    it('410s once the token has expired', async () => {
      tokens.verify.mockReturnValue({ ok: false, reason: 'EXPIRED' });

      await expect(service.getCalendarFile('rem-1', 'tok')).rejects.toThrow(GoneException);
    });

    it('404s on a forged or malformed token', async () => {
      tokens.verify.mockReturnValue({ ok: false, reason: 'INVALID' });

      await expect(service.getCalendarFile('rem-1', 'tok')).rejects.toThrow(NotFoundException);
    });

    it('404s when a token for one reminder is pointed at another', async () => {
      tokens.verify.mockReturnValue({ ok: true, reminderId: 'rem-OTHER', userId: 'user-1' });

      await expect(service.getCalendarFile('rem-1', 'tok')).rejects.toThrow(NotFoundException);
      expect(prisma.reminder.findFirst).not.toHaveBeenCalled();
    });

    it('404s when the reminder no longer belongs to the token holder', async () => {
      tokens.verify.mockReturnValue({ ok: true, reminderId: 'rem-1', userId: 'user-1' });
      prisma.reminder.findFirst.mockResolvedValue(null);

      await expect(service.getCalendarFile('rem-1', 'tok')).rejects.toThrow(NotFoundException);
    });
  });
});
