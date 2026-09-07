import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Render terminates TLS at its own proxy, so without this every request looks
  // like it came from that proxy and an IP-based rate limit would throttle all
  // users as if they were one person.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // Browsers send Origin as scheme + host + port, with no trailing slash or
  // path, and the cors package matches it as an exact string. Normalise the
  // configured values so "https://site.io/" or "https://site.io/app" still match.
  const normaliseOrigin = (value: string): string => {
    try {
      return new URL(value).origin;
    } catch {
      return value.replace(/\/+$/, '');
    }
  };

  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => normaliseOrigin(origin.trim()))
    .filter(Boolean);

  const corsLogger = new Logger('CORS');
  // A refused origin is otherwise completely silent: the server answers the
  // preflight 204 with no Allow-Origin header, the browser bins the response,
  // and the only evidence is a console message on somebody else's machine.
  // Saying so here turns a guessing game into a log line.
  const refused = new Set<string>();

  corsLogger.log(
    allowedOrigins.length
      ? `Allowing ${allowedOrigins.join(', ')}`
      : 'CORS_ORIGINS is unset, so every origin is allowed. Set it in production.',
  );

  app.enableCors({
    origin: allowedOrigins.length
      ? (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
          // No Origin header at all means curl, a health check or a
          // server-to-server call - not a browser, and nothing to protect.
          if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
          }

          if (!refused.has(origin)) {
            refused.add(origin);
            corsLogger.warn(`Refused ${origin}. CORS_ORIGINS allows: ${allowedOrigins.join(', ')}`);
          }

          // false, not an error: answer the preflight without the header and
          // let the browser decide, rather than turning it into a 500.
          callback(null, false);
        }
      : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    // Idempotency-Key is a custom header, so the browser preflights every
    // mutation. Omit it and the OPTIONS fails and every browser write breaks -
    // not just the offline ones. curl does not preflight, so it hides this.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'Idempotency-Key'],
    maxAge: 86400,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

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
  SwaggerModule.setup('api/docs', app, document);

  // Export OpenAPI 3.0 JSON specification for SwaggerHub import
  const outputPath = path.resolve(process.cwd(), 'swagger-spec.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 QuickPlan NestJS Backend running on http://localhost:${port}`);
  console.log(`📚 Interactive Swagger UI: http://localhost:${port}/api/docs`);
  console.log(`📄 Exported OpenAPI Spec: ${outputPath}`);
}
bootstrap();
