import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Authentication Integration Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  const runtimeJwtKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const originalJwtPrivateKey = process.env.JWT_PRIVATE_KEY;
  const originalJwtPublicKey = process.env.JWT_PUBLIC_KEY;
  const originalJwtKeyId = process.env.JWT_KEY_ID;

  // Test data for consistent testing
  const testUser = {
    email: 'integration-test@example.com',
    password: 'SecurePassword123!',
    name: 'Integration Test User',
    organizationName: 'Test Organization',
  };

  beforeAll(async () => {
    process.env.JWT_PRIVATE_KEY = runtimeJwtKeys.privateKey;
    process.env.JWT_PUBLIC_KEY = runtimeJwtKeys.publicKey;
    process.env.JWT_KEY_ID = 'auth-integration-test-key';

    // INTENT: Set up full application context for integration testing
    // This creates a real NestJS application instance with all modules loaded
    const { AppModule } = await import('../../src/app.module');
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    prisma = module.get<PrismaService>(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    // INTENT: Clean up test data and close connections
    // This ensures tests don't pollute the database and connections are properly closed
    await cleanupTestData();
    await app.close();
    await module.close();
    restoreEnvironmentVariable('JWT_PRIVATE_KEY', originalJwtPrivateKey);
    restoreEnvironmentVariable('JWT_PUBLIC_KEY', originalJwtPublicKey);
    restoreEnvironmentVariable('JWT_KEY_ID', originalJwtKeyId);
  });

  beforeEach(async () => {
    // INTENT: Clean database state before each test
    // This ensures each test starts with a clean slate
    await cleanupTestData();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user and return authentication tokens', async () => {
      // INTENT: Test the complete user registration flow
      // This validates that new users can successfully create accounts and receive auth tokens

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      // INTENT: Verify the response contains all required authentication data
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user.name).toBe(testUser.name);

      // INTENT: Verify secure HTTP-only cookies are set
      // This ensures tokens are stored securely and not accessible via JavaScript
      const cookies = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie']
        : [response.headers['set-cookie']];
      expect(cookies).toBeDefined();
      expect(
        cookies.some((cookie: string) => cookie.includes('accessToken')),
      ).toBe(true);
      expect(
        cookies.some((cookie: string) => cookie.includes('refreshToken')),
      ).toBe(true);
      expect(
        cookies.some((cookie: string) => cookie.includes('HttpOnly')),
      ).toBe(true);

      // INTENT: Verify user was actually created in the database
      // This confirms the registration process persisted data correctly
      const createdUser = await prisma.user.findUnique({
        where: { email: testUser.email },
        include: {},
      });

      expect(createdUser).toBeDefined();
      expect(createdUser?.email).toBe(testUser.email);
    });

    it('should reject registration with duplicate email addresses', async () => {
      // INTENT: Test business rule enforcement for unique email addresses
      // This ensures data integrity and prevents account conflicts

      // First registration should succeed
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      // Second registration with same email should fail
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(400);

      // INTENT: Verify appropriate error message is returned
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('email');
    });

    it('should validate required fields for registration', async () => {
      // INTENT: Test input validation for registration data
      // This ensures API handles malformed requests appropriately

      const invalidRegistration = {
        email: 'invalid-email', // Invalid email format
        password: '123', // Too short
        // Missing name field
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(invalidRegistration)
        .expect(400);

      // INTENT: Verify validation errors are returned
      expect(response.body).toHaveProperty('message');
      expect(
        Array.isArray(response.body.message) ||
          typeof response.body.message === 'string',
      ).toBe(true);
    });

    it('should enforce password complexity requirements', async () => {
      // INTENT: Test security requirements for password strength
      // This ensures users create secure passwords

      const weakPasswordUser = {
        ...testUser,
        password: 'weak',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(weakPasswordUser)
        .expect(400);

      // INTENT: Verify password validation error is returned
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('password');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      // INTENT: Create test user for login tests
      // This ensures we have a valid user account to test authentication against
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(testUser);
    });

    it('should authenticate user with valid credentials', async () => {
      // INTENT: Test successful user authentication flow
      // This validates that registered users can log in with correct credentials

      const loginData = {
        email: testUser.email,
        password: testUser.password,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(200);

      // INTENT: Verify authentication response includes all required data
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user.email).toBe(testUser.email);

      // INTENT: Verify secure cookies are set for token storage
      const cookies = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie']
        : [response.headers['set-cookie']];
      expect(cookies).toBeDefined();
      expect(
        cookies.some((cookie: string) => cookie.includes('accessToken')),
      ).toBe(true);
    });

    it('should reject login with invalid credentials', async () => {
      // INTENT: Test security - invalid credentials should be rejected
      // This ensures unauthorized access attempts are blocked

      const invalidLogin = {
        email: testUser.email,
        password: 'wrongpassword',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(invalidLogin)
        .expect(401);

      // INTENT: Verify no authentication data is returned for failed login
      expect(response.body).not.toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('message');

      // INTENT: Verify no authentication cookies are set on failure
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeUndefined();
    });

    it('should reject login for non-existent users', async () => {
      // INTENT: Test authentication for accounts that don't exist
      // This ensures appropriate error handling for invalid email addresses

      const nonExistentUser = {
        email: 'nonexistent@example.com',
        password: 'anypassword',
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(nonExistentUser)
        .expect(401);
    });

    it('should handle malformed login requests', async () => {
      // INTENT: Test input validation for login requests
      // This ensures API handles incomplete or malformed data appropriately

      const malformedLogin = {
        email: '', // Empty email
        // Missing password
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(malformedLogin)
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let validRefreshToken: string;

    beforeEach(async () => {
      // INTENT: Set up test user and obtain valid refresh token
      // This provides the necessary authentication state for refresh token tests
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(testUser);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      validRefreshToken = loginResponse.body.refreshToken;
    });

    it('should refresh tokens with valid refresh token in body', async () => {
      // INTENT: Test token refresh functionality with body parameter
      // This allows clients to refresh expired access tokens

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken })
        .expect(200);

      // INTENT: Verify new tokens are returned
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.accessToken).not.toBe(validRefreshToken); // Should be different

      // INTENT: Verify new cookies are set with refreshed tokens
      const cookies = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie']
        : [response.headers['set-cookie']];
      expect(cookies).toBeDefined();
      expect(
        cookies.some((cookie: string) => cookie.includes('accessToken')),
      ).toBe(true);
    });

    it('should refresh tokens with valid refresh token in cookies', async () => {
      // INTENT: Test token refresh using HTTP-only cookies
      // This provides a secure way to refresh tokens without exposing them to JavaScript

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${validRefreshToken}`])
        .send({}) // Empty body - token should come from cookie
        .expect(200);

      // INTENT: Verify refresh works with cookie-based tokens
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });

    it('should reject refresh with invalid token', async () => {
      // INTENT: Test security handling of tampered or expired refresh tokens
      // This ensures the system properly rejects invalid authentication attempts

      const invalidToken = 'invalid.jwt.token';

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: invalidToken })
        .expect(401);
    });

    it('should reject refresh when no token provided', async () => {
      // INTENT: Test security validation for missing refresh tokens
      // This prevents unauthorized token refresh attempts

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({}) // No token in body or cookies
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should clear authentication cookies on logout', async () => {
      // INTENT: Test secure logout functionality
      // This ensures users can properly terminate their sessions

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(200);

      // INTENT: Verify logout confirmation message
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Logged out successfully');

      // INTENT: Verify authentication cookies are cleared
      const cookies = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie']
        : [response.headers['set-cookie']];
      expect(cookies).toBeDefined();
      expect(
        cookies.some(
          (cookie: string) =>
            cookie.includes('accessToken') && cookie.includes('Max-Age=0'),
        ),
      ).toBe(true);
    });
  });

  describe('POST /api/v1/auth/validate', () => {
    let validAccessToken: string;

    beforeEach(async () => {
      // INTENT: Set up valid authentication token for validation tests
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(testUser);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      validAccessToken = loginResponse.body.accessToken;
    });

    it('should validate legitimate JWT tokens for external services', async () => {
      // INTENT: Test token validation for service-to-service authentication
      // This allows other services to verify user authentication independently

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/validate')
        .send({ token: validAccessToken })
        .expect(200);

      // INTENT: Verify validation response includes user data
      expect(response.body).toHaveProperty('valid', true);
      expect(response.body).toHaveProperty('payload');
      expect(response.body.payload).toHaveProperty('sub'); // User ID
      expect(response.body.payload).toHaveProperty('email', testUser.email);
    });

    it('should reject invalid or malformed tokens', async () => {
      // INTENT: Test security validation for tampered tokens
      // This protects against unauthorized access attempts from external services

      const invalidToken = 'invalid.jwt.token';

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/validate')
        .send({ token: invalidToken })
        .expect(200); // Returns 200 but with valid: false

      // INTENT: Verify rejection response for invalid tokens
      expect(response.body).toHaveProperty('valid', false);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/v1/auth/jwks', () => {
    it('should provide public keys for external token validation', async () => {
      // INTENT: Test JWKS endpoint for distributed authentication
      // This allows external services to validate tokens without shared secrets

      const registration = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/jwks')
        .expect(200);

      // INTENT: Verify JWKS response structure
      expect(response.body).toHaveProperty('keys');
      expect(Array.isArray(response.body.keys)).toBe(true);
      expect(response.body.keys).toHaveLength(1);

      const key = response.body.keys[0];
      expect(key).toHaveProperty('kty'); // Key type
      expect(key).toHaveProperty('use'); // Usage
      expect(key).toHaveProperty('kid'); // Key ID

      const publishedPublicKey = createPublicKey({
        key,
        format: 'jwk',
      })
        .export({ type: 'spki', format: 'pem' })
        .toString();
      const payload = jwt.verify(
        registration.body.accessToken,
        publishedPublicKey,
        { algorithms: ['RS256'] },
      ) as jwt.JwtPayload;

      expect(payload).toEqual(
        expect.objectContaining({ email: testUser.email }),
      );
    });
  });

  // Helper function to clean up test data
  async function cleanupTestData() {
    // INTENT: Remove test data to prevent pollution between tests
    // This ensures each test starts with a clean database state

    try {
      // Delete in reverse order of dependencies
      // TODO: Uncomment this when we have organization memberships
      // await prisma.organizationMembership.deleteMany({
      //   where: {
      //     user: {
      //       email: {
      //         contains: 'integration-test',
      //       },
      //     },
      //   },
      // });

      await prisma.user.deleteMany({
        where: {
          email: {
            contains: 'integration-test',
          },
        },
      });

      await prisma.organization.deleteMany({
        where: {
          name: {
            contains: 'Test Organization',
          },
        },
      });
    } catch (error) {
      // INTENT: Handle cleanup errors gracefully
      // Some tests may not have created data, so cleanup failures are acceptable
      console.warn('Cleanup warning:', error);
    }
  }

  function restoreEnvironmentVariable(
    name: string,
    value: string | undefined,
  ): void {
    if (value === undefined) {
      delete process.env[name];
      return;
    }

    process.env[name] = value;
  }
});
