Complete Plan: Option 1 - Extend useInitiatives Hook with conversationId

Overview

Extend the existing useInitiatives hook to accept an optional conversationId parameter, allowing it to fetch either organization/project initiatives or  
 conversation-specific initiatives using the same Jotai collection infrastructure.

Detailed Implementation Plan

Step 1: Extend Initiative Collection to Support Conversation Queries

File: /src/data/collections/initiatives.ts

Modify the fetcher function (lines 8-42) to handle conversation query keys:

// Current patterns:  
 // - "initiative:orgId:initiativeId" (single)  
 // - "initiatives:orgId" (org list)  
 // - "initiatives:orgId:projectId" (project list)  
 // NEW pattern:  
 // - "initiatives:orgId:projectId:conversation:conversationId" (conversation list)

export const initiativeCollection = createCollection<InitiativeResponseDto>({  
 name: "initiatives",  
 fetcher: async (queryKey: string): Promise<FetcherResponse<InitiativeResponseDto>> => {  
 if (queryKey.startsWith("initiative:")) {  
 // Existing single initiative logic - no changes  
 const [, orgId, initiativeId] = queryKey.split(":");  
 const response = await platformClient.getInitiative(orgId, initiativeId);  
 return {  
 data: response.data.data,  
 isArray: false,  
 };  
 } else if (queryKey.includes(":conversation:")) {  
 // NEW: Handle conversation initiatives  
 // Parse: "initiatives:orgId:projectId:conversation:conversationId"  
 const parts = queryKey.split(":");  
 if (parts.length !== 5 || parts[0] !== "initiatives" || parts[3] !== "conversation") {  
 throw new Error(`Invalid conversation query key format: ${queryKey}`);  
 }

        const [, orgId, projectId, , conversationId] = parts;
        const response = await conversationsClient.getConversationInitiatives(
          orgId,
          projectId,
          conversationId
        );
        return {
          data: response.data.data,
          isArray: true,
        };
      } else if (queryKey.startsWith("initiatives:")) {
        // Existing organization/project initiatives logic - no changes
        const parts = queryKey.split(":");
        const orgId = parts[1];
        const projectId = parts[2]; // Optional

        const response = await platformClient.getOrganizationInitiatives(
          orgId,
          projectId
        );
        return {
          data: response.data.data,
          isArray: true,
        };
      }

      throw new Error(`Unknown query key pattern: ${queryKey}`);
    },
    // ... rest unchanged

});

Add conversationsClient import at top:  
 import { platformClient, conversationsClient } from "../../clients/serviceClients";

Step 2: Extend useInitiatives Hook Interface and Parameters

File: /src/data/hooks/useInitiatives.ts

Update the hook signature and interface:

// Update the hook function signature (line 43):  
 export function useInitiatives(  
 organizationId: string,  
 projectId?: string,  
 conversationId?: string, // NEW parameter  
 options: CollectionHookOptions<InitiativeResponseDto> = {}  
 ): UseInitiativesReturn {

    // Update query key generation logic (lines 48-50):
    const queryKey = conversationId
      ? `initiatives:${organizationId}:${projectId}:conversation:${conversationId}`
      : projectId
      ? `initiatives:${organizationId}:${projectId}`
      : `initiatives:${organizationId}`;

    // Rest of the hook implementation remains the same
    // The existing logic for state management, create, update, remove all work unchanged
    // because they all operate on the same collection infrastructure

}

Update the enabled condition (line 60):  
 enabled: options.enabled !== false && !!organizationId &&  
 (conversationId ? !!projectId && !!conversationId : true),

Update WebSocket subscriptions (lines 245-253):  
 useWebsocketSubscriptions(  
 {  
 projectIds: projectId ? [projectId] : [],  
 initiativeIds: data ? data.map((i) => i.id) : [],  
 conversationIds: conversationId ? [conversationId] : [], // NEW  
 },  
 {  
 enabled: options.enabled ?? true,  
 }  
 );

Step 3: Replace useConversationInitiatives Usage

File: /src/data/hooks/useInitiativeRefinementData.tsx

Remove the entire useConversationInitiatives function and related interfaces (lines 207-283):

- Remove UseConversationInitiativesParams interface
- Remove UseConversationInitiativesReturn interface
- Remove useConversationInitiatives function
- Remove conversationsClient import  


Update the main hook implementation:

// Replace the conversation initiatives section with:  
 const {  
 initiatives: conversationInitiatives,  
 isLoading: isConversationInitiativesLoading,  
 error: conversationInitiativesError,  
 refetch: refetchConversationInitiatives,  
 } = useInitiatives(  
 organizationId,  
 projectId,  
 refinementData?.conversationId, // Pass conversationId as 3rd parameter  
 { enabled: !!refinementData?.conversationId }  
 );

// Update the return object:  
 return {  
 // ... existing project and initiative fields unchanged

    // Replace conversation data section:
    conversationInitiatives,
    isConversationInitiativesLoading,
    conversationInitiativesError,
    refetchConversationInitiatives,

    // Update computed states:
    isLoading:
      isProjectLoading ||
      isInitiativeLoading ||
      isStartingRefinementRef.current ||
      isConversationLoading ||
      isConversationInitiativesLoading,

    hasError: !!(
      projectError ||
      initiativeError ||
      refinementError ||
      conversationError ||
      conversationInitiativesError
    ),

};

Update the interface definition:  
 export interface UseInitiativeRefinementDataReturn {  
 // ... existing fields

    // Update conversation initiatives fields:
    conversationInitiatives: InitiativeResponseDto[];
    isConversationInitiativesLoading: boolean;
    conversationInitiativesError: Error | null;
    refetchConversationInitiatives: () => Promise<InitiativeResponseDto[] | null>;

    // ... rest unchanged

}

Step 4: Update Component Usage

File: /src/components/LlmForms/Registry/initiatives/InitiativeField.tsx

Update hook extraction to use new field names:

const {  
 // ... existing fields  
 conversationInitiatives,  
 refetchConversationInitiatives,  
 // ... rest of fields  
 } = useInitiativeRefinementData({  
 organizationId,  
 projectId,  
 initiativeId,  
 });

// Update component props:  
 <Initiatives  
 initiatives={conversationInitiatives} // Updated field name  
 organizationId={organizationId}  
 projectId={projectId}  
 onInitiativeReject={handleInitiativeReject}  
 onDataRefresh={refetchConversationInitiatives} // Updated callback  
 onInitiativeCreated={refetchConversationInitiatives} // Updated callback  
 />

Step 5: Update useInitiativeField Hook

File: /src/components/LlmForms/Registry/initiatives/useInitiativeField.ts

The hook should now receive the conversation-scoped initiatives and the same refetch callback:

// The handleInitiativeReject function will now properly work because:  
 // 1. It uses useInitiatives.remove() which operates on the collection  
 // 2. The conversation query uses the same collection  
 // 3. DELETE_ITEM action will invalidate all queryKeys including conversation ones  
 // 4. The onDataRefresh callback will be the same refetch function

// No changes needed to the reject logic - it should work automatically

Step 6: Verify Cache Invalidation Works

Key Points to Test:

1. Cross-Query Invalidation: When remove() is called from any query scope, it should invalidate ALL queries that contain that initiative:


    - initiatives:orgId
    - initiatives:orgId:projectId
    - initiatives:orgId:projectId:conversation:conversationId

2. Query Key Tracking: Each initiative item should track all queryKeys that fetched it, including conversation-specific ones
3. WebSocket Integration: Real-time updates should work across all query scopes  


The existing DELETE_ITEM action in createCollection.ts should handle this automatically by:

- Finding the item to delete
- Looking up item.queryKeys array
- Marking all those queryKeys as stale
- Removing the item from the collection  


Step 7: Backward Compatibility

Ensure existing usage continues to work:

// These existing calls should continue to work unchanged:  
 useInitiatives(orgId) // Organization initiatives  
 useInitiatives(orgId, projectId) // Project initiatives

// New usage:  
 useInitiatives(orgId, projectId, conversationId) // Conversation initiatives

Benefits of This Approach

- ✅ Single Source of Truth: One hook for all initiative queries
- ✅ Consistent API: Same interface for create/update/delete across all scopes
- ✅ Automatic Cache Invalidation: DELETE_ITEM handles all queryKey invalidation
- ✅ Backward Compatible: Existing usage unchanged
- ✅ Type Safety: Full TypeScript support with parameter validation
- ✅ WebSocket Integration: Real-time updates work across all query types
- ✅ Maintainability: Single hook to maintain instead of multiple  


Files to Modify

1. EXTEND: /src/data/collections/initiatives.ts - Add conversation query pattern and conversationsClient import
2. EXTEND: /src/data/hooks/useInitiatives.ts - Add conversationId parameter and query key logic
3. REPLACE: /src/data/hooks/useInitiativeRefinementData.tsx - Remove useConversationInitiatives, use extended useInitiatives
4. UPDATE: /src/components/LlmForms/Registry/initiatives/InitiativeField.tsx - Update field names and callbacks  


Testing Verification

1. Organization initiatives: useInitiatives(orgId) works unchanged
2. Project initiatives: useInitiatives(orgId, projectId) works unchanged
3. Conversation initiatives: useInitiatives(orgId, projectId, conversationId) fetches conversation-specific data
4. Cross-invalidation: Deleting an initiative updates all query scopes that contain it
5. Real-time updates: WebSocket events update all relevant queries  


This approach provides a unified, maintainable solution that solves the cache coherency issue while maintaining backward compatibility.
