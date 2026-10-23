/**
 * ActionsCapsule - Persistent bottom bar for task search and page-contextual actions
 *
 * @example
 * ```tsx
 * // In your Layout component:
 * import { ActionsCapsuleProvider, ActionsCapsule } from 'src/components/ActionsCapsule';
 *
 * export const Layout = () => (
 *   <ActionsCapsuleProvider>
 *     <Box sx={{ pb: 8 }}>
 *       <Header />
 *       <Outlet />
 *     </Box>
 *     <ActionsCapsule />
 *   </ActionsCapsuleProvider>
 * );
 *
 * // In your page components:
 * import { CapsuleAction } from 'src/components/ActionsCapsule';
 *
 * export const AdrEditor = () => {
 *   // Use useCallback to keep reference stable
 *   const renderContent = useCallback(() => <CreateActionsWorkflow />, []);
 *
 *   return (
 *     <>
 *       <div>Page content...</div>
 *       <CapsuleAction
 *         id="create-tasks"
 *         label="Create Actions"
 *         icon={<ActionsIcon />}
 *         behavior="expand"
 *         renderContent={renderContent}
 *       />
 *     </>
 *   );
 * };
 * ```
 */

export { ActionsCapsule } from "./ActionsCapsule";
export { ActionsCapsuleProvider } from "./ActionsCapsuleProvider";
export {
  useActionsCapsule,
  useOptionalActionsCapsule,
} from "./ActionsCapsuleContext";
export { CapsuleAction } from "./CapsuleAction";
export { ActionFeedbackSurface } from "./ActionFeedbackSurface";
export type { ActionFeedbackSurfaceProps } from "./ActionFeedbackSurface";
export { CodeReviewIcon } from "./CodeReviewIcon";
export { ContextIcon } from "./ContextIcon";
export { CapsuleMenuItemsList } from "./CapsuleMenuItemsList";
export type { CapsuleMenuItemsListProps } from "./CapsuleMenuItemsList";
export { buttonColors, discussColor } from "./capsuleActionButtonColors";
export type {
  CapsuleActionProps,
  CapsuleActionRegistration,
  CapsuleActionGroup,
  CapsuleActionTier,
  CapsuleActionMenuItem,
  CapsuleActionUnavailableFeedback,
  ActionsCapsuleContextValue,
} from "./types";

// Common utilities for CapsuleActions
export * from "./Common";
export * from "./useSiteChat";
