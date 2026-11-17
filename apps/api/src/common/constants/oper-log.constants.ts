/** 跳过操作日志记录的元数据键 */
export const SKIP_OPER_LOG_KEY = 'skip_oper_log';

/** 操作日志标题覆盖元数据键 */
export const OPER_LOG_TITLE_KEY = 'oper_log_title';

/** 操作日志业务类型覆盖元数据键 */
export const OPER_LOG_BUSINESS_TYPE_KEY = 'oper_log_business_type';

/** 业务类型：其它 */
export const OPER_BUSINESS_OTHER = 0;
/** 业务类型：新增 */
export const OPER_BUSINESS_INSERT = 1;
/** 业务类型：修改 */
export const OPER_BUSINESS_UPDATE = 2;
/** 业务类型：删除 */
export const OPER_BUSINESS_DELETE = 3;

/** 操作状态：正常 */
export const OPER_STATUS_SUCCESS = 0;
/** 操作状态：异常 */
export const OPER_STATUS_ERROR = 1;

/** 请求/响应参数最大长度 */
export const OPER_LOG_MAX_TEXT = 4000;

/** 需脱敏的字段名（小写匹配） */
export const OPER_LOG_SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'passwordhash',
  'refreshtoken',
  'accesstoken',
  'token',
  'secret',
  'authorization',
]);
