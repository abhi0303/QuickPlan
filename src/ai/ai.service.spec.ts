import { Test, TestingModule } from '@nestjs/testing';
import { AiService, ExtractedIntent } from './ai.service';

describe('AiService (Natural Language & Multilingual Intent Parsing)', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should parse IOU payable: "Rahul ko 100 rupee dene hai pizza ke."', async () => {
    const result = await service.processSmartInput('Rahul ko 100 rupee dene hai pizza ke.');
    expect(result.intent).toBe(ExtractedIntent.CREATE_IOU);
    expect(result.payload.personName).toBe('Rahul');
    expect(result.payload.amount).toBe(100);
    expect(result.payload.direction).toBe('PAYABLE');
    expect(result.payload.reason).toBe('pizza');
  });

  it('should parse IOU receivable: "Rahul se 200 lene hain."', async () => {
    const result = await service.processSmartInput('Rahul se 200 lene hain.');
    expect(result.intent).toBe(ExtractedIntent.CREATE_IOU);
    expect(result.payload.personName).toBe('Rahul');
    expect(result.payload.amount).toBe(200);
    expect(result.payload.direction).toBe('RECEIVABLE');
  });

  it('should parse expense split: "500 rupee ko 5 logo mein divide kar do aur maine pay kiya hai."', async () => {
    const result = await service.processSmartInput('500 rupee ko 5 logo mein divide kar do aur maine pay kiya hai.');
    expect(result.intent).toBe(ExtractedIntent.SPLIT_EXPENSE);
    expect(result.payload.totalAmount).toBe(500);
    expect(result.payload.participantsCount).toBe(5);
  });

  it('should parse task creation: "Kal subah 10 baje Rahul ko call karna hai."', async () => {
    const result = await service.processSmartInput('Kal subah 10 baje Rahul ko call karna hai.');
    expect(result.intent).toBe(ExtractedIntent.CREATE_TASK);
    expect(result.payload.dueDate).toBeDefined();
    expect(result.payload.category).toBe('Calls & Meetings');
  });

  it('should detect missing time for call task without time', async () => {
    const result = await service.processSmartInput('Kal Rahul ko call karna hai.');
    expect(result.intent).toBe(ExtractedIntent.CREATE_TASK);
    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toContain('What time would you prefer');
  });
});
