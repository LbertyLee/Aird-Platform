import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OPER_BUSINESS_OTHER } from '../../common/constants/oper-log.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OperLogBusinessType } from '../../common/decorators/oper-log-meta.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { OkResponseDto } from '../../common/dto/swagger.dto';
import { AuthService } from './auth.service';
import {
  AuthMeResponseDto,
  ChangeMyPasswordDto,
  LoginRequestDto,
  LoginResponseDto,
  RegisterRequestDto,
  PhoneAuthRequestDto,
  SendSmsCodeDto,
  RefreshRequestDto,
  TokenPairDto,
  UpdateMyProfileDto,
} from './dto/auth.dto';

/**
 * 管理端认证 HTTP 入口。
 */
@ApiTags('管理端-认证')
@Controller('admin/auth')
export class AuthController {
  /**
   * @param authService 认证服务
   */
  constructor(private readonly authService: AuthService) {}

  /**
   * 账号密码登录，返回令牌与权限码。
   */
  @Public()
  @OperLogBusinessType(OPER_BUSINESS_OTHER)
  @Post('login')
  @ApiOperation({ summary: '管理端登录' })
  @ApiOkResponse({ type: LoginResponseDto, description: '登录成功，返回令牌与权限' })
  login(@Body() dto: LoginRequestDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: '用户端注册' })
  @ApiOkResponse({ type: LoginResponseDto, description: '注册成功并返回登录令牌' })
  register(@Body() dto: RegisterRequestDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('sms/send-code')
  @ApiOperation({ summary: '发送手机验证码' })
  sendSmsCode(@Body() dto: SendSmsCodeDto) {
    return this.authService.sendSmsCode(dto);
  }

  @Public()
  @Post('phone-login')
  @ApiOperation({ summary: '手机号验证码登录' })
  phoneLogin(@Body() dto: PhoneAuthRequestDto) {
    return this.authService.phoneLogin(dto);
  }

  @Public()
  @Post('phone-register')
  @ApiOperation({ summary: '手机号验证码注册' })
  phoneRegister(@Body() dto: PhoneAuthRequestDto) {
    return this.authService.phoneRegister(dto);
  }

  /**
   * 注销并失效刷新令牌。
   */
  @ApiBearerAuth()
  @OperLogBusinessType(OPER_BUSINESS_OTHER)
  @Post('logout')
  @ApiOperation({ summary: '退出登录' })
  @ApiOkResponse({ type: OkResponseDto, description: '退出成功' })
  logout(
    @CurrentUser() user: AuthUserContext,
    @Body() body: RefreshRequestDto,
  ) {
    return this.authService.logout(user.userId, body.refreshToken);
  }

  /**
   * 刷新访问令牌。
   */
  @Public()
  @OperLogBusinessType(OPER_BUSINESS_OTHER)
  @Post('refresh')
  @ApiOperation({ summary: '刷新令牌' })
  @ApiOkResponse({ type: TokenPairDto, description: '新的访问/刷新令牌' })
  refresh(@Body() dto: RefreshRequestDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * 当前用户资料与权限。
   */
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '当前用户信息' })
  @ApiOkResponse({ type: AuthMeResponseDto, description: '当前登录用户资料与权限' })
  me(@CurrentUser() user: AuthUserContext) {
    return this.authService.getProfile(user.userId);
  }

  /**
   * 更新当前用户资料。
   */
  @ApiBearerAuth()
  @Put('me')
  @ApiOperation({ summary: '更新当前用户资料' })
  @ApiOkResponse({ type: AuthMeResponseDto, description: '更新后的用户资料' })
  updateMe(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.authService.updateMyProfile(user.userId, dto);
  }

  /**
   * 修改当前用户密码。
   */
  @ApiBearerAuth()
  @Post('me/password')
  @ApiOperation({ summary: '修改当前用户密码' })
  @ApiOkResponse({ type: OkResponseDto, description: '修改成功' })
  changePassword(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: ChangeMyPasswordDto,
  ) {
    return this.authService.changeMyPassword(user.userId, dto);
  }
}
