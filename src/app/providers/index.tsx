import React, { useEffect, useState, useRef } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { ThemeProvider } from './theme-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth';
import { supabase } from '@/shared/lib/supabase';
import { Spin } from 'antd';
import { UserChangeHandler } from './user-change-handler';
import { AuthLogoutHandler } from './auth-logout-handler';

export const queryClient = new QueryClient();

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const setSession = useAuthStore((state) => state.setSession);
  const setLoading = useAuthStore((state) => state.setLoading);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const lastSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      await setSession(session);
      lastSessionIdRef.current = session?.id ?? null;
      setLoading(false);
      setInitialLoadComplete(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const currentSessionId = session?.id ?? null;

      // Обновляем сессию при:
      // - TOKEN_REFRESHED: токен обновлён, нужно обновить access_token в store
      // - SIGNED_IN / SIGNED_OUT: смена пользователя
      // - Изменение session ID: новая сессия
      if (
        event === 'TOKEN_REFRESHED' ||
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        currentSessionId !== lastSessionIdRef.current
      ) {
        setSession(session);
        lastSessionIdRef.current = currentSessionId;
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setSession, setLoading]);

  if (!initialLoadComplete) {
    return <Spin fullscreen />;
  }

  return (
    <React.StrictMode>
      <BrowserRouter>
        <UserChangeHandler>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <AntApp>
                <AuthLogoutHandler>
                  {children}
                </AuthLogoutHandler>
              </AntApp>
            </ThemeProvider>
          </QueryClientProvider>
        </UserChangeHandler>
      </BrowserRouter>
    </React.StrictMode>
  );
};
