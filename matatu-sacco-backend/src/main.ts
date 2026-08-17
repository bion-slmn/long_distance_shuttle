import { types } from 'pg';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { MetricsService } from './metrics/metrics.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';


types.setTypeParser(1082, (val: string) => val);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const metricsService = app.get(MetricsService);
  app.useGlobalFilters(new AllExceptionsFilter(metricsService)); // ← was FailedRequestFilter

  app.use(cookieParser());

  app.enableCors({
    origin: 'http://localhost:5173',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`Server is running on http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
