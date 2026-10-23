import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntityConversationTitle } from "../EntityConversationTitle";

describe("EntityConversationTitle", () => {
  it("renders the conversation title and entity id", () => {
    render(
      <EntityConversationTitle
        conversationTitle="Discuss Search"
        entityId="task-1"
      />
    );

    expect(screen.getByTestId("entity-conversation-title")).toHaveTextContent(
      "Discuss Search"
    );
    expect(screen.getByTestId("entity-conversation-name")).toHaveTextContent(
      "Discuss Search"
    );
    expect(screen.getByTestId("entity-conversation-title")).toHaveAttribute(
      "data-entity-id",
      "task-1"
    );
  });
});
