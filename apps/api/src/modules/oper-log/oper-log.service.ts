import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperLogPageQueryDto } from './dto/oper-log.dto';

/**
 * 操作日志写入条目。
 */
export type OperLogCreateInput = {
  title: string;
  businessType: number;
  method: string;
  requestMethod: string;
  operName: string;
  deptName?: string;
  operUrl: string;
  operIp: string;
  operLocation?: string;
  operParam: string;
  jsonResult: string;
  status: number;
  errorMsg?: string;
  costTime: number;
};

/**
 * 操作日志持久化与查询。
 */
@Injectable()
export class OperLogService {
  /**
   * @param prisma Prisma 客户端
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 异步写入操作日志，失败时不影响主流程。
   */
  async create(input: OperLogCreateInput): Promise<void> {
    await this.prisma.operLog.create({
      data: {
        title: input.title.slice(0, 50),
        businessType: input.businessType,
        method: input.method.slice(0, 100),
        requestMethod: input.requestMethod.slice(0, 10),
        operName: input.operName.slice(0, 50),
        deptName: (input.deptName ?? '').slice(0, 50),
        operUrl: input.operUrl.slice(0, 255),
        operIp: input.operIp.slice(0, 128),
        operLocation: (input.operLocation ?? '').slice(0, 255),
        operParam: input.operParam,
        jsonResult: input.jsonResult,
        status: input.status,
        errorMsg: (input.errorMsg ?? '').slice(0, 4000),
        costTime: BigInt(Math.max(0, Math.round(input.costTime))),
      },
    });
  }

  /**
   * 分页查询操作日志。
   */
  async page(query: OperLogPageQueryDto): Promise<PageResultDto<OperLogView>> {
    const { skip, take } = query.toSkipTake();
    const and: Prisma.OperLogWhereInput[] = [];

    if (query.title?.trim()) {
      and.push({
        title: { contains: query.title.trim(), mode: 'insensitive' },
      });
    }
    if (query.operName?.trim()) {
      and.push({
        operName: { contains: query.operName.trim(), mode: 'insensitive' },
      });
    }
    if (query.businessType !== undefined) {
      and.push({ businessType: query.businessType });
    }
    if (query.status !== undefined) {
      and.push({ status: query.status });
    }
    if (query.requestMethod?.trim()) {
      and.push({
        requestMethod: query.requestMethod.trim().toUpperCase(),
      });
    }
    if (query.beginTime || query.endTime) {
      const operTime: Prisma.DateTimeFilter = {};
      if (query.beginTime) operTime.gte = new Date(query.beginTime);
      if (query.endTime) operTime.lte = new Date(query.endTime);
      and.push({ operTime });
    }
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      and.push({
        OR: [
          { title: { contains: keyword, mode: 'insensitive' } },
          { method: { contains: keyword, mode: 'insensitive' } },
          { operUrl: { contains: keyword, mode: 'insensitive' } },
          { operParam: { contains: keyword, mode: 'insensitive' } },
          { errorMsg: { contains: keyword, mode: 'insensitive' } },
          { operName: { contains: keyword, mode: 'insensitive' } },
        ],
      });
    }

    const categoryWhere = this.buildCategoryWhere(query.category);
    if (categoryWhere) and.push(categoryWhere);

    const where: Prisma.OperLogWhereInput =
      and.length > 0 ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      this.prisma.operLog.findMany({
        where,
        orderBy: { operTime: 'desc' },
        skip,
        take,
      }),
      this.prisma.operLog.count({ where }),
    ]);

    return new PageResultDto(
      rows.map((row) => this.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  private buildCategoryWhere(
    category?: 'login' | 'export' | 'delete',
  ): Prisma.OperLogWhereInput | null {
    if (!category) return null;
    if (category === 'login') {
      return {
        OR: [
          { operUrl: { contains: '/login', mode: 'insensitive' } },
          { operUrl: { contains: '/logout', mode: 'insensitive' } },
          { method: { contains: 'AuthController.login', mode: 'insensitive' } },
          { method: { contains: 'AuthController.logout', mode: 'insensitive' } },
          { title: { contains: '登录', mode: 'insensitive' } },
          { title: { contains: '登出', mode: 'insensitive' } },
          { title: { contains: '退出', mode: 'insensitive' } },
        ],
      };
    }
    if (category === 'export') {
      return {
        OR: [
          { operUrl: { contains: '/export', mode: 'insensitive' } },
          { title: { contains: '导出', mode: 'insensitive' } },
        ],
      };
    }
    return {
      OR: [
        { businessType: 3 },
        { requestMethod: 'DELETE' },
        { operUrl: { contains: 'batch-delete', mode: 'insensitive' } },
        { operUrl: { contains: '/delete', mode: 'insensitive' } },
        { title: { contains: '删除', mode: 'insensitive' } },
      ],
    };
  }

  /**
   * 按 ID 查询单条操作日志。
   */
  async detail(id: string): Promise<OperLogView | null> {
    const row = await this.prisma.operLog.findUnique({ where: { id } });
    return row ? this.toView(row) : null;
  }

  private toView(row: OperLogRow): OperLogView {
    return {
      id: row.id,
      title: row.title,
      businessType: row.businessType,
      method: row.method,
      requestMethod: row.requestMethod,
      operName: row.operName,
      deptName: row.deptName,
      operUrl: row.operUrl,
      operIp: row.operIp,
      operLocation: row.operLocation,
      operParam: row.operParam,
      jsonResult: row.jsonResult,
      status: row.status,
      errorMsg: row.errorMsg,
      operTime: row.operTime.toISOString(),
      costTime: Number(row.costTime),
    };
  }
}

export type OperLogView = {
  id: string;
  title: string;
  businessType: number;
  method: string;
  requestMethod: string;
  operName: string;
  deptName: string;
  operUrl: string;
  operIp: string;
  operLocation: string;
  operParam: string;
  jsonResult: string;
  status: number;
  errorMsg: string;
  operTime: string;
  costTime: number;
};

type OperLogRow = {
  id: string;
  title: string;
  businessType: number;
  method: string;
  requestMethod: string;
  operName: string;
  deptName: string;
  operUrl: string;
  operIp: string;
  operLocation: string;
  operParam: string;
  jsonResult: string;
  status: number;
  errorMsg: string;
  operTime: Date;
  costTime: bigint;
};
