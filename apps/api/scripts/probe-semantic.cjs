/* Read-only semantic probe using the server's configured model and catalog. */
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  if (!process.env.AI_API_KEY || !process.env.DATABASE_URL) {
    console.error(
      '无法实测：需要运行环境中的 AI_API_KEY 和 DATABASE_URL。未发送模型请求。',
    );
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(__dirname, '..');
  const dist = fs.existsSync(path.join(root, 'dist/src/main.js'))
    ? path.join(root, 'dist/src')
    : path.join(root, 'dist');
  const { ConfigService } = require('@nestjs/config');
  const { PrismaService } = require(
    path.join(dist, 'infrastructure/prisma/prisma.service.js'),
  );
  const { DeepSeekChatService } = require(
    path.join(dist, 'infrastructure/ai/deepseek-chat.service.js'),
  );
  const { LlmUsageMeterService } = require(
    path.join(dist, 'infrastructure/ai/llm-usage-meter.service.js'),
  );
  const { SemanticResolutionService } = require(
    path.join(dist, 'modules/semantic/semantic-resolution.service.js'),
  );
  const { buildResearchQueryPlan } = require(
    path.join(dist, 'modules/search/research-query-plan.js'),
  );
  const modelIndex = process.argv.indexOf('--model');
  const model =
    modelIndex >= 0 ? process.argv[modelIndex + 1] : process.env.OPENAI_MODEL;
  if (!model)
    throw new Error(
      '未配置 OPENAI_MODEL；可用 --model 指定实际页面选择的模型。',
    );
  const queries = process.argv
    .slice(2)
    .filter(
      (value, index, args) =>
        value !== '--model' && args[index - 1] !== '--model',
    );
  const prisma = new PrismaService();
  const meter = new LlmUsageMeterService();
  const chat = new DeepSeekChatService(
    new ConfigService({
      ...process.env,
      OPENAI_MODEL: model,
      OPENAI_TIMEOUT_MS: Number(process.env.OPENAI_TIMEOUT_MS || 60000),
      RESEARCH_PLANNING_TIMEOUT_MS: Number(
        process.env.RESEARCH_PLANNING_TIMEOUT_MS || 120000,
      ),
    }),
    meter,
  );
  const traces = [];
  const parse = chat.parseSemanticQuery.bind(chat);
  chat.parseSemanticQuery = async (query, catalog, options) => {
    const result = await parse(query, catalog, options);
    traces.push({ repair: Boolean(options?.expandEntityGroups), result });
    return result;
  };
  try {
    await prisma.$connect();
    for (const query of queries.length
      ? queries
      : ['主要经济体有哪些', '主要经济体2025年GDP排名', '中国2025年GDP']) {
      traces.length = 0;
      const started = Date.now();
      const measured = await meter.measure(() =>
        new SemanticResolutionService(prisma, chat).resolve(query),
      );
      const resolution = measured.result;
      const plan = buildResearchQueryPlan({
        originalQuery: query,
        optimizedQuery: query,
        resolution,
        filters: {
          countries: [],
          regions: [],
          entities: [],
          indicators: [],
          timeRanges: [],
          sources: [],
        },
      });
      console.log(
        JSON.stringify(
          {
            query,
            model,
            durationMs: Date.now() - started,
            modelCalls: traces,
            resolution,
            plan,
            usage: measured.usage,
            note: '这是实际模型的候选语义范围，不代表完成数据检索或核实GDP排名。',
          },
          null,
          2,
        ),
      );
      if (traces.every((trace) => !trace.result)) process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  // Avoid printing provider URLs, request objects or connection credentials.
  console.error(
    `语义实测未完成（${error?.name || 'Error'}），请检查服务配置和连通性。`,
  );
  process.exitCode = 1;
});
