import type {
  AgentRequestPermissionPayload,
  SystemMessageData,
  UIElement,
} from '../../shared/api/index';

const PERMISSION_UI_ELEMENT_PREFIX = 'agent-request-permission:';

/** Rewrites the permission payload inside a card message's UI element. */
export const updateCardPayload = (
  data: SystemMessageData,
  update: (payload: AgentRequestPermissionPayload) => AgentRequestPermissionPayload,
): SystemMessageData => {
  const uiElements: UIElement[] | undefined = data.uiElements?.map((el) => {
    if (typeof el.id !== 'string' || !el.id.startsWith(PERMISSION_UI_ELEMENT_PREFIX)) {
      return el;
    }
    const existing = el.payload as AgentRequestPermissionPayload | undefined;
    if (!existing) {
      return el;
    }

    return { ...el, payload: update(existing) } as UIElement;
  });

  return { ...data, ...(uiElements !== undefined ? { uiElements } : {}) };
};
