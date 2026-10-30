import { useEffect, useState } from "react";
import type { ServiceRepoBinding } from "../../../api";
import {
  createDirectoryBindingApi,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../../AgentSession/runtime/directoryBindingApi";
import type { SourceReference } from "../../EditorPreference";
import { resolveFileReferenceSource } from "./fileReferenceOpening";
import type { FileReferenceValueV1 } from "./types";

type BindingsByServiceId = Readonly<Record<string, ServiceRepoBinding>>;

let inFlightBindings: Promise<BindingsByServiceId> | null = null;

// Lists render many references at once; share one request per burst while
// still re-reading the CLI each time so remapped services are picked up.
const loadBindingsByServiceId = (): Promise<BindingsByServiceId> => {
  if (inFlightBindings) {
    return inFlightBindings;
  }

  const request = createDirectoryBindingApi(
    resolveLocalDirectoryRuntimeBaseUrl(),
  )
    .listRepos()
    .then(({ bindings }) =>
      Object.fromEntries(
        bindings.map((binding) => [binding.serviceId, binding]),
      ),
    )
    .finally(() => {
      inFlightBindings = null;
    });
  inFlightBindings = request;

  return request;
};

export const useFileReferenceSource = (
  value: FileReferenceValueV1,
): SourceReference | null => {
  const [source, setSource] = useState<SourceReference | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);

    // An unreachable local CLI means the file cannot be opened here.
    void loadBindingsByServiceId()
      .then((bindings) => {
        if (!cancelled) {
          setSource(resolveFileReferenceSource(value, bindings));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [value.serviceId, value.normalizedPath]);

  return source;
};
