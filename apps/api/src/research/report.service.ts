import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ResearchReport } from '@agent/contracts';
import type { SourceEntity } from './research.types';
import { ModelSelectionService } from '../infrastructure/ai/model-selection.service';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly client?: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService, @Optional() private readonly modelSelection?: ModelSelectionService) {
    const apiKey = config.get<string>('AI_API_KEY') || undefined;
    const baseURL = config.get<string>('OPENAI_BASE_URL') || undefined;
    this.model =
      config.get<string>('OPENAI_REASONING_MODEL')?.trim() || 'qwen3.8-max';
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : undefined;
  }

  async generate(
    query: string,
    sources: SourceEntity[],
  ): Promise<ResearchReport> {
    if (this.client && sources.length > 0) {
      try {
        const markdown = await this.generateWithAi(query, sources);
        return {
          title: `${query}：综合研究报告`,
          markdown,
          generatedBy: 'ai',
          createdAt: new Date().toISOString(),
        };
      } catch (error) {
        this.logger.warn(
          `AI report generation failed; using evidence template: ${this.errorMessage(error)}`,
        );
      }
    }

    return {
      title: `${query}：来源汇总报告`,
      markdown: this.generateTemplate(query, sources),
      generatedBy: 'template',
      createdAt: new Date().toISOString(),
    };
  }

  private async generateWithAi(
    query: string,
    sources: SourceEntity[],
  ): Promise<string> {
    const evidence = sources
      .map(
        (source, index) =>
          `[S${index + 1}] ${source.title}\n类型：${source.storageType}\n来源：${source.sourceUrl ?? '用户上传'}\n内容：${source.textContent.slice(0, 1800)}`,
      )
      .join('\n\n')
      .slice(0, 14_000);

    const completion = await this.client!.chat.completions.create({
      model: this.modelSelection?.current(this.model) ?? this.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是严谨的研究报告助手。只能使用给定证据，不得补造数值或来源。事实陈述必须标注 [S1] 形式的来源编号。输出中文 Markdown，包含摘要、主要发现、数据与知识证据、局限性、来源。',
        },
        {
          role: 'user',
          content: `研究问题：${query}\n\n可用证据：\n${evidence}`,
        },
      ],
    });

    return (
      completion.choices[0]?.message.content?.trim() ||
      this.generateTemplate(query, sources)
    );
  }

  private generateTemplate(query: string, sources: SourceEntity[]): string {
    const structured = sources.filter(
      (source) => source.storageType === 'structured',
    );
    const knowledge = sources.filter(
      (source) => source.storageType === 'knowledge',
    );

    const sections = [
      `# ${query}：来源汇总报告`,
      '',
      '## 摘要',
      sources.length > 0
        ? `本次检索汇总 ${sources.length} 个可追溯来源，其中结构化数据 ${structured.length} 个、知识资料 ${knowledge.length} 个。当前未配置或未调用大模型时，报告仅整理证据，不对缺失事实作推断。`
        : '当前数据库和知识库没有匹配内容，且外部检索未返回可用来源。请上传资料、调整查询，或配置 Exa API Key 后重试。',
      '',
      '## 结构化数据',
      structured.length > 0
        ? structured
            .map(
              (source) =>
                `- [S${sources.indexOf(source) + 1}] **${source.title}**：${source.recordCount} 条记录。${this.structuredPreview(source)}`,
            )
            .join('\n')
        : '- 暂无匹配的结构化数据。',
      '',
      '## 知识资料',
      knowledge.length > 0
        ? knowledge
            .map(
              (source) =>
                `- [S${sources.indexOf(source) + 1}] **${source.title}**：${source.excerpt}`,
            )
            .join('\n')
        : '- 暂无匹配的知识资料。',
      '',
      '## 结论与局限',
      '- 本报告只汇总已入库或本次外部检索获取的来源。',
      '- 未经结构化校验的网页摘要仅作为知识线索，不作为确定性统计数据。',
      '- 重要结论应回到原始来源复核。',
      '',
      '## 来源',
      sources.length > 0
        ? sources
            .map(
              (source, index) =>
                `- [S${index + 1}] ${source.title}${source.sourceUrl ? `：${source.sourceUrl}` : '（用户上传）'}`,
            )
            .join('\n')
        : '- 无',
    ];

    return sections.join('\n');
  }

  private structuredPreview(source: SourceEntity): string {
    if (source.structuredData === undefined) return source.excerpt;
    const preview = JSON.stringify(source.structuredData).slice(0, 240);
    return preview ? `数据预览：${preview}` : source.excerpt;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
