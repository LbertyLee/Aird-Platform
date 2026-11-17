import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 上传人/用户简要信息 */
export class UploaderBriefDto {
  @ApiProperty({ description: '用户 ID' })
  id!: string;

  @ApiProperty({ description: '登录名' })
  username!: string;

  @ApiPropertyOptional({ description: '显示名', nullable: true })
  displayName?: string | null;
}

/** 通用成功响应 */
export class OkResponseDto {
  @ApiProperty({ description: '是否成功', example: true })
  ok!: boolean;
}

/** 批量操作结果 */
export class BatchOkCountDto {
  @ApiProperty({ description: '是否成功', example: true })
  ok!: boolean;

  @ApiProperty({ description: '处理/入队数量', example: 3 })
  count!: number;
}
