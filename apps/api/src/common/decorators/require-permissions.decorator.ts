import { SetMetadata } from '@nestjs/common';

/** 权限码元数据键 */
export const PERMISSIONS_KEY = 'permissions';

/**
 * 声明接口所需权限码（Decorator 模式）。
 * @param codes 权限码列表，需全部具备
 */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);
