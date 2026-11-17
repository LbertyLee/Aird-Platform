import { SetMetadata } from '@nestjs/common';
import { SKIP_OPER_LOG_KEY } from '../constants/oper-log.constants';

/**
 * 标记接口跳过操作日志记录（如健康检查）。
 */
export const SkipOperLog = () => SetMetadata(SKIP_OPER_LOG_KEY, true);
