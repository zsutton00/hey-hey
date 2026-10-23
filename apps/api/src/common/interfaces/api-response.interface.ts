export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  timestamp: string;
  statusCode: number;
  path?: string;
}
