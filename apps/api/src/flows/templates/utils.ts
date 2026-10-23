import {
  ContextTransform,
  FlowTemplate,
  FlowContext,
} from 'src/types/flow-internal.types';

// Helper function to create strongly-typed flow template
export function createFlow<T extends FlowContext>(
  flow: FlowTemplate<T>,
): FlowTemplate<T> {
  return flow;
}
