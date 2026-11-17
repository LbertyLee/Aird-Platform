import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CommonStatus, UserStatus } from '@prisma/client';
import { PASSWORD_HASHER } from '../../common/constants/injection-tokens';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { IPasswordHasher } from '../../domain/strategies/password-hasher';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LoginRequestDto, LoginResponseDto, RegisterRequestDto, TokenPairDto, PhoneAuthRequestDto, SendSmsCodeDto } from './dto/auth.dto';
import { SmsVerificationService, SmsScene } from './sms-verification.service';
import { TokenService } from './token.service';
import { SYSTEM_DICT_CODES } from '../dictionary/dictionary-type.constants';

/**
 * 认证应用服务。
 */
@Injectable()
export class AuthService {
  private readonly memoryUsers = new Map<string, { id: string; username: string; phone?: string; passwordHash: string; displayName: string }>();
  /**
   * @param prisma Prisma 客户端
   * @param passwordHasher 密码策略
   * @param tokenService 令牌签发与吊销
   * @param auditLogWriter 登录审计
   */
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: TokenService,
    private readonly auditLogWriter: AuditLogWriter,
    private readonly smsVerification: SmsVerificationService,
  ) {}

  /**
   * 校验状态与密码，签发令牌。
   */
  async login(dto: LoginRequestDto): Promise<LoginResponseDto> {
    if (process.env.STORAGE_FALLBACK_TO_MEMORY === 'true') {
      const user = [...this.memoryUsers.values()].find((item) => item.username === dto.username);
      if (!user || !(await this.passwordHasher.verify(dto.password, user.passwordHash))) throw new BusinessException('AUTH_INVALID', '用户名或密码错误', 401);
      const tokens = await this.tokenService.issueAccessAndRefresh(user.id, { username: user.username, roleIds: [] });
      return { ...tokens, permissionCodes: [], profile: { id: user.id, username: user.username, displayName: user.displayName } };
    }
    const user = await this.prisma.user.findFirst({
      where: { username: dto.username, deletedAt: null },
      include: { profile: true, userRoles: true },
    });
    if (!user) {
      throw new BusinessException('AUTH_INVALID', '用户名或密码错误', 401);
    }
    if (user.status !== UserStatus.active) {
      throw new BusinessException('AUTH_DISABLED', '账号未启用或已禁用', 403);
    }

    const ok = await this.passwordHasher.verify(dto.password, user.passwordHash);
    if (!ok) {
      throw new BusinessException('AUTH_INVALID', '用户名或密码错误', 401);
    }

    const roleIds = user.userRoles.map((r) => r.roleId);
    const permissionCodes = await this.resolvePermissionCodes(roleIds);
    const tokens = await this.tokenService.issueAccessAndRefresh(user.id, {
      username: user.username,
      roleIds,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      ...tokens,
      permissionCodes,
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.profile?.displayName ?? null,
      },
    };
  }

  async register(dto: RegisterRequestDto): Promise<LoginResponseDto> {
    await this.assertLegalDocumentsConfigured();
    const username = dto.username.trim();
    const phone = dto.phone?.trim();
    if (phone) {
      await this.smsVerification.verifyAndConsume(phone, dto.code ?? '');
    }
    if (process.env.STORAGE_FALLBACK_TO_MEMORY === 'true') {
      const exists = [...this.memoryUsers.values()].some((user) => user.username === username);
      if (exists) throw new BusinessException('USER_EXISTS', '用户名已存在', 409);
      const user = { id: randomUUID(), username, phone: dto.phone?.trim(), passwordHash: await this.passwordHasher.hash(dto.password), displayName: dto.displayName?.trim() || username };
      this.memoryUsers.set(user.id, user);
      const tokens = await this.tokenService.issueAccessAndRefresh(user.id, { username, roleIds: [] });
      return { ...tokens, permissionCodes: [], profile: { id: user.id, username, displayName: user.displayName } };
    }
    const exists = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException('USER_EXISTS', '用户名已存在', 409);
    }
    const role = await this.prisma.role.findFirst({
      where: { code: { in: ['researcher', 'regular_user'] }, deletedAt: null },
      orderBy: { code: 'asc' },
    });
    if (!role) {
      throw new BusinessException('ROLE_NOT_FOUND', '默认用户角色未配置', 500);
    }
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        username,
        phone: dto.phone?.trim() || undefined,
        email: dto.email,
        passwordHash,
        status: UserStatus.active,
        profile: { create: { displayName: dto.displayName?.trim() || username } },
        userRoles: { create: { roleId: role.id } },
      },
      include: { profile: true, userRoles: true },
    });
    const tokens = await this.tokenService.issueAccessAndRefresh(user.id, {
      username: user.username,
      roleIds: [role.id],
    });
    const permissionCodes = await this.resolvePermissionCodes([role.id]);
    await this.auditLogWriter.write({
      actorId: user.id,
      action: 'register',
      resourceType: 'user',
      resourceId: user.id,
    });
    return {
      ...tokens,
      permissionCodes,
      profile: { id: user.id, username: user.username, displayName: user.profile?.displayName ?? null },
    };
  }

  private async assertLegalDocumentsConfigured() {
    const rows = await this.prisma.dictionaryItem.findMany({
      where: {
        type: SYSTEM_DICT_CODES.legal_documents,
        status: CommonStatus.active,
        deletedAt: null,
      },
      select: { code: true, name: true },
    });
    const values = new Map(rows.map((row) => [row.code, row.name.trim()]));
    const required = [
      'user_agreement_content',
      'user_agreement_version',
      'user_agreement_updated_at',
      'user_agreement_effective_at',
      'privacy_policy_content',
      'privacy_policy_version',
      'privacy_policy_updated_at',
      'privacy_policy_effective_at',
    ];
    if (
      required.some((code) => {
        const value = values.get(code);
        return !value || value === '待配置';
      })
    ) {
      throw new BusinessException(
        'LEGAL_DOCUMENTS_NOT_CONFIGURED',
        '用户协议与隐私政策尚未配置完整，暂不能注册',
        503,
      );
    }
  }

  async sendSmsCode(dto: SendSmsCodeDto): Promise<{ ok: true }> {
    const phone = dto.phone.trim();
    const scene = dto.scene as SmsScene;
    if (scene === 'login') {
      const user = await this.prisma.user.findFirst({
        where: { phone, deletedAt: null },
      });
      if (!user) {
        throw new BusinessException(
          'AUTH_USER_NOT_FOUND',
          '手机号未注册，请先注册',
          404,
        );
      }
    } else if (scene === 'register') {
      const exists = await this.prisma.user.findFirst({
        where: { phone, deletedAt: null },
      });
      if (exists) {
        throw new BusinessException(
          'PHONE_EXISTS',
          '手机号已注册，请直接登录',
          409,
        );
      }
    }
    await this.smsVerification.sendCode(phone, scene);
    return { ok: true };
  }

  async phoneLogin(dto: PhoneAuthRequestDto): Promise<LoginResponseDto> {
    await this.smsVerification.verifyAndConsume(dto.phone, dto.code);
    const user = await this.prisma.user.findFirst({ where: { phone: dto.phone.trim(), deletedAt: null }, include: { profile: true, userRoles: true } });
    if (!user) throw new BusinessException('AUTH_USER_NOT_FOUND', '手机号未注册，请先注册', 404);
    if (user.status !== UserStatus.active) throw new BusinessException('AUTH_DISABLED', '账号未启用或已禁用', 403);
    const roleIds = user.userRoles.map((item) => item.roleId);
    const tokens = await this.tokenService.issueAccessAndRefresh(user.id, { username: user.username, roleIds });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...tokens, permissionCodes: await this.resolvePermissionCodes(roleIds), profile: { id: user.id, username: user.username, displayName: user.profile?.displayName ?? null } };
  }

  async phoneRegister(dto: PhoneAuthRequestDto): Promise<LoginResponseDto> {
    await this.assertLegalDocumentsConfigured();
    await this.smsVerification.verifyAndConsume(dto.phone, dto.code);
    const phone = dto.phone.trim();
    const exists = await this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (exists) throw new BusinessException('PHONE_EXISTS', '手机号已注册，请直接登录', 409);
    const role = await this.prisma.role.findFirst({ where: { code: { in: ['researcher', 'regular_user'] }, deletedAt: null }, orderBy: { code: 'asc' } });
    if (!role) throw new BusinessException('ROLE_NOT_FOUND', '默认用户角色未配置', 500);
    const passwordHash = await this.passwordHasher.hash(`${phone}:preview`);
    const user = await this.prisma.user.create({ data: { username: phone, phone, passwordHash, status: UserStatus.active, profile: { create: { displayName: dto.displayName?.trim() || phone } }, userRoles: { create: { roleId: role.id } } }, include: { profile: true } });
    const tokens = await this.tokenService.issueAccessAndRefresh(user.id, { username: user.username, roleIds: [role.id] });
    return { ...tokens, permissionCodes: await this.resolvePermissionCodes([role.id]), profile: { id: user.id, username: user.username, displayName: user.profile?.displayName ?? null } };
  }

  /**
   * 注销并失效刷新令牌。
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.tokenService.revokeRefresh(userId, refreshToken);
      return;
    }
    await this.tokenService.revokeUserSessions(userId);
  }

  /**
   * 校验刷新令牌并轮换。
   */
  async refresh(refreshToken: string): Promise<TokenPairDto> {
    const userId = await this.tokenService.resolveUserIdByRefresh(refreshToken);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: UserStatus.active },
      include: { userRoles: true },
    });
    if (!user) {
      throw new BusinessException('AUTH_USER_NOT_FOUND', '用户不存在或已禁用', 401);
    }
    const roleIds = user.userRoles.map((r) => r.roleId);
    return this.tokenService.rotateRefresh(refreshToken, {
      username: user.username,
      roleIds,
    });
  }

  /**
   * 聚合资料、角色、权限。
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        profile: true,
        userRoles: { include: { role: true } },
      },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }
    const roleIds = user.userRoles.map((r) => r.roleId);
    const permissionCodes = await this.resolvePermissionCodes(roleIds);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      displayName: user.profile?.displayName ?? null,
      roles: user.userRoles.map((r) => ({
        id: r.role.id,
        code: r.role.code,
        name: r.role.name,
      })),
      permissionCodes,
    };
  }

  /**
   * 更新当前用户基础资料。
   */
  async updateMyProfile(
    userId: string,
    dto: {
      displayName?: string;
      email?: string;
      phone?: string;
    },
  ) {
    const email =
      dto.email !== undefined ? dto.email.trim() || null : undefined;
    const phone =
      dto.phone !== undefined ? dto.phone.trim() || null : undefined;
    const displayName =
      dto.displayName !== undefined
        ? dto.displayName.trim() || null
        : undefined;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        profile: {
          upsert: {
            create: {
              displayName: displayName ?? null,
            },
            update: {
              ...(displayName !== undefined ? { displayName } : {}),
            },
          },
        },
      },
    });
    await this.auditLogWriter.write({
      actorId: userId,
      action: 'update_profile',
      resourceType: 'user',
      resourceId: userId,
    });
    return this.getProfile(userId);
  }

  /**
   * 修改当前用户密码（需校验旧密码）。
   */
  async changeMyPassword(
    userId: string,
    dto: { oldPassword: string; newPassword: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }
    const ok = await this.passwordHasher.verify(
      dto.oldPassword,
      user.passwordHash,
    );
    if (!ok) {
      throw new BusinessException('AUTH_INVALID', '当前密码不正确', 400);
    }
    if (dto.oldPassword === dto.newPassword) {
      throw new BusinessException(
        'PASSWORD_SAME',
        '新密码不能与当前密码相同',
        400,
      );
    }
    const passwordHash = await this.passwordHasher.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.tokenService.revokeUserSessions(userId);
    await this.auditLogWriter.write({
      actorId: userId,
      action: 'change_password',
      resourceType: 'user',
      resourceId: userId,
    });
    return { ok: true };
  }

  /**
   * 解析角色对应的权限码集合。
   * 平台管理员始终拥有全部权限（不受角色权限表裁剪影响）。
   */
  async resolvePermissionCodes(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];

    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds }, deletedAt: null },
      select: { code: true },
    });
    if (roles.some((role) => role.code === 'platform_admin')) {
      const all = await this.prisma.permission.findMany({
        where: { deletedAt: null },
        select: { code: true },
      });
      return all.map((row) => row.code);
    }

    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      include: { permission: true },
    });
    return [...new Set(rows.map((r) => r.permission.code))];
  }
}
