import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { SkipOperLog } from './common/decorators/skip-oper-log.decorator';
import { AppService } from './app.service';

/**
 * 根控制器（健康探测用）。
 */
@Controller()
export class AppController {
  /**
   * @param appService 应用服务
   */
  constructor(private readonly appService: AppService) {}

  /**
   * 简易存活探测。
   */
  @Public()
  @SkipOperLog()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
