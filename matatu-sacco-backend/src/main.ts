import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  app.enableCors({
    origin: 'http://localhost:5173', // your exact frontend origin, no trailing slash
    credentials: true, // required since your axios uses withCredentials: true
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
