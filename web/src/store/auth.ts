"use client";

import localforage from "localforage";

export type AuthRole = "admin" | "user";

export type StoredAuthSession = {
  key: string;
  role: AuthRole;
  subjectId: string;
  name: string;
};

export const AUTH_KEY_STORAGE_KEY = "gpt-image_auth_key";
export const AUTH_SESSION_STORAGE_KEY = "gpt-image_auth_session";
const LEGACY_STORAGE_PREFIX = "chatgpt" + "2api";
const LEGACY_AUTH_KEY_STORAGE_KEY = `${LEGACY_STORAGE_PREFIX}_auth_key`;
const LEGACY_AUTH_SESSION_STORAGE_KEY = `${LEGACY_STORAGE_PREFIX}_auth_session`;

const authStorage = localforage.createInstance({
  name: "gpt-image",
  storeName: "auth",
});
const legacyAuthStorage = localforage.createInstance({
  name: LEGACY_STORAGE_PREFIX,
  storeName: "auth",
});

function normalizeSession(value: unknown, fallbackKey = ""): StoredAuthSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredAuthSession>;
  const key = String(candidate.key || fallbackKey || "").trim();
  const role = candidate.role === "admin" || candidate.role === "user" ? candidate.role : null;
  if (!key || !role) {
    return null;
  }

  return {
    key,
    role,
    subjectId: String(candidate.subjectId || "").trim(),
    name: String(candidate.name || "").trim(),
  };
}

export function getDefaultRouteForRole(role: AuthRole) {
  return role === "admin" ? "/admin" : "/image";
}

export async function getStoredAuthKey() {
  if (typeof window === "undefined") {
    return "";
  }
  const value =
    (await authStorage.getItem<string>(AUTH_KEY_STORAGE_KEY)) ||
    (await legacyAuthStorage.getItem<string>(LEGACY_AUTH_KEY_STORAGE_KEY));
  if (value) {
    await authStorage.setItem(AUTH_KEY_STORAGE_KEY, value);
  }
  return String(value || "").trim();
}

export async function getStoredAuthSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const [storedKey, storedSession] = await Promise.all([
    authStorage.getItem<string>(AUTH_KEY_STORAGE_KEY),
    authStorage.getItem<StoredAuthSession>(AUTH_SESSION_STORAGE_KEY),
  ]);
  const [legacyStoredKey, legacyStoredSession] = storedKey || storedSession
    ? [null, null]
    : await Promise.all([
        legacyAuthStorage.getItem<string>(LEGACY_AUTH_KEY_STORAGE_KEY),
        legacyAuthStorage.getItem<StoredAuthSession>(LEGACY_AUTH_SESSION_STORAGE_KEY),
      ]);

  const effectiveStoredKey = storedKey || legacyStoredKey;
  const normalizedSession = normalizeSession(storedSession || legacyStoredSession, String(effectiveStoredKey || ""));
  if (normalizedSession) {
    if (normalizedSession.key !== String(storedKey || "").trim() || legacyStoredSession) {
      await authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key);
      await authStorage.setItem(AUTH_SESSION_STORAGE_KEY, normalizedSession);
    }
    return normalizedSession;
  }

  if (String(effectiveStoredKey || "").trim()) {
    await clearStoredAuthSession();
  }
  return null;
}

export async function setStoredAuthSession(session: StoredAuthSession) {
  const normalizedSession = normalizeSession(session);
  if (!normalizedSession) {
    await clearStoredAuthSession();
    return;
  }

  await Promise.all([
    authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key),
    authStorage.setItem(AUTH_SESSION_STORAGE_KEY, normalizedSession),
  ]);
}

export async function setStoredAuthKey(authKey: string) {
  const normalizedAuthKey = String(authKey || "").trim();
  if (!normalizedAuthKey) {
    await clearStoredAuthSession();
    return;
  }
  await authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedAuthKey);
}

export async function clearStoredAuthSession() {
  if (typeof window === "undefined") {
    return;
  }
  await Promise.all([
    authStorage.removeItem(AUTH_KEY_STORAGE_KEY),
    authStorage.removeItem(AUTH_SESSION_STORAGE_KEY),
    legacyAuthStorage.removeItem(LEGACY_AUTH_KEY_STORAGE_KEY),
    legacyAuthStorage.removeItem(LEGACY_AUTH_SESSION_STORAGE_KEY),
  ]);
}

export async function clearStoredAuthKey() {
  await clearStoredAuthSession();
}
