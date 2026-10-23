import { Module } from '@nestjs/common';
import { MachineEffectAdmissionService } from './machine-effect-admission.service';

@Module({
  providers: [MachineEffectAdmissionService],
  exports: [MachineEffectAdmissionService],
})
export class MachineEffectAdmissionModule {}
