type UnauthorizedCallback = (reason: string) => void;

let listeners: UnauthorizedCallback[] = [];
let logoutInProgress = false;

export const emitUnauthorized = (reason: string = 'Session expired'): void => {
  if (logoutInProgress) {
    return;
  }

  listeners.forEach((callback) => {
    callback(reason);
  });
};

export const subscribeToUnauthorized = (
  callback: UnauthorizedCallback
): (() => void) => {
  listeners.push(callback);

  return () => {
    listeners = listeners.filter((cb) => cb !== callback);
  };
};

export const isLogoutInProgress = (): boolean => {
  return logoutInProgress;
};

export const setLogoutInProgress = (value: boolean): void => {
  logoutInProgress = value;
};
