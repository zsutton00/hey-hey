import { Configuration, MachinesApi } from '../shared/api/index';
import type {
  ConfirmMachineEnrollmentRequestDto,
  ConfirmMachineEnrollmentResponseDto,
  CreateMachineEnrollment201Response,
  CreateMachineEnrollmentRequestDto,
  PollMachineEnrollmentRequestDto,
  PollMachineEnrollmentResponseDto,
} from '../shared/api/index';
import { type MachineEnrollmentConfirmationClient } from './machine-enrollment-confirmation';

interface MachineEnrollmentCreationClient {
  createMachineEnrollment(
    dto: CreateMachineEnrollmentRequestDto,
  ): Promise<{ data: CreateMachineEnrollment201Response }>;
}

export type MachineEnrollmentClient = MachineEnrollmentCreationClient &
  MachineEnrollmentConfirmationClient;

const resolveApiBaseUrl = (): string => {
  const raw = process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev';
  return raw.endsWith('/api/v1') ? raw : `${raw.replace(/\/$/u, '')}/api/v1`;
};

/** Generated create, poll, and confirm operations for the version-2 enrollment boundary. */
export const createDefaultMachineEnrollmentClient = (): MachineEnrollmentClient => {
  const api = new MachinesApi(new Configuration({ basePath: resolveApiBaseUrl() }));

  return {
    createMachineEnrollment: (dto) =>
      api.createMachineEnrollment({ createMachineEnrollmentRequestDto: dto }),
    pollMachineEnrollment: async (
      enrollmentId: string,
      deviceSecret: string,
    ): Promise<PollMachineEnrollmentResponseDto> => {
      const request: PollMachineEnrollmentRequestDto = { deviceSecret };
      const response = await api.pollMachineEnrollment({
        enrollmentId,
        pollMachineEnrollmentRequestDto: request,
      });
      return response.data.data;
    },
    confirmMachineEnrollment: async (
      request: ConfirmMachineEnrollmentRequestDto,
    ): Promise<ConfirmMachineEnrollmentResponseDto> => {
      const response = await api.confirmMachineEnrollment({
        enrollmentId: request.confirmation.enrollmentId,
        confirmMachineEnrollmentRequestDto: request,
      });
      return response.data.data;
    },
  };
};
