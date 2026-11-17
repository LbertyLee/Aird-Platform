import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaService } from '../prisma/prisma.service';

export type SearchModelOption = { value: string; label: string };
export type SearchModelAdminItem = SearchModelOption & { id: string; status: 'active' | 'disabled'; sort: number };

@Injectable()
export class ModelSelectionService {
  private readonly storage = new AsyncLocalStorage<string | undefined>();

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SearchModelOption[]> {
    return this.prisma.searchModelConfig.findMany({
      where: { status: 'active' },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      select: { value: true, label: true },
    });
  }

  async resolve(value?: string): Promise<string | undefined> {
    if (!value) return undefined;
    const model = await this.prisma.searchModelConfig.findUnique({
      where: { value },
      select: { value: true, status: true },
    });
    return model?.status === 'active' ? model.value : undefined;
  }

  async adminList(): Promise<SearchModelAdminItem[]> {
    return this.prisma.searchModelConfig.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, value: true, label: true, status: true, sort: true },
    }) as Promise<SearchModelAdminItem[]>;
  }

  async create(value: string, label: string, sort = 0): Promise<SearchModelAdminItem> {
    const normalizedValue = value.trim();
    const normalizedLabel = label.trim();
    if (!normalizedValue || !normalizedLabel) throw new BadRequestException('模型值和显示名称不能为空。');
    try {
      return await this.prisma.searchModelConfig.create({
        data: { value: normalizedValue, label: normalizedLabel, sort },
        select: { id: true, value: true, label: true, status: true, sort: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('该模型标识已存在。');
      throw error;
    }
  }

  async update(id: string, data: { value?: string; label?: string; sort?: number; status?: 'active' | 'disabled' }) {
    if (data.value !== undefined && !data.value.trim()) throw new BadRequestException('模型标识不能为空。');
    if (data.label !== undefined && !data.label.trim()) throw new BadRequestException('显示名称不能为空。');
    try {
      return await this.prisma.searchModelConfig.update({
        where: { id },
        data: {
          ...(data.value === undefined ? {} : { value: data.value.trim() }),
          ...(data.label === undefined ? {} : { label: data.label.trim() }),
          ...(data.sort === undefined ? {} : { sort: data.sort }),
          ...(data.status === undefined ? {} : { status: data.status }),
        },
        select: { id: true, value: true, label: true, status: true, sort: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') throw new NotFoundException('模型配置不存在。');
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('该模型标识已存在。');
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try { await this.prisma.searchModelConfig.delete({ where: { id } }); }
    catch (error) {
      if ((error as { code?: string }).code === 'P2025') throw new NotFoundException('模型配置不存在。');
      throw error;
    }
  }
  current(defaultModel: string) { return this.storage.getStore() || defaultModel; }
  async run<T>(value: string | undefined, work: () => Promise<T>) {
    const model = await this.resolve(value);
    if (value && !model) throw new BadRequestException('所选模型当前不可用，请刷新后重试。');
    return this.storage.run(model, work);
  }
}
