const nextLayout = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
function element(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing fixture element: ${selector}`);
  return result;
}
function visibleLine(owner: HTMLElement): HTMLElement {
  const top = owner.getBoundingClientRect().top;
  const line = Array.from(owner.querySelectorAll<HTMLElement>("p")).find(
    (candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.top > top + 50 && rect.bottom < top + owner.clientHeight;
    }
  );
  if (!line) throw new Error("No reading line in fixture viewport");
  return line;
}
async function checkChanges(owner: HTMLElement) {
  element("#approve").click();
  owner.scrollTop = 2200;
  await nextLayout();
  const line = visibleLine(owner);
  const before = line.getBoundingClientRect().top;
  const drift: Record<string, number> = {};
  for (const operation of ["hydrate", "prepend", "approve"]) {
    element(`#${operation}`).click();
    await nextLayout();
    drift[operation] = line.getBoundingClientRect().top - before;
  }
  return drift;
}
async function checkSimulatedMomentum(owner: HTMLElement) {
  element("#approve").click();
  owner.scrollTop = 2200;
  await nextLayout();
  const line = visibleLine(owner);
  const before = line.getBoundingClientRect().top;
  let intended = 0;
  let maxDrift = 0;
  for (let index = 0; index < 10; index++) {
    const delta = Math.max(2, 24 - index * 2);
    owner.scrollTop -= delta;
    intended += delta;
    if (index === 3) element("#hydrate").click();
    await nextLayout();
    maxDrift = Math.max(
      maxDrift,
      Math.abs(line.getBoundingClientRect().top - before - intended)
    );
  }
  return maxDrift;
}
/** A shared-hook fixture, not an authenticated-page or physical-trackpad test. */
export async function runNativeScrollChecks() {
  const owner = element("#owner");
  if (owner.dataset.ready !== "true")
    throw new Error("Initial reveal is still pending");
  const changes = await checkChanges(owner);
  const simulatedMomentumMaxDrift = await checkSimulatedMomentum(owner);
  const maxDrift = Math.max(
    ...Object.values(changes).map(Math.abs),
    simulatedMomentumMaxDrift
  );
  const result = { passed: maxDrift <= 1, changes, simulatedMomentumMaxDrift };
  if (!result.passed)
    throw new Error(`Native anchoring failed: ${JSON.stringify(result)}`);
  return result;
}
