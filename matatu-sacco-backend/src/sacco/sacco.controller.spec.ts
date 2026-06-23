import { Test, TestingModule } from '@nestjs/testing';
import { SaccoController } from './sacco.controller';

describe('SaccoController', () => {
  let controller: SaccoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SaccoController],
    }).compile();

    controller = module.get<SaccoController>(SaccoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
