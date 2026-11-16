import { getGoogleAccessToken } from './google.js';
import type { GoogleOAuthSettings } from '../config.js';

/**
 * Google Cloud helpers for the "sign in with Google, use your own project" flow.
 * Everything is billed to the chosen Cloud project via the X-Goog-User-Project header,
 * so the user's own credits / free trial are consumed (never the app owner's).
 */

export interface GcpProject {
  projectId: string;
  name: string;
  /** 'ACTIVE' projects can be used; others are shown greyed out. */
  active: boolean;
  /** Whether the Generative Language API is enabled (filled in on demand). */
  apiEnabled?: boolean;
}

const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v1/projects';
const SERVICE_USAGE = 'https://serviceusage.googleapis.com/v1';
const GENLANG_SERVICE = 'generativelanguage.googleapis.com';

async function authFetch(settings: GoogleOAuthSettings, url: string, init?: RequestInit): Promise<Response> {
  const token = await getGoogleAccessToken(settings);
  if (!token) throw new Error('Not signed in to Google. Run /login first.');
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/** Lists the Cloud projects the signed-in user can use (active first). */
export async function listProjects(settings: GoogleOAuthSettings, signal?: AbortSignal): Promise<GcpProject[]> {
  const out: GcpProject[] = [];
  let pageToken: string | undefined;
  do {
    const url = RESOURCE_MANAGER + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await authFetch(settings, url, { signal });
    const j = (await r.json().catch(() => ({}))) as {
      projects?: { projectId: string; name?: string; lifecycleState?: string }[];
      nextPageToken?: string;
      error?: { message?: string; status?: string };
    };
    if (!r.ok) {
      const msg = j.error?.message ?? r.statusText;
      // The listing is counted against the OAuth client's own project, where this free API must be on.
      if (r.status === 403 && /Cloud Resource Manager API|has not been used in project|SERVICE_DISABLED/i.test(msg))
        throw new Error("This build of just-Code can't list your projects yet (the app's Cloud Resource Manager API is off). Type your project ID instead.");
      throw new Error(`Could not list projects: ${msg}`);
    }
    for (const p of j.projects ?? []) out.push({ projectId: p.projectId, name: p.name ?? p.projectId, active: (p.lifecycleState ?? 'ACTIVE') === 'ACTIVE' });
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.projectId.localeCompare(b.projectId));
}

/** True if the Generative Language API is enabled on the project. */
export async function isGenLangEnabled(settings: GoogleOAuthSettings, projectId: string, signal?: AbortSignal): Promise<boolean> {
  // x-goog-user-project: the check is counted against the user's own project, not the app's
  const r = await authFetch(settings, `${SERVICE_USAGE}/projects/${encodeURIComponent(projectId)}/services/${GENLANG_SERVICE}`, {
    signal,
    headers: { 'x-goog-user-project': projectId },
  });
  if (!r.ok) return false;
  const j = (await r.json().catch(() => ({}))) as { state?: string };
  return j.state === 'ENABLED';
}

/** Enables the Generative Language API on the project (needs serviceusage permission). */
export async function enableGenLang(settings: GoogleOAuthSettings, projectId: string, signal?: AbortSignal): Promise<void> {
  const r = await authFetch(settings, `${SERVICE_USAGE}/projects/${encodeURIComponent(projectId)}/services/${GENLANG_SERVICE}:enable`, {
    method: 'POST',
    body: '{}',
    signal,
    headers: { 'x-goog-user-project': projectId },
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = j.error?.message ?? r.statusText;
    throw new Error(
      /permission|PERMISSION_DENIED/i.test(msg)
        ? `Can't enable the API automatically on ${projectId}. Enable it once at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com?project=${projectId}`
        : `Could not enable the Gemini API on ${projectId}: ${msg}`,
    );
  }
}
