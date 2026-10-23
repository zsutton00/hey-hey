import { Module } from '@nestjs/common';
import { TypeSafeJevController } from '../../controllers/typesafe-jev.controller';
import { TypeSafeJevService } from './typesafe-jev.service';

@Module({
  controllers: [TypeSafeJevController],
  providers: [TypeSafeJevService],
  exports: [TypeSafeJevService],
})
export class TypeSafeJevModule {}
