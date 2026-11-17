import { SetMetadata } from '@nestjs/common';

/** 公开接口元数据键 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记接口无需登录。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
