import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

const USERNAME_PATTERN = /^[a-z0-9_.]{3,32}$/;

interface Credentials {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
}

function username(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USERNAME_PATTERN.test(name)) throw new BadRequestException('Tên đăng nhập 3-32 ký tự: chữ thường, số, _ hoặc .');
  return name;
}

function password(value: unknown): string {
  // Giới hạn trên để không ai gửi chuỗi cực dài làm nặng scrypt.
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new BadRequestException('Mật khẩu dài 8-128 ký tự');
  }
  return value;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  register(@Body() body: Credentials) {
    const name = username(body?.username);
    const display = typeof body?.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : name;
    if (display.length < 2 || display.length > 32) throw new BadRequestException('Tên hiển thị dài 2-32 ký tự');
    return this.auth.register(name, password(body?.password), display);
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body() body: Credentials) {
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string') {
      throw new BadRequestException('Thiếu username hoặc password');
    }
    return this.auth.login(body.username.trim().toLowerCase(), body.password.slice(0, 128));
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Headers('authorization') authorization?: string) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException('Thiếu Authorization: Bearer <token>');
    return this.auth.me(match[1]);
  }
}
