import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DetectedField } from './ingestion.types';

@Injectable()
export class SchemaDetectionService {
  detectFromRecords(records: Record<string, unknown>[]): {
    fields: DetectedField[];
    schemaJson: Record<string, unknown>;
    schemaHash: string;
  } {
    if (!records.length) {
      return { fields: [], schemaJson: { columns: [] }, schemaHash: 'empty' };
    }
    const keys = Object.keys(records[0]);
    const fields: DetectedField[] = keys.map((fieldName, ordinal) => {
      const samples = records
        .slice(0, 20)
        .map((row) => row[fieldName])
        .filter((v) => v !== null && v !== undefined && v !== '');
      return {
        fieldName,
        displayName: fieldName,
        dataType: this.inferType(samples),
        semanticType: this.inferSemanticType(fieldName),
        nullable: samples.length < Math.min(records.length, 20),
        sampleValues: samples.slice(0, 5),
      };
    });
    const schemaJson = {
      columns: fields.map((f) => ({
        name: f.fieldName,
        type: f.dataType,
        semanticType: f.semanticType,
      })),
      rowCount: records.length,
    };
    const schemaHash = createHash('sha256')
      .update(JSON.stringify(schemaJson))
      .digest('hex')
      .slice(0, 16);
    return { fields, schemaJson, schemaHash };
  }

  private inferType(samples: unknown[]): string {
    if (!samples.length) return 'string';
    if (samples.every((v) => typeof v === 'number' || !Number.isNaN(Number(v)))) {
      return 'decimal';
    }
    if (samples.every((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v)))) {
      return 'date';
    }
    if (samples.every((v) => typeof v === 'boolean' || v === 'true' || v === 'false')) {
      return 'boolean';
    }
    return 'string';
  }

  private inferSemanticType(fieldName: string): string | undefined {
    const lower = fieldName.toLowerCase();
    if (/amount|revenue|sales|price|cost|fee|income|profit/.test(lower)) {
      return 'metric';
    }
    if (/region|area|province|city|country/.test(lower)) return 'dimension';
    if (/year|month|date|time|period/.test(lower)) return 'time';
    if (/id|code|no|number/.test(lower)) return 'identifier';
    if (/name|title|label/.test(lower)) return 'label';
    return undefined;
  }
}
