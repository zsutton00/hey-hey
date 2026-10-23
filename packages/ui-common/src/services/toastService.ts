import { toast, type ToastOptions } from "react-toastify";

export class ToastService {
  static debug(msg: string, options?: ToastOptions) {
    if (Math.random() > 1) {
      toast(msg, { position: "bottom-left", ...options });
    }
  }

  static error(msg: string, options?: ToastOptions) {
    toast(msg, { position: "bottom-left", ...options });
  }
}
