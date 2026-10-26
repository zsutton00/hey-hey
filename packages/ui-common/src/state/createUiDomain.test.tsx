import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createUiDomain } from "./createUiDomain";

const domain = () =>
  createUiDomain(() => createStore(() => ({ value: 0, other: 0 })));
const first = domain();
const second = domain();
const rendered = vi.fn();
function Value() {
  const value = first.useSelector((s) => s.value);
  useEffect(() => {
    rendered();
  });
  return <span>{value}</span>;
}
function Page() {
  const api = first.useApi();
  const other = second.useApi();
  return (
    <>
      <button onClick={() => api.setState({ value: 5 })}>Set</button>
      <button
        onClick={() => {
          api.setState({ other: 9 });
          other.setState({ value: 9 });
        }}
      >
        Unrelated
      </button>
    </>
  );
}
function App({ page }: { page: boolean }) {
  return (
    <first.Provider>
      <second.Provider>
        <Value />
        {page && <Page />}
      </second.Provider>
    </first.Provider>
  );
}
describe("application-owned UI domains", () => {
  it("preserves stores across page cleanup, isolates subscriptions and resets on app remount", () => {
    rendered.mockClear();
    const view = render(<App page />);
    fireEvent.click(screen.getByText("Unrelated"));
    expect(rendered).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Set"));
    expect(screen.getByText("5")).toBeInTheDocument();
    view.rerender(<App page={false} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    view.unmount();
    render(<App page />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
