import { types } from 'pg';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { MetricsService } from './metrics/metrics.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';


types.setTypeParser(1082, (val: string) => val);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind a reverse proxy / load balancer every request arrives from the
  // proxy's IP, so rate limiting would treat all users as one client. Opt in
  // per deployment so a bare local run doesn't trust spoofed headers.
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  // Every class-validator decorator on a DTO is inert until this pipe runs.
  // `whitelist` strips any field a DTO doesn't declare, which is what stops
  // clients smuggling `saccoId`, `status`, `paymentStatus` etc. into writes.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const metricsService = app.get(MetricsService);
  app.useGlobalFilters(new AllExceptionsFilter(metricsService)); // ← was FailedRequestFilter

  app.use(cookieParser());

  app.enableCors({
    origin: [
      'https://long-distance-shuttle-eek9.vercel.app',
      'http://localhost:3000', // your local frontend dev
      'http://localhost:5173'
    ],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`Server is running on http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
