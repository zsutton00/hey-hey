import type { ApolloClient, ObservableQuery } from "@apollo/client";
import { getGraphQLClients } from "./client";

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Whether an entity with this id appears anywhere in a read's result. */
export const holdsEntity = (value: unknown, id: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => holdsEntity(item, id));
  }
  if (!isObject(value)) {
    return false;
  }

  return (
    value.id === id ||
    Object.values(value).some((field) => holdsEntity(field, id))
  );
};

export const variableOf = (query: ObservableQuery, name: string): unknown =>
  isObject(query.variables) ? query.variables[name] : undefined;

/** Reads a view is showing now, in every project the client holds. */
export const activeReads = (client: ApolloClient, names: ReadonlySet<string>) =>
  [...getGraphQLClients(client)]
    .flatMap((project) => [...project.getObservableQueries("active")])
    .filter(
      (query) => query.queryName !== undefined && names.has(query.queryName),
    );
