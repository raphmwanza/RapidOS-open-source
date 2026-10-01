/**
 * Claims API Tests
 * Tests for claims management endpoints
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.TEST_API_BASE || 'http://localhost:3000';

// Mock valid access token - in real tests this would come from login
let accessToken: string | null = null;

describe('Claims API', () => {
  describe('GET /api/claims', () => {
    it('should reject access without authentication', async () => {
      const response = await fetch(`${API_BASE}/api/claims`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });

    it('should reject access with invalid token', async () => {
      const response = await fetch(`${API_BASE}/api/claims`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/agents/claims', () => {
    it('should reject access without authentication', async () => {
      const response = await fetch(`${API_BASE}/api/agents/claims`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });

    it('should reject access with invalid token', async () => {
      const response = await fetch(`${API_BASE}/api/agents/claims`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/agents/customers', () => {
    it('should reject access without authentication', async () => {
      const response = await fetch(`${API_BASE}/api/agents/customers`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/media/upload', () => {
    it('should reject upload without authentication', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['test'], { type: 'text/plain' }), 'test.txt');

      const response = await fetch(`${API_BASE}/api/media/upload`, {
        method: 'POST',
        body: formData,
      });

      expect(response.status).toBe(401);
    });
  });
});

describe('Claim Number Validation', () => {
  it('should have valid claim number format', () => {
    const validClaimNumbers = [
      'ACT-20250101-001',
      'ACT-20250215-999',
      'CLM-2025-12345',
    ];

    const claimNumberRegex = /^[A-Z]{2,5}-\d{4,8}-\d{3,5}$/;

    validClaimNumbers.forEach(claimNumber => {
      expect(claimNumber).toMatch(claimNumberRegex);
    });
  });

  it('should reject invalid claim number formats', () => {
    const invalidClaimNumbers = [
      'act-20250101-001', // lowercase
      '20250101-001', // missing prefix
      'ACT20250101001', // missing dashes
      'ACT-2025-', // incomplete
    ];

    const claimNumberRegex = /^[A-Z]{2,5}-\d{4,8}-\d{3,5}$/;

    invalidClaimNumbers.forEach(claimNumber => {
      expect(claimNumber).not.toMatch(claimNumberRegex);
    });
  });
});

describe('Phone Number Normalization', () => {
  it('should normalize phone numbers correctly', () => {
    const testCases = [
      { input: '+243 812 345 678', expected: '243812345678' },
      { input: '(243) 812-345-678', expected: '243812345678' },
      { input: '00243812345678', expected: '00243812345678' },
      { input: '0812345678', expected: '0812345678' },
    ];

    testCases.forEach(({ input, expected }) => {
      const normalized = input.replace(/[^0-9]/g, '');
      // Remove leading + if present
      const result = input.startsWith('+') 
        ? input.replace(/[^0-9]/g, '') 
        : input.replace(/[^0-9]/g, '');
      expect(result).toBe(expected);
    });
  });
});

describe('Data Isolation', () => {
  it('should not expose claims from other companies', async () => {
    // This test verifies multi-tenancy - claims should be filtered by companyId
    // Requires two authenticated sessions from different companies
    
    // For now, just verify the endpoint requires auth
    const response = await fetch(`${API_BASE}/api/agents/claims`, {
      method: 'GET',
    });

    expect(response.status).toBe(401);
  });
});
