/**
 * Tests for Initiative Content Parsing and Serialization
 */

import {
  parseUnifiedContent,
  serializeToUnifiedContent,
  type MultiLevelContent,
} from "../initiativeContent";

describe("parseUnifiedContent", () => {
  it("should correctly parse content with description and acceptance criteria", () => {
    const input = `[[ Description ]]

Build a comprehensive user authentication system with OAuth2 integration, JWT token management, and role-based access control for our React application.

[[ Acceptance Criteria ]]

## Functional Requirements
- [ ] Users can register with email/password
- [ ] Users can login with OAuth2 providers (Google, GitHub)
- [ ] JWT tokens are properly managed with refresh mechanism
- [ ] Role-based access control is enforced on all protected routes
- [ ] User sessions expire after configured timeout

## Technical Requirements
- [ ] All authentication flows must use HTTPS
- [ ] Passwords must be hashed using bcrypt or similar
- [ ] JWT tokens must expire within 15 minutes
- [ ] Refresh tokens must rotate on each use
- [ ] All API endpoints must validate user permissions`;

    const expected: MultiLevelContent = {
      description:
        "Build a comprehensive user authentication system with OAuth2 integration, JWT token management, and role-based access control for our React application.",
      acceptanceCriteria: `## Functional Requirements
- [ ] Users can register with email/password
- [ ] Users can login with OAuth2 providers (Google, GitHub)
- [ ] JWT tokens are properly managed with refresh mechanism
- [ ] Role-based access control is enforced on all protected routes
- [ ] User sessions expire after configured timeout

## Technical Requirements
- [ ] All authentication flows must use HTTPS
- [ ] Passwords must be hashed using bcrypt or similar
- [ ] JWT tokens must expire within 15 minutes
- [ ] Refresh tokens must rotate on each use
- [ ] All API endpoints must validate user permissions`,
    };

    const result = parseUnifiedContent(input);

    // Test each section
    expect(result.description.trim()).toBe(expected.description.trim());
    expect(result.acceptanceCriteria.trim()).toBe(
      expected.acceptanceCriteria.trim()
    );
  });

  it("should handle empty content", () => {
    const result = parseUnifiedContent("");
    expect(result).toEqual({
      description: "",
      acceptanceCriteria: "",
    });
  });

  it("should handle content with only one section", () => {
    const input = `[[ Description ]]

Single section content`;

    const result = parseUnifiedContent(input);
    expect(result.description.trim()).toBe("Single section content");
    expect(result.acceptanceCriteria).toBe("");
  });

  it("should handle mixed case headers", () => {
    const input = `[[ description ]]

Lower case description

[[ acceptance criteria ]]

Mixed case acceptance criteria`;

    const result = parseUnifiedContent(input);
    expect(result.description.trim()).toBe("Lower case description");
    expect(result.acceptanceCriteria.trim()).toBe(
      "Mixed case acceptance criteria"
    );
  });
});

describe("serializeToUnifiedContent", () => {
  it("should correctly serialize MultiLevelContent to markdown", () => {
    const input: MultiLevelContent = {
      description: "Test description",
      acceptanceCriteria: "Test acceptance criteria",
    };

    const expected = `[[ Description ]]

Test description

[[ Acceptance Criteria ]]

Test acceptance criteria`;

    const result = serializeToUnifiedContent(input);
    expect(result).toBe(expected);
  });

  it("should handle empty sections when includeEmptySections is true", () => {
    const input: MultiLevelContent = {
      description: "Test description",
      acceptanceCriteria: "Test acceptance criteria",
    };

    const result = serializeToUnifiedContent(input, true);
    expect(result).toContain("[[ Description ]]");
    expect(result).toContain("[[ Acceptance Criteria ]]");
  });

  it("should skip empty sections when includeEmptySections is false", () => {
    const input: MultiLevelContent = {
      description: "Test description",
      acceptanceCriteria: "",
    };

    const result = serializeToUnifiedContent(input, false);
    expect(result).toContain("[[ Description ]]");
    expect(result).not.toContain("[[ Acceptance Criteria ]]");
  });
});
