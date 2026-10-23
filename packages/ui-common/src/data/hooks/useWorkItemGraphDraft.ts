import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
} from "react";
import type {
  WorkItemChangeSetIdentity,
  WorkItemChangeSetLayoutEntry,
  WorkItemChangeSetPosition,
  WorkItemChangeSetRelationshipIdentity,
} from "../../api";
import {
  type ConnectWorkItemDraftInput,
  type CreateConnectedWorkItemDraftInput,
  type CreateWorkItemDraftInput,
  type HydratedWorkItemGraphInput,
  type ReconnectWorkItemDraftInput,
  type ReviseWorkItemDraftInput,
  type WorkItemGraphDraftAction,
  type WorkItemGraphDraftProjection,
  type WorkItemGraphDraftState,
  createWorkItemGraphDraftState,
  allocateTemporaryRelationshipIdentity,
  allocateTemporaryWorkItemIdentity,
  workItemGraphDraftReducer,
} from "../../components/shared/workItemGraphDraft";

type TemporaryWorkItemRef = Extract<
  WorkItemChangeSetIdentity,
  { refType: "temporary" }
>;
type TemporaryRelationshipRef = Extract<
  WorkItemChangeSetRelationshipIdentity,
  { refType: "temporary" }
>;

export interface UseWorkItemGraphDraftReturn {
  draft: WorkItemGraphDraftState;
  projected: WorkItemGraphDraftProjection;
  projectedGraph: WorkItemGraphDraftProjection;
  operations: WorkItemGraphDraftState["operations"];
  isDirty: boolean;
  move: (
    child: WorkItemChangeSetIdentity,
    position: WorkItemChangeSetPosition,
    displayedLayout?: readonly WorkItemChangeSetLayoutEntry[]
  ) => void;
  create: (input: CreateWorkItemDraftInput) => TemporaryWorkItemRef;
  createConnected: (input: CreateConnectedWorkItemDraftInput) => {
    child: TemporaryWorkItemRef;
    relationship: TemporaryRelationshipRef;
  };
  revise: (input: ReviseWorkItemDraftInput) => void;
  delete: (child: WorkItemChangeSetIdentity) => void;
  connect: (input: ConnectWorkItemDraftInput) => TemporaryRelationshipRef;
  reconnect: (input: ReconnectWorkItemDraftInput) => void;
  remove: (relationship: WorkItemChangeSetRelationshipIdentity) => void;
  reset: () => void;
  reflow: () => void;
  applyPreferredLayout: () => void;
  moveChild: UseWorkItemGraphDraftReturn["move"];
  createChild: UseWorkItemGraphDraftReturn["create"];
  reviseWorkItem: UseWorkItemGraphDraftReturn["revise"];
  deleteChild: UseWorkItemGraphDraftReturn["delete"];
  connectRelationship: UseWorkItemGraphDraftReturn["connect"];
  reconnectRelationship: UseWorkItemGraphDraftReturn["reconnect"];
  removeRelationship: UseWorkItemGraphDraftReturn["remove"];
}

function useDraftAction(
  dispatch: Dispatch<WorkItemGraphDraftAction>,
  action: WorkItemGraphDraftAction
): () => void {
  return useCallback(() => dispatch(action), [dispatch, action]);
}

export function useWorkItemGraphDraft(
  input: HydratedWorkItemGraphInput
): UseWorkItemGraphDraftReturn {
  const [draft, dispatch] = useReducer(
    workItemGraphDraftReducer,
    input,
    createWorkItemGraphDraftState
  );
  const inputRef = useRef(input);
  const reservedWorkItemRefs = useRef(new Set<string>());
  const reservedRelationshipRefs = useRef(new Set<string>());

  useEffect(() => {
    if (inputRef.current !== input) {
      inputRef.current = input;
      reservedWorkItemRefs.current.clear();
      reservedRelationshipRefs.current.clear();
      dispatch({ type: "hydrate", input });
    }
  }, [input]);

  const move = useCallback(
    (child: WorkItemChangeSetIdentity, position: WorkItemChangeSetPosition,
      displayedLayout?: readonly WorkItemChangeSetLayoutEntry[]) =>
      dispatch({ type: "move", child, position, displayedLayout }),
    []
  );
  const create = useCallback(
    (createInput: CreateWorkItemDraftInput): TemporaryWorkItemRef => {
      const occupiedWorkItemRefs = new Set(
        [draft.projection.projectedRoot, ...draft.projection.children].flatMap(
          (workItem) =>
            workItem.identity.refType === "temporary"
              ? [workItem.identity.tempId]
              : []
        )
      );
      reservedWorkItemRefs.current.forEach((tempId) =>
        occupiedWorkItemRefs.add(tempId)
      );
      const ref =
        createInput.ref ??
        allocateTemporaryWorkItemIdentity(
          draft.operations,
          occupiedWorkItemRefs
        );
      reservedWorkItemRefs.current.add(ref.tempId);
      dispatch({
        type: "create",
        input: createInput.ref ? createInput : { ...createInput, ref },
      });
      return ref;
    },
    [
      draft.operations,
      draft.projection.children,
      draft.projection.projectedRoot,
    ]
  );
  const createConnected = useCallback(
    (input: CreateConnectedWorkItemDraftInput) => {
      const occupiedWorkItemRefs = new Set(
        [draft.projection.projectedRoot, ...draft.projection.children].flatMap(
          (workItem) =>
            workItem.identity.refType === "temporary"
              ? [workItem.identity.tempId]
              : []
        )
      );
      reservedWorkItemRefs.current.forEach((tempId) =>
        occupiedWorkItemRefs.add(tempId)
      );
      const child =
        input.child.ref ??
        allocateTemporaryWorkItemIdentity(
          draft.operations,
          occupiedWorkItemRefs
        );

      const occupiedRelationshipRefs = new Set(
        draft.projection.incidentRelationships.flatMap((relationship) =>
          relationship.identity.refType === "temporary"
            ? [relationship.identity.tempId]
            : []
        )
      );
      reservedRelationshipRefs.current.forEach((tempId) =>
        occupiedRelationshipRefs.add(tempId)
      );
      const relationship =
        input.relationship.ref ??
        allocateTemporaryRelationshipIdentity(
          draft.operations,
          occupiedRelationshipRefs
        );

      reservedWorkItemRefs.current.add(child.tempId);
      reservedRelationshipRefs.current.add(relationship.tempId);
      dispatch({
        type: "createConnected",
        input: {
          child: { ...input.child, ref: child },
          relationship: { ...input.relationship, ref: relationship },
        },
      });
      return { child, relationship };
    },
    [
      draft.operations,
      draft.projection.children,
      draft.projection.incidentRelationships,
      draft.projection.projectedRoot,
    ]
  );
  const revise = useCallback(
    (reviseInput: ReviseWorkItemDraftInput) =>
      dispatch({ type: "revise", input: reviseInput }),
    []
  );
  const deleteWorkItem = useCallback(
    (child: WorkItemChangeSetIdentity) => dispatch({ type: "delete", child }),
    []
  );
  const connect = useCallback(
    (connectInput: ConnectWorkItemDraftInput): TemporaryRelationshipRef => {
      const occupiedRelationshipRefs = new Set(
        draft.projection.incidentRelationships.flatMap((relationship) =>
          relationship.identity.refType === "temporary"
            ? [relationship.identity.tempId]
            : []
        )
      );
      reservedRelationshipRefs.current.forEach((tempId) =>
        occupiedRelationshipRefs.add(tempId)
      );
      const ref =
        connectInput.ref ??
        allocateTemporaryRelationshipIdentity(
          draft.operations,
          occupiedRelationshipRefs
        );
      reservedRelationshipRefs.current.add(ref.tempId);
      dispatch({
        type: "connect",
        input: connectInput.ref ? connectInput : { ...connectInput, ref },
      });
      return ref;
    },
    [draft.operations, draft.projection.incidentRelationships]
  );
  const reconnect = useCallback(
    (reconnectInput: ReconnectWorkItemDraftInput) =>
      dispatch({ type: "reconnect", input: reconnectInput }),
    []
  );
  const remove = useCallback(
    (relationship: WorkItemChangeSetRelationshipIdentity) =>
      dispatch({ type: "remove", relationship }),
    []
  );
  const reset = useDraftAction(dispatch, { type: "reset" });
  const reflow = useDraftAction(dispatch, { type: "reflow" });
  const applyPreferredLayout = useDraftAction(dispatch, {
    type: "applyPreferredLayout",
  });

  return {
    draft,
    projected: draft.projection,
    projectedGraph: draft.projection,
    operations: draft.operations,
    isDirty: draft.isDirty,
    move,
    create,
    createConnected,
    revise,
    delete: deleteWorkItem,
    connect,
    reconnect,
    remove,
    reset,
    reflow,
    applyPreferredLayout,
    moveChild: move,
    createChild: create,
    reviseWorkItem: revise,
    deleteChild: deleteWorkItem,
    connectRelationship: connect,
    reconnectRelationship: reconnect,
    removeRelationship: remove,
  };
}
