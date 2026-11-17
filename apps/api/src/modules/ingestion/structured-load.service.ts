import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { DetectedField } from './ingestion.types';

@Injectable()
export class StructuredLoadService {
  constructor(private readonly prisma: PrismaService) {}

  async loadRecords(
    datasetVersionId: string,
    records: Record<string, unknown>[],
  ): Promise<number> {
    await this.prisma.datasetRecord.deleteMany({ where: { datasetVersionId } });
    const batchSize = 500;
    for (let i = 0; i < records.length; i += batchSize) {
      const slice = records.slice(i, i + batchSize);
      await this.prisma.datasetRecord.createMany({
        data: slice.map((data, offset) => ({
          datasetVersionId,
          rowIndex: i + offset,
          data: data as Prisma.InputJsonValue,
        })),
      });
    }
    return records.length;
  }

  async saveSchema(
    datasetVersionId: string,
    fields: DetectedField[],
    schemaJson: Record<string, unknown>,
    schemaHash: string,
  ) {
    const schema = await this.prisma.datasetSchema.create({
      data: {
        datasetVersionId,
        schemaJson: schemaJson as Prisma.InputJsonValue,
        schemaHash,
      },
    });
    await this.prisma.datasetField.createMany({
      data: fields.map((field, ordinal) => ({
        datasetSchemaId: schema.id,
        fieldName: field.fieldName,
        displayName: field.displayName ?? field.fieldName,
        dataType: field.dataType,
        semanticType: field.semanticType,
        nullable: field.nullable,
        ordinal,
        sampleValues: field.sampleValues as Prisma.InputJsonValue,
      })),
    });
    return schema;
  }
}
