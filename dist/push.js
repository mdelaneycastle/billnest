import { pushConfig } from './push-config.js';
import { reminderSlots } from './model.js';

export const pushConfigured = Boolean(pushConfig.endpoint && pushConfig.publicKey);
const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
export const canPush = () => pushConfigured && pushSupported();

export function pushProblem() {
  if (!pushSupported()) return 'Open Billnest from your Home Screen on iPhone (iOS 16.4 or later), or use a browser with web push.';
  if (Notification.permission === 'denied') return 'Allow Billnest notifications in your phone or browser settings.';
  return '';
}

function applicationKey() {
  const raw = pushConfig.publicKey.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(raw), byte => byte.charCodeAt(0));
}

async function registration() {
  const registered = await navigator.serviceWorker.getRegistration();
  if (!registered?.active) throw new Error('Reload Billnest once while online, then try again.');
  return registered;
}

async function send(body) {
  const response = await fetch(pushConfig.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (response.status === 429) throw new Error('Wait one minute before trying another test alert.');
  if (response.status === 401) throw new Error('The setup code or device registration was rejected. Check the code or set up notifications again.');
  if (!response.ok) throw new Error('The notification service is unavailable. Try again when online.');
}

export async function preparePush() {
  if (!canPush() || pushProblem()) throw new Error(pushProblem() || 'Notifications are unavailable here.');
  const worker = await registration();
  const existing = await worker.pushManager.getSubscription();
  return { worker, existing };
}

export async function enablePush(invite, previous, { worker, existing }) {
  // Call subscribe directly from the click so iOS can prompt for permission.
  const subscription = existing ?? await worker.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: applicationKey()
  });
  const device = previous ?? {
    id: crypto.randomUUID(),
    token: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  };
  try {
    await send({ action: 'enrol', ...device, invite, subscription: subscription.toJSON() });
  } catch (error) {
    if (!existing) await subscription.unsubscribe().catch(() => {});
    throw error;
  }
  return device;
}

export async function syncPush(state) {
  if (!state.push) return;
  if (!canPush()) throw new Error(pushProblem());
  if (Notification.permission !== 'granted') throw new Error('Allow notifications in settings, then try again.');
  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription();
  if (!subscription) throw new Error('This phone’s subscription expired. Set up notifications again.');
  await send({
    action: 'sync', ...state.push, subscription: subscription.toJSON(), revision: state.revision,
    slots: reminderSlots(state.records)
  });
}

export async function disablePush(device) {
  await send({ action: 'remove', ...device });
  const worker = await navigator.serviceWorker.getRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  await subscription?.unsubscribe().catch(() => {});
}

export const testPush = device => send({ action: 'test', ...device });
