import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/**
 * 操作日志分页查询参数。
 */
export class OperLogPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '模块标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '操作人员' })
  @IsOptional()
  @IsString()
  operName?: string;

  @ApiPropertyOptional({ description: '业务类型（0其它 1新增 2修改 3删除）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  businessType?: number;

  @ApiPropertyOptional({
    description: '日志分类：login | export | delete',
    enum: ['login', 'export', 'delete'],
  })
  @IsOptional()
  @IsIn(['login', 'export', 'delete'])
  category?: 'login' | 'export' | 'delete';

  @ApiPropertyOptional({ description: '操作状态（0正常 1异常）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number;

  @ApiPropertyOptional({ description: '请求方式' })
  @IsOptional()
  @IsString()
  requestMethod?: string;

  @ApiPropertyOptional({ description: '开始时间（ISO）' })
  @IsOptional()
  @IsDateString()
  beginTime?: string;

  @ApiPropertyOptional({ description: '结束时间（ISO）' })
  @IsOptional()
  @IsDateString()
  endTime?: string;
}
