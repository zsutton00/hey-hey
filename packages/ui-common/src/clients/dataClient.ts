import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { captureRequestOptions } from "../data/core/requestInitiator";
import { getApiRuntime } from "./runtimeRegistry";

export interface DataClient {
  request<T = unknown, R = AxiosResponse<T>>(
    config: AxiosRequestConfig,
  ): Promise<R>;
}

export const dataClient: DataClient = {
  request: <T = unknown, R = AxiosResponse<T>>(config: AxiosRequestConfig) => {
    return getApiRuntime().transport.request<T, R>({
      ...captureRequestOptions(),
      ...config,
    });
  },
};
