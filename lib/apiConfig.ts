import { runtimeEnv } from './runtimeEnv';

/**
 * API Configuration for different environments
 */

/**
 * Return the public URL of the Go backend.
 * On Vercel (or any non-Docker host) this MUST be set via BACKEND_URL env var
 * pointing to the publicly reachable backend.
 */
export function getBackendUrl(): string {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/+$/, '');          // strip trailing slashes
  if (process.env.NODE_ENV === 'development') return 'http://localhost:8080';
  throw new Error('BACKEND_URL env var is required in production');
}

// Get the API base URL based on environment
export function getApiBaseUrl(): string {
  // Check if we're in browser environment
  if (typeof window !== 'undefined') {
    // Client-side: Use environment variable or detect from current host
    const currentHost = window.location.hostname;
    
    // Local development
    if (currentHost === 'localhost') {
      return 'http://localhost:8080';
    }
    
    // Fallback to environment variable
    return runtimeEnv('NEXT_PUBLIC_API_URL') || 'http://localhost:8080';
  }
  
  // Server-side: Use environment variable
  return runtimeEnv('NEXT_PUBLIC_API_URL') || 'http://localhost:8080';
}

// API endpoints configuration
export const API_ENDPOINTS = {
  // Auth endpoints (use Next.js API routes)
  auth: {
    login: '/api/auth/login',
    logout: '/api/auth/logout', 
    refresh: '/api/auth/refresh',
    profile: '/api/auth/profile',
  },
  // Backend API endpoints (use Go backend)
  backend: {
    whatsapp: '/api/v1/whatsapp/webhook',
    health: '/health',
    conversations: '/api/v1/conversations',
    clients: '/api/v1/clients',
    analytics: '/api/v1/analytics',
  }
} as const;

// Helper function to get full backend API URL
export function getBackendApiUrl(endpoint: string): string {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${endpoint}`;
}

// Helper function to make backend API calls with proper CORS
export async function fetchBackendApi(endpoint: string, options: RequestInit = {}) {
  const url = getBackendApiUrl(endpoint);
  
  const defaultOptions: RequestInit = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };
  
  console.log(`Making backend API call to: ${url}`);
  
  const response = await fetch(url, defaultOptions);
  
  if (!response.ok) {
    console.error(`Backend API call failed: ${response.status} ${response.statusText}`);
    throw new Error(`API call failed: ${response.status}`);
  }
  
  return response;
}
