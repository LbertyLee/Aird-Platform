import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 可预期业务异常。
 */
export class BusinessException extends HttpException {
  /** 稳定错误码 */
  readonly code: string;

  /**
   * @param code 稳定错误码
   * @param message 面向客户端的说明
   * @param httpStatus HTTP 状态
   */
  constructor(
    code: string,
    message: string,
    httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ success: false, code, message }, httpStatus);
    this.code = code;
  }
}
