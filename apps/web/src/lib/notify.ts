/** System notifications (the browser's Notification API), shown only while the page is not in front. */
export const notificationsSupported = (): boolean => typeof Notification !== 'undefined';

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export const pageInFront = (): boolean => document.visibilityState === 'visible' && document.hasFocus();

export function showSystemNotification(title: string, body: string, tag: string, onClick?: () => void): void {
  if (!notificationsSupported() || Notification.permission !== 'granted' || pageInFront()) return;
  try {
    const n = new Notification(title, { body, tag, silent: true });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker: nothing to do then.
  }
}
