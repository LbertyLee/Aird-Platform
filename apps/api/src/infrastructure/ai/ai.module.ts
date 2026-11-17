import { Global, Module } from '@nestjs/common';
import { DeepSeekChatService } from './deepseek-chat.service';
import { EmbeddingService } from './embedding.service';
import { LlmUsageMeterService } from './llm-usage-meter.service';
import { ModelSelectionService } from './model-selection.service';

/**
 * AI 能力（Embedding + Qwen Chat）全局模块。
 */
@Global()
@Module({
  providers: [EmbeddingService, DeepSeekChatService, LlmUsageMeterService, ModelSelectionService],
  exports: [EmbeddingService, DeepSeekChatService, LlmUsageMeterService, ModelSelectionService],
})
export class AiModule {}
