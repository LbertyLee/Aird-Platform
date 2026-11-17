import { SetMetadata } from '@nestjs/common';
import {
  OPER_LOG_BUSINESS_TYPE_KEY,
  OPER_LOG_TITLE_KEY,
} from '../constants/oper-log.constants';

/**
 * 覆盖操作日志模块标题。
 */
export const OperLogTitle = (title: string) =>
  SetMetadata(OPER_LOG_TITLE_KEY, title);

/**
 * 覆盖操作日志业务类型（0其它 1新增 2修改 3删除）。
 */
export const OperLogBusinessType = (businessType: number) =>
  SetMetadata(OPER_LOG_BUSINESS_TYPE_KEY, businessType);
