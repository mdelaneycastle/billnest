// @deno-types="npm:@types/web-push@3.6.4"
import webPush from 'npm:web-push@3.6.7';
import { timingSafeEqual } from 'node:crypto';

type Subscription = { endpoint: string; keys: { auth: string; p256dh: string } };
type Job = { device_id: string; due_at: string; claim_id: string; subscription: Subscription };
const DAY = 86400000;
const encoder = new TextEncoder();
const env = (name: string) => Deno.env.get(name) ?? '';

function matches(candidate: unknown, secret: string) {
  if (typeof candidate !== 'string' || secret.length < 24) return false;
  const left = encoder.encode(candidate);
  const right = encoder.encode(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readSubscription(value: any): Subscription | null {
  if (typeof value?.endpoint !== 'string' || value.endpoint.length > 2048 ||
      typeof value.keys?.auth !== 'string' || !/^[\w-]{22}$/.test(value.keys.auth) ||
      typeof value.keys?.p256dh !== 'string' || !/^B[A-Za-z0-9_-]{86}$/.test(value.keys.p256dh)) return null;
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { return null; }
  const allowedHost = /(?:^|\.)push\.apple\.com$/.test(endpoint.hostname) ||
    ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com'].includes(endpoint.hostname);
  if (!allowedHost || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.port || endpoint.hash) return null;
  if (endpoint.hostname === 'fcm.googleapis.com' && !endpoint.pathname.startsWith('/fcm/send/')) return null;
  return { endpoint: endpoint.href, keys: { auth: value.keys.auth, p256dh: value.keys.p256dh } };
}

async function bodyOf(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let total = 0;
  let json = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 32000) {
      await reader.cancel();
      return null;
    }
    json += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(json + decoder.decode()); } catch { return null; }
}

async function database(path: string, method: string, body?: unknown) {
  const key = env('OUTGOINGS_DB_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !env('SUPABASE_URL')) throw new Error('Database configuration is missing');
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  const response = await fetch(env('SUPABASE_URL') + '/rest/v1/' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Database request failed');
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const rpc = (name: string, args: unknown = {}) => database('rpc/outgoings_' + name, 'POST', args);
const deleteDevice = (id: string, filter: string) =>
  database('outgoings_devices?id=eq.' + id + '&' + filter, 'DELETE');

async function push(subscription: Subscription, test = false) {
  const details = webPush.generateRequestDetails(subscription, JSON.stringify({ test }), {
    vapidDetails: {
      subject: env('OUTGOINGS_VAPID_SUBJECT'), publicKey: env('OUTGOINGS_VAPID_PUBLIC'),
      privateKey: env('OUTGOINGS_VAPID_PRIVATE')
    },
    TTL: test ? 120 : 21600,
    urgency: test ? 'high' : 'normal'
  });
  const response = await fetch(details.endpoint, {
    method: 'POST', headers: details.headers as Record<string, string>,
    body: new Uint8Array(details.body), redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  await response.body?.cancel();
  return response.status;
}

async function dispatch() {
  const jobs: Job[] = await rpc('claim_jobs');
  const results = await Promise.allSettled(jobs.map(async job => {
    const status = await push(job.subscription);
    if (status === 404 || status === 410) {
      await deleteDevice(job.device_id, 'subscription->>endpoint=eq.' + encodeURIComponent(job.subscription.endpoint));
    } else if (status >= 200 && status < 300) {
      const where = '?device_id=eq.' + job.device_id + '&claim_id=eq.' + job.claim_id;
      await database('outgoings_jobs' + where, 'PATCH', { sent_at: new Date().toISOString() });
    } else {
      throw new Error('Push gateway rejected delivery');
    }
  }));
  await rpc('cleanup');
  return results.some(result => result.status === 'rejected') ? 503 : 204;
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? '';
  const allowed = Boolean(origin && origin === env('OUTGOINGS_ORIGIN'));
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (allowed) Object.assign(headers, {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '300'
  });

  const respond = (status: number) => new Response(null, { status, headers });
  if (request.method === 'OPTIONS') return respond(allowed ? 204 : 403);
  if (request.method !== 'POST') return respond(405);
  try {
    if (matches(request.headers.get('x-outgoings-cron'), env('OUTGOINGS_CRON_SECRET'))) {
      return respond(await dispatch());
    }
    if (!allowed) return respond(403);

    const body = await bodyOf(request);
    if (typeof body?.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.id) ||
        typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) return respond(400);
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(body.token));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const args = { p_id: body.id, p_hash: hash };

    if (body.action === 'remove') {
      await deleteDevice(body.id, 'token_hash=eq.' + hash);
      return respond(204);
    }
    if (body.action === 'test') {
      const subscription = await rpc('claim_test', args);
      if (!subscription) return respond(429);
      const status = await push(subscription, true);
      return respond(status >= 200 && status < 300 ? 204 : status === 404 || status === 410 ? 401 : 503);
    }

    const subscription = readSubscription(body.subscription);
    if (!subscription) return respond(400);
    if (body.action === 'enrol') {
      if (!matches(body.invite, env('OUTGOINGS_INVITE'))) return respond(401);
      const ok = await rpc('enrol', { ...args, p_subscription: subscription });
      return respond(ok ? 204 : 401);
    }
    if (body.action !== 'sync' || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
        !Array.isArray(body.slots) || body.slots.length > 367) return respond(400);

    const now = Date.now();
    const slots = new Set<string>();
    for (const slot of body.slots) {
      if (typeof slot !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:08|09):00:00\.000Z$/.test(slot)) return respond(400);
      const instant = new Date(slot);
      if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== slot || instant.getTime() - now > 367 * DAY) return respond(400);
      if (instant.getTime() > now) slots.add(slot);
    }
    const ok = await rpc('sync', { ...args, p_subscription: subscription, p_revision: body.revision, p_slots: [...slots] });
    return respond(ok ? 204 : 401);
  } catch {
    return respond(503);
  }
});
