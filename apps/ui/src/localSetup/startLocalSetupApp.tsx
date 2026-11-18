import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { LocalSetupApp } from "./LocalSetupApp";

export function startLocalSetupApp(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <LocalSetupApp />
    </StrictMode>,
  );
}
