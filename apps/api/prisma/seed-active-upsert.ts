/**
 * Soft-delete 表去掉 Prisma @unique 后，seed 用 findFirst + update/create 代替 upsert。
 */
export async function upsertByFinder<T extends { id: string }>(
  find: () => Promise<T | null>,
  update: (id: string) => Promise<T>,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await find();
  return existing ? update(existing.id) : create();
}
