import { supabase } from './supabase';
import { emitUnauthorized, isLogoutInProgress } from './auth-events';

// Use explicit localhost:3001 for development, relative paths for production
const getApiBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3001/api/v1';
  }
  return '/api/v1';
};

export const apiClient = {
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const { data: { session } } = await supabase.auth.getSession();
    const apiUrl = getApiBaseUrl();
    const response = await fetch(`${apiUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401 && !isLogoutInProgress()) {
        emitUnauthorized('Session expired');
      }
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  },

  async post<T>(endpoint: string, body?: any, options?: RequestInit): Promise<T> {
    const { data: { session } } = await supabase.auth.getSession();
    const apiUrl = getApiBaseUrl();
    const response = await fetch(`${apiUrl}${endpoint}`, {
      method: 'POST',
      ...options,
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401 && !isLogoutInProgress()) {
        emitUnauthorized('Session expired');
      }
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  },

  async put<T>(endpoint: string, body?: any, options?: RequestInit): Promise<T> {
    const { data: { session } } = await supabase.auth.getSession();
    const apiUrl = getApiBaseUrl();
    const response = await fetch(`${apiUrl}${endpoint}`, {
      method: 'PUT',
      ...options,
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401 && !isLogoutInProgress()) {
        emitUnauthorized('Session expired');
      }
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  },

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const { data: { session } } = await supabase.auth.getSession();
    const apiUrl = getApiBaseUrl();
    const response = await fetch(`${apiUrl}${endpoint}`, {
      method: 'DELETE',
      ...options,
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401 && !isLogoutInProgress()) {
        emitUnauthorized('Session expired');
      }
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  },
};

