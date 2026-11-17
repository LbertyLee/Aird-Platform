import { Injectable } from '@nestjs/common';
import type { DetectedField } from './ingestion.types';

export type QualityReport = {
  status: 'passed' | 'warning' | 'failed';
  errorCount: number;
  warningCount: number;
  details: Array<{ rule: string; message: string; severity: 'error' | 'warning' }>;
};

@Injectable()
export class DataQualityService {
  validate(
    records: Record<string, unknown>[],
    fields: DetectedField[],
  ): QualityReport {
    const details: QualityReport['details'] = [];
    if (!records.length) {
      details.push({
        rule: 'empty_dataset',
        message: '数据集无有效行',
        severity: 'error',
      });
    }
    for (const field of fields) {
      const nullCount = records.filter(
        (row) =>
          row[field.fieldName] === null ||
          row[field.fieldName] === undefined ||
          row[field.fieldName] === '',
      ).length;
      if (field.semanticType === 'metric' && nullCount > records.length * 0.5) {
        details.push({
          rule: 'metric_null_ratio',
          message: `指标字段 ${field.fieldName} 空值比例过高 (${nullCount}/${records.length})`,
          severity: 'warning',
        });
      }
      if (field.dataType === 'decimal') {
        const invalid = records.filter((row) => {
          const v = row[field.fieldName];
          return v !== null && v !== undefined && v !== '' && Number.isNaN(Number(v));
        }).length;
        if (invalid > 0) {
          details.push({
            rule: 'type_mismatch',
            message: `字段 ${field.fieldName} 存在 ${invalid} 条非数值记录`,
            severity: 'error',
          });
        }
      }
    }
    const errorCount = details.filter((d) => d.severity === 'error').length;
    const warningCount = details.filter((d) => d.severity === 'warning').length;
    return {
      status: errorCount > 0 ? 'failed' : warningCount > 0 ? 'warning' : 'passed',
      errorCount,
      warningCount,
      details,
    };
  }
}
