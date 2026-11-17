import { Injectable } from '@nestjs/common';
import type { SemanticResolution } from '../semantic/semantic.types';

export type QueryRoute = 'structured' | 'semantic' | 'hybrid';

@Injectable()
export class QueryRouterService {
  route(resolution: SemanticResolution, query: string): QueryRoute {
    const hasMetric = resolution.metrics.length > 0;
    const hasAnalysis =
      resolution.intent === 'analysis' ||
      /为什么|原因|影响|解读/.test(query);
    const hasRegionalStructuredHint =
      resolution.dimensions.some((item) => item.type === 'region') &&
      /统计|数量|人口|销量|产量|数据/.test(query);
    if (hasMetric && hasAnalysis) return 'hybrid';
    if (hasMetric && (resolution.intent === 'metric_query' || resolution.intent === 'lookup')) {
      return 'structured';
    }
    if (resolution.intent === 'analysis' || resolution.concepts.length > 0) {
      return 'semantic';
    }
    if (hasMetric) return 'structured';
    if (hasRegionalStructuredHint) return 'structured';
    return 'semantic';
  }
}
