import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { runNativeScrollChecks } from "./conversation-scroll-checks";
import { useConversationScrolling } from "../../src/components/Conversation/hooks/useConversationScrolling";
import type { ConversationMessage } from "../../src/types/conversation";
import { MessageStatus, MessageType } from "../../src/api";

const message = (id: string): ConversationMessage => ({
  message: {
    id,
    conversationId: "browser-conversation",
    projectId: "browser-project",
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: { type: "QUESTIONS" },
    createdAt: "2026-10-01T00:00:00Z",
    awaitingResponse: false,
    responses: [],
  },
  state: "completed",
  canEdit: false,
});

function ScrollFixture() {
  const ownerRef = useRef<HTMLElement | null>(null);
  const [ids, setIds] = useState(
    Array.from({ length: 12 }, (_, index) => String(index))
  );
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState("");
  const { initialScrollReady } = useConversationScrolling({
    scrollPolicy: { mode: "owned", ownerRef },
    conversationTimeline: ids.map(message),
    conversationId: "browser-conversation",
  });
  return (
    <>
      <button id="hydrate" onClick={() => flushSync(() => setExpanded(true))}>
        Hydrate above viewport
      </button>
      <button id="approve" onClick={() => flushSync(() => setExpanded(false))}>
        Shrink approved content
      </button>
      <button
        id="prepend"
        onClick={() =>
          flushSync(() =>
            setIds((previous) => [`older-${previous.length}`, ...previous])
          )
        }
      >
        Load older history
      </button>
      <button
        id="verify"
        onClick={() =>
          void runNativeScrollChecks().then(
            (result) => setResults(JSON.stringify(result, null, 2)),
            (error) =>
              setResults(error instanceof Error ? error.message : String(error))
          )
        }
      >
        Verify native anchoring
      </button>
      <main
        ref={ownerRef}
        id="owner"
        data-ready={initialScrollReady}
        style={{ height: 600, overflowY: "auto", border: "2px solid black" }}
      >
        <div style={{ overflowX: "hidden" }}>
          {ids.map((id) => (
            <article
              key={id}
              data-message-id={id}
              style={{
                padding: 16,
                minHeight: id === "2" && expanded ? 1000 : 240,
              }}
            >
              <h2>Message {id}</h2>
              {Array.from({ length: 8 }, (_, index) => (
                <p key={index}>
                  Stable reading line {id}.{index}
                </p>
              ))}
            </article>
          ))}
        </div>
      </main>
      <pre id="results">{results}</pre>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<ScrollFixture />);
