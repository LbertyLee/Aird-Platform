import { Module } from '@nestjs/common';
import { SemanticResolutionService } from './semantic-resolution.service';

@Module({
  providers: [SemanticResolutionService],
  exports: [SemanticResolutionService],
})
export class SemanticModule {}
