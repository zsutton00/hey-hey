import { useEffect } from "react";
import { useOptionalActionsCapsule } from "./ActionsCapsuleContext";
import type { CapsuleActionProps } from "./types";

const DEFAULT_TIER_ORDER = 0;

const resolveActionTier = (
  actionGroup: CapsuleActionProps["actionGroup"],
  tier: CapsuleActionProps["tier"]
): "site" | "page" | "tab" => {
  if (tier) {
    return tier;
  }

  return actionGroup === "page" ? "page" : "site";
};

/**
 * Registration component for ActionsCapsule actions.
 * Renders nothing in the DOM - only registers the action with ActionsCapsule.
 * The renderContent function will only be called when the user expands this action.
 *
 * For actions with menu items, the renderContent function receives the activeMenuItemId
 * via the ActionsCapsule context, allowing it to render different content based on selection.
 */
export const CapsuleAction: React.FC<CapsuleActionProps> = (props) => {
  const actionsCapsule = useOptionalActionsCapsule();
  const registerAction = actionsCapsule?.registerAction;
  const unregisterAction = actionsCapsule?.unregisterAction;
  const {
    id,
    label,
    icon,
    disabled,
    badge,
    resumable,
    inProgress,
    expandable,
    title,
    iconStyle,
    textColor,
    feedback,
    guidableTarget,
    actionGroup = "conceptual",
    tier,
    order = DEFAULT_TIER_ORDER,
    behavior,
  } = props;
  const resolvedTier = resolveActionTier(actionGroup, tier);
  const renderContent = behavior === "expand" ? props.renderContent : undefined;
  const menuItems = behavior === "expand" ? props.menuItems : undefined;
  const onClick = behavior === "click" ? props.onClick : undefined;

  // Register/update the action whenever props change
  useEffect(() => {
    if (!registerAction) {
      return;
    }
    const common = {
      id,
      label,
      icon,
      disabled: disabled ?? false,
      badge,
      resumable: resumable ?? false,
      inProgress: inProgress ?? false,
      expandable: expandable ?? false,
      title,
      iconStyle,
      textColor,
      feedback,
      guidableTarget,
      actionGroup,
      tier: resolvedTier,
      order,
    };

    if (behavior === "click") {
      registerAction({
        ...common,
        behavior: "click",
        onClick: onClick!,
      });
      return;
    }

    registerAction({
      ...common,
      behavior: "expand",
      renderContent: renderContent!,
      menuItems,
    });
  }, [
    id,
    label,
    icon,
    disabled,
    badge,
    resumable,
    inProgress,
    expandable,
    title,
    iconStyle,
    textColor,
    feedback,
    guidableTarget,
    actionGroup,
    resolvedTier,
    order,
    behavior,
    renderContent,
    menuItems,
    onClick,
    registerAction,
  ]);

  // Unregister only on true unmount
  useEffect(() => {
    return () => {
      if (unregisterAction) {
        unregisterAction(id);
      }
    };
  }, [unregisterAction, id]);

  // This component renders nothing in the DOM
  return null;
};
