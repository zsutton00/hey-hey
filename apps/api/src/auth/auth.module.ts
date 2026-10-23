import { Module } from '@nestjs/common';
import { ProjectAccessModule } from './project-access.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminGuard } from './guards/admin.guard';
import { AuthService } from './services/auth.service';
import { JwtKeysService } from './services/jwt-keys.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { CoreDomainModule } from '../domain/core-domain.module';
import { UserAccessTokenValidatorService } from './services/user-access-token-validator.service';
import { BrowserSessionService } from './services/browser-session.service';
import { PasswordChangeCredentialService } from './services/password-change-credential.service';
import { PASSWORD_CHANGE_CREDENTIAL_ISSUER } from './password-change-credential.types';
import { DemoSandboxActivityModule } from '../services/demo-sandbox/demo-sandbox-activity.module';
import { PasswordRecoveryThrottleService } from './services/password-recovery-throttle.service';

@Module({
  imports: [
    ProjectAccessModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: '24h',
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    CoreDomainModule,
    DemoSandboxActivityModule,
  ],
  providers: [
    AdminGuard,
    AuthService,
    BrowserSessionService,
    PasswordChangeCredentialService,
    PasswordRecoveryThrottleService,
    {
      provide: PASSWORD_CHANGE_CREDENTIAL_ISSUER,
      useExisting: PasswordChangeCredentialService,
    },
    JwtKeysService,
    UserAccessTokenValidatorService,
    JwtStrategy,
    ApiKeyStrategy,
  ],
  exports: [
    AdminGuard,
    AuthService,
    BrowserSessionService,
    PasswordChangeCredentialService,
    PASSWORD_CHANGE_CREDENTIAL_ISSUER,
    JwtKeysService,
    UserAccessTokenValidatorService,
    JwtStrategy,
    ApiKeyStrategy,
  ],
})
export class AuthModule {}
