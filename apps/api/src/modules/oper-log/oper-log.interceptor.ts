import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import {
  OPER_BUSINESS_DELETE,
  OPER_BUSINESS_OTHER,
  OPER_LOG_BUSINESS_TYPE_KEY,
  OPER_LOG_TITLE_KEY,
  OPER_STATUS_ERROR,
  OPER_STATUS_SUCCESS,
  SKIP_OPER_LOG_KEY,
} from '../../common/constants/oper-log.constants';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  buildOperParams,
  resolveBusinessTypeByMethod,
  resolveClientIp,
  resolveErrorMessage,
  resolveOperLocation,
  serializeOperLogPayload,
} from '../../common/utils/oper-log.util';
import { OperLogService } from './oper-log.service';

/** Swagger 元数据键（与 @nestjs/swagger 内部一致） */
const SWAGGER_API_OPERATION = 'swagger/apiOperation';
const SWAGGER_API_TAGS = 'swagger/apiTags';

/**
 * 全局操作日志拦截器：记录写操作与导出，跳过普通查询。
 */
@Injectable()
export class OperLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperLogInterceptor.name);

  /**
   * @param reflector 读取 handler 元数据
   * @param operLogService 操作日志服务
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly operLogService: OperLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_OPER_LOG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthUserContext }>();
    const requestMethod = (req.method ?? 'GET').toUpperCase();
    const operUrl = req.originalUrl ?? req.url ?? '';
    const path = operUrl.split('?')[0]?.toLowerCase() ?? '';

    // 普通查询（GET/HEAD/OPTIONS）不记日志；导出接口仍记录
    if (
      (requestMethod === 'GET' ||
        requestMethod === 'HEAD' ||
        requestMethod === 'OPTIONS') &&
      !path.includes('/export')
    ) {
      return next.handle();
    }

    const startedAt = Date.now();
    const handler = context.getHandler();
    const controller = context.getClass();
    const operIp = resolveClientIp(req);
    const operLocation = resolveOperLocation(operIp);
    const operParam = serializeOperLogPayload(buildOperParams(req));
    const method = `${controller.name}.${handler.name}`;
    const title = this.resolveTitle(context);
    const businessType = this.resolveBusinessType(
      context,
      requestMethod,
      operUrl,
    );

    const persist = (
      status: number,
      jsonResult: unknown,
      errorMsg = '',
      operNameOverride?: string,
    ) => {
      const operName =
        operNameOverride ??
        req.user?.username ??
        this.resolveOperNameFromRequest(req);
      void this.operLogService
        .create({
          title,
          businessType,
          method,
          requestMethod,
          operName,
          deptName: '',
          operUrl,
          operIp,
          operLocation,
          operParam,
          jsonResult: serializeOperLogPayload(jsonResult),
          status,
          errorMsg,
          costTime: Date.now() - startedAt,
        })
        .catch((error) => {
          this.logger.error(
            `写入操作日志失败: ${method} ${operUrl}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
    };

    return next.handle().pipe(
      tap((data) => {
        persist(
          OPER_STATUS_SUCCESS,
          data,
          '',
          this.resolveOperNameFromResponse(req, data),
        );
      }),
      catchError((error) => {
        persist(OPER_STATUS_ERROR, null, resolveErrorMessage(error));
        return throwError(() => error);
      }),
    );
  }

  private resolveTitle(context: ExecutionContext): string {
    const custom = this.reflector.getAllAndOverride<string>(OPER_LOG_TITLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (custom) return custom.slice(0, 50);

    const operation = this.reflector.get<{ summary?: string }>(
      SWAGGER_API_OPERATION,
      context.getHandler(),
    );
    const tags = this.reflector.get<string[]>(
      SWAGGER_API_TAGS,
      context.getClass(),
    );

    const tag = tags?.[0] ?? '';
    const summary = operation?.summary ?? '';
    const title = summary ? `${tag}${tag ? ' - ' : ''}${summary}` : tag;
    return (title || context.getClass().name.replace(/Controller$/, '')).slice(
      0,
      50,
    );
  }

  private resolveBusinessType(
    context: ExecutionContext,
    requestMethod: string,
    operUrl: string,
  ): number {
    const custom = this.reflector.getAllAndOverride<number>(
      OPER_LOG_BUSINESS_TYPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (custom !== undefined) return custom;

    const path = operUrl.split('?')[0]?.toLowerCase() ?? '';
    if (path.includes('/batch-delete') || path.endsWith('/delete')) {
      return OPER_BUSINESS_DELETE;
    }
    if (requestMethod === 'POST') {
      const otherPatterns = [
        '/search',
        '/login',
        '/logout',
        '/refresh',
        '/callback',
        '/report',
        '/approve',
        '/reject',
        '/reindex',
        '/rebuild',
        '/incremental',
        '/cleanup',
        '/auto-link',
        '/schedule',
        '/password',
      ];
      if (otherPatterns.some((pattern) => path.includes(pattern))) {
        return OPER_BUSINESS_OTHER;
      }
    }

    return resolveBusinessTypeByMethod(requestMethod);
  }

  private resolveOperNameFromRequest(req: Request): string {
    const body = req.body as { username?: unknown } | undefined;
    if (typeof body?.username === 'string' && body.username.trim()) {
      return body.username.trim().slice(0, 50);
    }
    return '';
  }

  private resolveOperNameFromResponse(
    req: Request & { user?: AuthUserContext },
    data: unknown,
  ): string | undefined {
    if (req.user?.username) return req.user.username;

    const payload = data as {
      profile?: { username?: string };
      username?: string;
    } | null;
    if (typeof payload?.profile?.username === 'string') {
      return payload.profile.username.slice(0, 50);
    }
    if (typeof payload?.username === 'string') {
      return payload.username.slice(0, 50);
    }
    return undefined;
  }
}
