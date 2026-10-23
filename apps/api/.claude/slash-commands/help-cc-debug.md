# Debugging Complex Dependency Injection Issues

When debugging complex dependency injection issues, surface-level error messages often mask the real problem. The initial error "Cannot read properties of undefined (reading 'property')" at `this.service.db.model` suggests a database connection issue, but strategic logging of the actual injected objects reveals the true cause: incorrect dependency injection configuration. 

## Key Debugging Strategy

Add `console.log('serviceName', actualServiceInstance)` to expose what services are actually being injected. This often reveals that service A is receiving an instance of service B instead of the expected service, indicating a mismatch between the factory's `inject` array order and parameter expectations. 

Rather than continuing to patch symptoms (like modifying wrapper classes), logging reveals the root cause is often in the test module's factory configuration where the `inject` array has wrong order and missing dependencies.

## Key Lessons

1. **Don't trust error messages alone** - they often point to symptoms, not causes
2. **Log actual runtime state** - `console.log` the problematic objects to see what they really contain  
3. **Verify assumptions** - if your fix doesn't work, the problem might be elsewhere entirely
4. **Dependency injection order matters** - factory parameters must match the inject array order exactly

## Example Investigation Pattern

```typescript
// Add logging to see what's actually injected
console.log('actualService', actualService);
console.log('expectedProperty', actualService.expectedProperty);

// Often reveals:
// - Service A received where Service B expected
// - Properties undefined due to wrong service type
// - Factory inject array order mismatch
```

This demonstrates that when error messages don't align with attempted fixes, step back and log the actual runtime state to understand what's really happening - often the problem is entirely different from what the error suggests.