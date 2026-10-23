# Critical Review Command

Please perform a critical review of the staged files with respect to soundness, performance, and security.

## Review Criteria

**Soundness:**

- Code correctness and logic
- Error handling and edge cases
- Type safety and proper interfaces. No usage of `any`
- Adherence to established patterns

**Performance:**

- Efficient algorithms and data structures
- Memory usage and potential leaks
- Database query optimization
- Async/await usage and potential blocking operations

**Security:**

- Input validation and sanitization
- Authentication and authorization
- Data exposure and logging
- Dependency vulnerabilities

## Context Consideration

{{#if context}}
**Additional Context:**
{{context}}

Please ensure that the code meets the goals and requirements specified in the above context.
{{/if}}

## Instructions

1. Review each staged file thoroughly
2. Identify any issues in the three categories above
3. Provide specific recommendations for improvements
4. Highlight any critical security vulnerabilities
5. Suggest performance optimizations where applicable
6. Ensure the code follows project conventions and best practices

Please provide a structured review with clear sections for each file and category of concerns.
