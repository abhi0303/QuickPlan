import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';

async function generateSwaggerSpec() {
  console.log('⚡ Generating Swagger OpenAPI 3.0 specification...');
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('QuickPlan API Spec')
    .setDescription('Voice-first Smart Todo + Reminder + Expense/IOU Engine API Documentation')
    .setVersion('1.0')
    .addTag('AI Smart Input', 'One-sentence natural language input processing')
    .addTag('Tasks', 'Task management endpoints')
    .addTag('Expenses & IOUs', 'Expense splitting and IOU management')
    .addTag('People & Contacts', 'Contact balance tracking')
    .addTag('Reminders', 'Reminder scheduling')
    .addTag('Notifications', 'PWA push notifications')
    .addTag('User & Settings', 'User registration and configuration')
    .addApiKey({ type: 'apiKey', name: 'x-user-id', in: 'header' }, 'x-user-id')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addSecurityRequirements('bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outputPath = path.resolve(process.cwd(), 'swagger-spec.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));

  console.log(`✅ OpenAPI 3.0 Specification file generated: ${outputPath}`);
  await app.close();
}

generateSwaggerSpec();
