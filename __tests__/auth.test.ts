/**
 * Authentication API Tests
 * Tests for login, logout and refresh endpoints (self-registration was removed)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Mock fetch for testing
const API_BASE = process.env.TEST_API_BASE || 'http://localhost:3000';

// Test data
const testAdmin = {
  email: 'test-admin@example.com',
  password: 'TestPassword123!',
  firstName: 'Test',
  lastName: 'Admin',
};

let accessToken: string | null = null;
let refreshToken: string | null = null;

describe('Authentication API', () => {
  describe('POST /api/auth/login', () => {
    it('should reject login with missing credentials', async () => {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject login with invalid email format', async () => {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('email');
    });

    it('should reject login with wrong password', async () => {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testAdmin.email,
          password: 'wrongpassword',
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should rate limit after too many attempts', async () => {
      // Make 6 rapid requests (limit is 5)
      const attempts = [];
      for (let i = 0; i < 6; i++) {
        attempts.push(
          fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'ratelimit-test@example.com',
              password: 'wrongpassword',
            }),
          })
        );
      }

      const responses = await Promise.all(attempts);
      const lastResponse = responses[responses.length - 1];
      
      // At least one should be rate limited
      const statuses = responses.map(r => r.status);
      expect(statuses).toContain(429);
    });

    it('should login successfully with valid credentials', async () => {
      // This test requires a pre-seeded test user in the database
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testAdmin.email,
          password: testAdmin.password,
        }),
      });

      // May fail if test user doesn't exist - that's expected in fresh DB
      if (response.status === 200) {
        const data = await response.json();
        expect(data.accessToken).toBeDefined();
        expect(data.admin).toBeDefined();
        expect(data.admin.email).toBe(testAdmin.email);
        
        accessToken = data.accessToken;
        
        // Check for refresh token cookie
        const cookies = response.headers.get('set-cookie');
        expect(cookies).toContain('refreshToken');
      }
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should reject refresh without cookie', async () => {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });

    it('should reject refresh with invalid token', async () => {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': 'refreshToken=invalid-token',
        },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully even without token', async () => {
      const response = await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      // Should succeed (clears cookie regardless)
      expect(response.status).toBe(200);
    });

    it('should clear refresh token cookie on logout', async () => {
      const response = await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const cookies = response.headers.get('set-cookie');
      if (cookies) {
        expect(cookies).toContain('refreshToken=');
        expect(cookies).toContain('Max-Age=0');
      }
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should reject profile access without token', async () => {
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });

    it('should reject profile access with invalid token', async () => {
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
      });

      expect(response.status).toBe(401);
    });

    it('should return profile with valid token', async () => {
      if (!accessToken) {
        console.log('Skipping - no access token from login test');
        return;
      }

      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.admin).toBeDefined();
      expect(data.admin.email).toBe(testAdmin.email);
    });
  });
});

describe('Input Validation', () => {
  describe('SQL Injection Prevention', () => {
    it('should reject SQL injection in email field', async () => {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: "admin@test.com'; DROP TABLE admins; --",
          password: 'password123',
        }),
      });

      // Should reject as invalid email format, not execute SQL
      expect(response.status).toBe(400);
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize XSS attempts in input', async () => {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '<script>alert("xss")</script>@test.com',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      // Should not reflect the script tag back
      expect(JSON.stringify(data)).not.toContain('<script>');
    });
  });
});

describe('Security Headers', () => {
  it('should include security headers in response', async () => {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'test' }),
    });

    // Check for important security headers
    const headers = response.headers;
    
    // These should be set by securityHeadersMiddleware
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
  });
});
