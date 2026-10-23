/**
 * Tests for Initiative Content Parsing and Serialization
 */

import {
  parseUnifiedContent,
  serializeToUnifiedContent,
  type MultiLevelContent,
} from "../initiativeContent";

describe("parseUnifiedContent", () => {
  it("should correctly parse mixed-level markdown content with all three sections", () => {
    const input = `[[ Description ]]

Build a comprehensive user authentication system with OAuth2 integration, JWT token management, and role-based access control for our React application.

[[ Details ]]

# Authentication System Technical Implementation Plan

## Technical Architecture
- OAuth2 Flow: Authorization Code Grant with PKCE
- JWT Structure: RS256 signing with public/private key pair
- RBAC Implementation: Custom middleware with role hierarchy

## Implementation Phases & Timeline

Phase 1: Core Authentication (3 weeks)
- OAuth2 Provider Integration (Google, GitHub)
- JWT Token Generation & Validation
- Refresh Token Implementation
- Session Management API

Phase 2: Authorization & RBAC (2 weeks)
- Role Definition Schema
- Permission Matrix Implementation
- Access Control Middleware
- Role Assignment API

Phase 3: Security Hardening (2 weeks)
- Rate Limiting Implementation
- Token Revocation System
- Security Headers Configuration
- CORS Policy Setup

## Technical Dependencies

Backend:
- @oauth/passport-google: ^2.0.0
- jsonwebtoken: ^9.0.0
- express-rate-limit: ^6.0.0
- redis: ^4.0.0
- helmet: ^5.0.0

Frontend:
- @auth/react: ^1.0.0
- axios-auth-refresh: ^3.0.0
- react-query: ^4.0.0

Infrastructure:
- Redis Cache Server
- Key Management Service (AWS KMS)
- CDN for static assets

## Resource Requirements

1. Development Team:
   - Senior Backend Developer (1.0 FTE, 7 weeks)
   - Frontend Developer (0.7 FTE, 4 weeks)
   - DevOps Engineer (0.3 FTE, 3 weeks)
   - Security Engineer (0.2 FTE, review/consulting)

2. Infrastructure:
   - Development Environment
   - Staging Environment
   - Production Environment

## Technical Challenges & Mitigation

1. Token Security
   - Challenge: JWT secret management
   - Mitigation: Use KMS for key storage, rotation policy

2. Performance
   - Challenge: Auth request bottlenecks
   - Mitigation: Redis caching, rate limiting

3. Session Management
   - Challenge: Concurrent login handling
   - Mitigation: Token versioning, device tracking

4. Cross-Platform Support
   - Challenge: Mobile/web token sharing
   - Mitigation: Unified token format, shared session store

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
- [ ] All API endpoints must validate user permissions

## Security Requirements
- [ ] No sensitive data logged to console or files
- [ ] CSRF protection implemented
- [ ] XSS prevention measures in place
- [ ] Rate limiting on authentication endpoints
- [ ] Security headers properly configured

## Performance Requirements
- [ ] Authentication check response time < 200ms
- [ ] Login flow completion time < 3 seconds
- [ ] No memory leaks in token management
- [ ] Efficient permission checking (cached)

## Testing Requirements
- [ ] Unit test coverage > 80% for auth modules
- [ ] Integration tests for all auth flows
- [ ] E2E tests for complete user journeys
- [ ] Security penetration testing completed
- [ ] Cross-browser compatibility verified`;

    const expected: MultiLevelContent = {
      description:
        "Build a comprehensive user authentication system with OAuth2 integration, JWT token management, and role-based access control for our React application.",
      details: `# Authentication System Technical Implementation Plan

## Technical Architecture
- OAuth2 Flow: Authorization Code Grant with PKCE
- JWT Structure: RS256 signing with public/private key pair
- RBAC Implementation: Custom middleware with role hierarchy

## Implementation Phases & Timeline

Phase 1: Core Authentication (3 weeks)
- OAuth2 Provider Integration (Google, GitHub)
- JWT Token Generation & Validation
- Refresh Token Implementation
- Session Management API

Phase 2: Authorization & RBAC (2 weeks)
- Role Definition Schema
- Permission Matrix Implementation
- Access Control Middleware
- Role Assignment API

Phase 3: Security Hardening (2 weeks)
- Rate Limiting Implementation
- Token Revocation System
- Security Headers Configuration
- CORS Policy Setup

## Technical Dependencies

Backend:
- @oauth/passport-google: ^2.0.0
- jsonwebtoken: ^9.0.0
- express-rate-limit: ^6.0.0
- redis: ^4.0.0
- helmet: ^5.0.0

Frontend:
- @auth/react: ^1.0.0
- axios-auth-refresh: ^3.0.0
- react-query: ^4.0.0

Infrastructure:
- Redis Cache Server
- Key Management Service (AWS KMS)
- CDN for static assets

## Resource Requirements

1. Development Team:
   - Senior Backend Developer (1.0 FTE, 7 weeks)
   - Frontend Developer (0.7 FTE, 4 weeks)
   - DevOps Engineer (0.3 FTE, 3 weeks)
   - Security Engineer (0.2 FTE, review/consulting)

2. Infrastructure:
   - Development Environment
   - Staging Environment
   - Production Environment

## Technical Challenges & Mitigation

1. Token Security
   - Challenge: JWT secret management
   - Mitigation: Use KMS for key storage, rotation policy

2. Performance
   - Challenge: Auth request bottlenecks
   - Mitigation: Redis caching, rate limiting

3. Session Management
   - Challenge: Concurrent login handling
   - Mitigation: Token versioning, device tracking

4. Cross-Platform Support
   - Challenge: Mobile/web token sharing
   - Mitigation: Unified token format, shared session store`,
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
- [ ] All API endpoints must validate user permissions

## Security Requirements
- [ ] No sensitive data logged to console or files
- [ ] CSRF protection implemented
- [ ] XSS prevention measures in place
- [ ] Rate limiting on authentication endpoints
- [ ] Security headers properly configured

## Performance Requirements
- [ ] Authentication check response time < 200ms
- [ ] Login flow completion time < 3 seconds
- [ ] No memory leaks in token management
- [ ] Efficient permission checking (cached)

## Testing Requirements
- [ ] Unit test coverage > 80% for auth modules
- [ ] Integration tests for all auth flows
- [ ] E2E tests for complete user journeys
- [ ] Security penetration testing completed
- [ ] Cross-browser compatibility verified`,
    };

    const result = parseUnifiedContent(input);

    // Test each section
    expect(result.description.trim()).toBe(expected.description.trim());
    expect(result.details.trim()).toBe(expected.details.trim());
    expect(result.acceptanceCriteria.trim()).toBe(
      expected.acceptanceCriteria.trim()
    );
  });

  it("should handle empty content", () => {
    const result = parseUnifiedContent("");
    expect(result).toEqual({
      description: "",
      details: "",
      acceptanceCriteria: "",
    });
  });

  it("should handle content with only one section", () => {
    const input = `[[ Description ]]

Single section content`;

    const result = parseUnifiedContent(input);
    expect(result.description.trim()).toBe("Single section content");
    expect(result.details).toBe("");
    expect(result.acceptanceCriteria).toBe("");
  });

  it("should handle mixed case headers", () => {
    const input = `[[ description ]]

Lower case description

[[ DETAILS ]]

Upper case details

[[ acceptance criteria ]]

Mixed case acceptance criteria`;

    const result = parseUnifiedContent(input);
    expect(result.description.trim()).toBe("Lower case description");
    expect(result.details.trim()).toBe("Upper case details");
    expect(result.acceptanceCriteria.trim()).toBe(
      "Mixed case acceptance criteria"
    );
  });
});

describe("serializeToUnifiedContent", () => {
  it("should correctly serialize MultiLevelContent to markdown", () => {
    const input: MultiLevelContent = {
      description: "Test description",
      details: "Test details",
      acceptanceCriteria: "Test acceptance criteria",
    };

    const expected = `[[ Description ]]

Test description

[[ Details ]]

Test details

[[ Acceptance Criteria ]]

Test acceptance criteria`;

    const result = serializeToUnifiedContent(input);
    expect(result).toBe(expected);
  });

  it("should handle empty sections when includeEmptySections is true", () => {
    const input: MultiLevelContent = {
      description: "Test description",
      details: "",
      acceptanceCriteria: "Test acceptance criteria",
    };

    const result = serializeToUnifiedContent(input, true);
    expect(result).toContain("[[ Details ]]");
    expect(result).toContain("[[ Description ]]");
    expect(result).toContain("[[ Acceptance Criteria ]]");
  });

  it("should skip empty sections when includeEmptySections is false", () => {
    const input: MultiLevelContent = {
      description: "Test description",
      details: "",
      acceptanceCriteria: "Test acceptance criteria",
    };

    const result = serializeToUnifiedContent(input, false);
    expect(result).not.toContain("[[ Details ]]");
    expect(result).toContain("[[ Description ]]");
    expect(result).toContain("[[ Acceptance Criteria ]]");
  });
});
