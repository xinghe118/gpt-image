"use client";

import localforage from "localforage";

import { httpRequest } from "@/lib/request";
import type { ImageModel } from "@/lib/api";

export type ImageConversationMode = "generate" | "edit";
export type ImageReferenceStrength = "low" | "medium" | "high";

export type StoredReferenceImage = {
  name: string;
  type: string;
  dataUrl: string;
};

export type StoredImage = {
  id: string;
  status?: "loading" | "success" | "error";
  b64_json?: string;
  url?: string;
  error?: string;
  stage?: string;
  progressMessage?: string;
  progressPercent?: number;
};

export type ImageTurnStatus = "queued" | "generating" | "success" | "error";

export type ImageTurn = {
  id: string;
  prompt: string;
  model: ImageModel;
  mode: ImageConversationMode;
  referenceImages: StoredReferenceImage[];
  count: number;
  size: string;
  referenceStrength?: ImageReferenceStrength;
  images: StoredImage[];
  createdAt: string;
  status: ImageTurnStatus;
  error?: string;
};

export type ImageConversation = {
  id: string;
  projectId?: string;
  project_id?: string;
  project_name?: string;
  subject_id?: string;
  subject_name?: string;
  role?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ImageTurn[];
};

export type ImageConversationStats = {
  queued: number;
  running: number;
};

const imageConversationStorage = localforage.createInstance({
  name: "gpt-image",
  storeName: "image_conversations",
});
const LEGACY_STORAGE_PREFIX = "chatgpt" + "2api";
const legacyImageConversationStorage = localforage.createInstance({
  name: LEGACY_STORAGE_PREFIX,
  storeName: "image_conversations",
});

const IMAGE_CONVERSATIONS_KEY = "items";
const SERVER_MIGRATION_KEY = "gpt-image:server_conversations_migrated";
let imageConversationWriteQueue: Promise<void> = Promise.resolve();

function normalizeStoredImage(image: StoredImage): StoredImage {
  if (image.status === "loading" || image.status === "error" || image.status === "success") {
    return image;
  }
  return {
    ...image,
    status: image.b64_json || image.url ? "success" : "loading",
  };
}

function normalizeReferenceImage(image: StoredReferenceImage): StoredReferenceImage {
  return {
    name: image.name || "reference.png",
    type: image.type || "image/png",
    dataUrl: image.dataUrl,
  };
}

function dataUrlMimeType(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match?.[1] || "image/png";
}

function getLegacyReferenceImages(source: Record<string, unknown>): StoredReferenceImage[] {
  if (Array.isArray(source.referenceImages)) {
    return source.referenceImages
      .filter((image): image is StoredReferenceImage => {
        if (!image || typeof image !== "object") {
          return false;
        }
        const candidate = image as StoredReferenceImage;
        return typeof candidate.dataUrl === "string" && candidate.dataUrl.length > 0;
      })
      .map(normalizeReferenceImage);
  }

  if (source.sourceImage && typeof source.sourceImage === "object") {
    const image = source.sourceImage as { dataUrl?: unknown; fileName?: unknown };
    if (typeof image.dataUrl === "string" && image.dataUrl) {
      return [
        {
          name: typeof image.fileName === "string" && image.fileName ? image.fileName : "reference.png",
          type: dataUrlMimeType(image.dataUrl),
          dataUrl: image.dataUrl,
        },
      ];
    }
  }

  return [];
}

function normalizeTurn(turn: ImageTurn & Record<string, unknown>): ImageTurn {
  const normalizedImages = Array.isArray(turn.images) ? turn.images.map(normalizeStoredImage) : [];
  const derivedStatus: ImageTurnStatus =
    normalizedImages.some((image) => image.status === "loading")
      ? "generating"
      : normalizedImages.some((image) => image.status === "error")
        ? "error"
        : "success";

  return {
    id: String(turn.id || `${Date.now()}`),
    prompt: String(turn.prompt || ""),
    model: (turn.model as ImageModel) || "auto",
    mode: turn.mode === "edit" ? "edit" : "generate",
    referenceImages: getLegacyReferenceImages(turn),
    count: Math.max(1, Number(turn.count || normalizedImages.length || 1)),
    size: typeof turn.size === "string" ? turn.size : "",
    referenceStrength:
      turn.referenceStrength === "low" || turn.referenceStrength === "medium" || turn.referenceStrength === "high"
        ? turn.referenceStrength
        : "medium",
    images: normalizedImages,
    createdAt: String(turn.createdAt || new Date().toISOString()),
    status:
      turn.status === "queued" ||
      turn.status === "generating" ||
      turn.status === "success" ||
      turn.status === "error"
        ? turn.status
        : derivedStatus,
    error: typeof turn.error === "string" ? turn.error : undefined,
  };
}

function normalizeConversation(conversation: ImageConversation & Record<string, unknown>): ImageConversation {
  const turns = Array.isArray(conversation.turns)
    ? conversation.turns.map((turn) => normalizeTurn(turn as ImageTurn & Record<string, unknown>))
    : [
        normalizeTurn({
          id: String(conversation.id || `${Date.now()}`),
          prompt: String(conversation.prompt || ""),
          model: (conversation.model as ImageModel) || "auto",
          mode: conversation.mode === "edit" ? "edit" : "generate",
          referenceImages: getLegacyReferenceImages(conversation),
          count: Number(conversation.count || 1),
          size: typeof conversation.size === "string" ? conversation.size : "",
          images: Array.isArray(conversation.images) ? (conversation.images as StoredImage[]) : [],
          createdAt: String(conversation.createdAt || new Date().toISOString()),
          status:
            conversation.status === "generating" || conversation.status === "success" || conversation.status === "error"
              ? conversation.status
              : "success",
          error: typeof conversation.error === "string" ? conversation.error : undefined,
        }),
      ];
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;

  return {
    id: String(conversation.id || `${Date.now()}`),
    projectId: String(conversation.projectId || conversation.project_id || "default"),
    project_id: String(conversation.project_id || conversation.projectId || "default"),
    project_name: typeof conversation.project_name === "string" ? conversation.project_name : undefined,
    subject_id: typeof conversation.subject_id === "string" ? conversation.subject_id : undefined,
    subject_name: typeof conversation.subject_name === "string" ? conversation.subject_name : undefined,
    role: typeof conversation.role === "string" ? conversation.role : undefined,
    title: String(conversation.title || ""),
    createdAt: String(conversation.createdAt || lastTurn?.createdAt || new Date().toISOString()),
    updatedAt: String(conversation.updatedAt || lastTurn?.createdAt || new Date().toISOString()),
    turns,
  };
}

function sortImageConversations(conversations: ImageConversation[]): ImageConversation[] {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function queueImageConversationWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = imageConversationWriteQueue.then(operation);
  imageConversationWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readStoredImageConversations(): Promise<ImageConversation[]> {
  let items =
    (await imageConversationStorage.getItem<Array<ImageConversation & Record<string, unknown>>>(IMAGE_CONVERSATIONS_KEY)) ||
    null;
  if (!items) {
    const legacyItems =
      await legacyImageConversationStorage.getItem<Array<ImageConversation & Record<string, unknown>>>(
        IMAGE_CONVERSATIONS_KEY,
      );
    if (legacyItems) {
      items = legacyItems;
      await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, legacyItems);
    }
  }
  items = items || [];
  return items.map(normalizeConversation);
}

function getConversationMigrationKey() {
  if (typeof window === "undefined") {
    return SERVER_MIGRATION_KEY;
  }
  return `${SERVER_MIGRATION_KEY}:${window.localStorage.getItem("gpt-image_auth_key") || "anonymous"}`;
}

function mergeConversations(...groups: ImageConversation[][]): ImageConversation[] {
  const byId = new Map<string, ImageConversation>();
  groups.flat().forEach((conversation) => {
    const normalized = normalizeConversation(conversation);
    const previous = byId.get(normalized.id);
    if (!previous || normalized.updatedAt.localeCompare(previous.updatedAt) >= 0) {
      byId.set(normalized.id, normalized);
    }
  });
  return sortImageConversations([...byId.values()]);
}

async function fetchServerImageConversations(): Promise<ImageConversation[]> {
  const data = await httpRequest<{ items: Array<ImageConversation & Record<string, unknown>> }>("/api/conversations");
  return sortImageConversations(data.items.map(normalizeConversation));
}

async function saveServerImageConversations(conversations: ImageConversation[]): Promise<ImageConversation[]> {
  const data = await httpRequest<{ items: Array<ImageConversation & Record<string, unknown>> }>("/api/conversations", {
    method: "POST",
    body: { items: conversations.map(normalizeConversation) },
  });
  return sortImageConversations(data.items.map(normalizeConversation));
}

export async function listImageConversations(): Promise<ImageConversation[]> {
  const localItems = await readStoredImageConversations();
  try {
    const serverItems = await fetchServerImageConversations();
    const migrationKey = getConversationMigrationKey();
    const hasMigrated = typeof window !== "undefined" && window.localStorage.getItem(migrationKey) === "1";
    if (!hasMigrated && localItems.length > 0) {
      const merged = mergeConversations(serverItems, localItems);
      const savedItems = await saveServerImageConversations(merged);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(migrationKey, "1");
      }
      await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, savedItems);
      return savedItems;
    }
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, serverItems);
    return serverItems;
  } catch {
    return sortImageConversations(localItems);
  }
}

export async function saveImageConversations(conversations: ImageConversation[]): Promise<void> {
  await queueImageConversationWrite(async () => {
    const normalizedItems = sortImageConversations(conversations.map(normalizeConversation));
    try {
      const serverItems = await saveServerImageConversations(normalizedItems);
      await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, serverItems);
      return;
    } catch {
      // Keep local cache writable if the backend is temporarily unavailable.
    }
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, normalizedItems);
  });
}

export async function saveImageConversation(conversation: ImageConversation): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    const nextItems = sortImageConversations([
      normalizeConversation(conversation),
      ...items.filter((item) => item.id !== conversation.id),
    ]);
    try {
      await httpRequest<{ item: ImageConversation & Record<string, unknown> }>(
        `/api/conversations/${encodeURIComponent(conversation.id)}`,
        {
          method: "POST",
          body: normalizeConversation(conversation),
        },
      );
    } catch {
      // Keep local cache writable if the backend is temporarily unavailable.
    }
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, nextItems);
  });
}

export async function deleteImageConversation(id: string): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    try {
      await httpRequest<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      // Local deletion still proceeds so the UI remains responsive.
    }
    await imageConversationStorage.setItem(
      IMAGE_CONVERSATIONS_KEY,
      items.filter((item) => item.id !== id),
    );
  });
}

export async function deleteImageConversations(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return;
  }
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          await httpRequest<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
        } catch {
          // Local deletion still proceeds so the UI remains responsive.
        }
      }),
    );
    await imageConversationStorage.setItem(
      IMAGE_CONVERSATIONS_KEY,
      items.filter((item) => !uniqueIds.includes(item.id)),
    );
  });
}

export async function clearImageConversations(): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    try {
      await Promise.all(
        items.map((item) =>
          httpRequest<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(item.id)}`, {
            method: "DELETE",
          }),
        ),
      );
    } catch {
      // Local clearing still proceeds so the UI remains responsive.
    }
    await imageConversationStorage.removeItem(IMAGE_CONVERSATIONS_KEY);
    await legacyImageConversationStorage.removeItem(IMAGE_CONVERSATIONS_KEY);
  });
}

export function getImageConversationStats(conversation: ImageConversation | null): ImageConversationStats {
  if (!conversation) {
    return { queued: 0, running: 0 };
  }

  return conversation.turns.reduce(
    (acc, turn) => {
      if (turn.status === "queued") {
        acc.queued += 1;
      } else if (turn.status === "generating") {
        acc.running += 1;
      }
      return acc;
    },
    { queued: 0, running: 0 },
  );
}
