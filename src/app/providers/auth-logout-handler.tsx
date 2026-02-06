import { useEffect } from 'react';
import { App } from 'antd';
import { useAuthStore } from '@/features/auth';
import {
  subscribeToUnauthorized,
  setLogoutInProgress,
} from '@/shared/lib/auth-events';

interface AuthLogoutHandlerProps {
  children: React.ReactNode;
}

export const AuthLogoutHandler = ({ children }: AuthLogoutHandlerProps) => {
  const signOut = useAuthStore((state) => state.signOut);
  const { notification } = App.useApp();

  useEffect(() => {
    const unsubscribe = subscribeToUnauthorized(async (reason) => {
      setLogoutInProgress(true);

      notification.warning({
        message: 'Сессия истекла',
        description: reason || 'Пожалуйста, войдите снова.',
        duration: 5,
      });

      try {
        await signOut();
      } finally {
        setLogoutInProgress(false);
      }
    });

    return unsubscribe;
  }, [signOut, notification]);

  return <>{children}</>;
};
