import { Test, TestingModule } from '@nestjs/testing';
import { SaccoService } from './sacco.service';

describe('SaccoService', () => {
  let service: SaccoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SaccoService],
    }).compile();

    service = module.get<SaccoService>(SaccoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
