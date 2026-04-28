import { httpRequest } from "@/lib/request";

export type AccountType = "Free" | "Plus" | "ProLite" | "Pro" | "Team" | "API";
export type AccountStatus = "正常" | "限流" | "异常" | "禁用";
export type ImageModel = "auto" | "gpt-image-1" | "gpt-image-2" | "codex-gpt-image-2";
export type AuthRole = "admin" | "user";
export type UserPlan = "trial" | "standard" | "pro" | "internal";

export type Account = {
  id: string;
  access_token: string;
  provider?: "chatgpt" | "openai_compatible";
  name?: string | null;
  base_url?: string | null;
  apiKeyMasked?: string;
  capabilities?: string[];
  type: AccountType;
  status: AccountStatus;
  quota: number;
  imageQuotaUnknown?: boolean;
  email?: string | null;
  user_id?: string | null;
  limits_progress?: Array<{
    feature_name?: string;
    remaining?: number;
    reset_after?: string;
  }>;
  default_model_slug?: string | null;
  restoreAt?: string | null;
  success: number;
  fail: number;
  lastUsedAt: string | null;
};

type AccountListResponse = {
  items: Account[];
};

type AccountMutationResponse = {
  items: Account[];
  added?: number;
  skipped?: number;
  removed?: number;
  refreshed?: number;
  errors?: Array<{ access_token: string; error: string }>;
};

type AccountRefreshResponse = {
  items: Account[];
  refreshed: number;
  errors: Array<{ access_token: string; error: string }>;
};

type AccountUpdateResponse = {
  item: Account;
  items: Account[];
};

export type SettingsConfig = {
  proxy: string;
  base_url?: string;
  refresh_account_interval_minute?: number | string;
  show_image_model_selector?: boolean;
  upstream_image_channels_enabled?: boolean;
  object_storage_enabled?: boolean;
  object_storage_endpoint?: string;
  object_storage_bucket?: string;
  object_storage_region?: string;
  object_storage_access_key_id?: string;
  object_storage_secret_access_key?: string;
  object_storage_public_base_url?: string;
  object_storage_prefix?: string;
  [key: string]: unknown;
};

export type UIConfig = {
  show_image_model_selector: boolean;
  default_image_model: ImageModel;
};

export type LoginResponse = {
  ok: boolean;
  version: string;
  role: AuthRole;
  subject_id: string;
  name: string;
  quota_limit?: number | null;
  quota_used?: number | null;
  quota_remaining?: number | null;
  plan?: UserPlan;
  plan_label?: string;
  max_images_per_request?: number;
  allowed_models?: string[];
  allow_image_edit?: boolean;
};

export type UserKey = {
  id: string;
  name: string;
  key?: string | null;
  role: "user";
  plan: UserPlan;
  plan_label?: string;
  max_images_per_request?: number;
  allowed_models?: string[];
  allow_image_edit?: boolean;
  enabled: boolean;
  created_at: string | null;
  last_used_at: string | null;
  quota_limit: number | null;
  quota_used: number | null;
  quota_remaining: number | null;
};

export type CurrentIdentity = {
  role: AuthRole;
  subject_id: string;
  name: string;
  quota_limit: number | null;
  quota_used: number;
  quota_remaining: number | null;
  plan?: UserPlan;
  plan_label?: string;
  max_images_per_request?: number;
  allowed_models?: string[];
  allow_image_edit?: boolean;
};

export type LibraryImageItem = {
  id: string;
  subject_id: string;
  subject_name: string;
  role: string;
  project_id?: string;
  project_name?: string;
  prompt: string;
  model: string;
  mode: string;
  size: string;
  created_at: string;
  index: number;
  image_url: string;
  thumb_url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

export type ProjectSettings = {
  default_model: ImageModel;
  default_mode: "generate" | "edit";
  default_size: string;
  default_count: number;
  default_style_preset_id: string;
  default_reference_strength: "low" | "medium" | "high";
  prompt_prefix: string;
  prompt_suffix: string;
};

export type ProjectItem = {
  id: string;
  subject_id: string;
  subject_name: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  is_default?: boolean;
  image_count?: number;
  conversation_count?: number;
  last_activity_at?: string;
  cover_url?: string;
  settings?: ProjectSettings;
};

export type ProjectSummary = {
  total_projects: number;
  archived_projects: number;
  total_images: number;
  total_conversations: number;
  latest_activity_at: string;
  scope: "all" | "own";
  owners: Array<{
    subject_id: string;
    subject_name: string;
    project_count: number;
    image_count: number;
    conversation_count: number;
  }>;
};

export async function login(authKey: string) {
  const normalizedAuthKey = String(authKey || "").trim();
  return httpRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: {},
    headers: {
      Authorization: `Bearer ${normalizedAuthKey}`,
    },
    redirectOnUnauthorized: false,
  });
}

export async function fetchAccounts() {
  return httpRequest<AccountListResponse>("/api/accounts");
}

export async function createAccounts(tokens: string[]) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "POST",
    body: { tokens },
  });
}

export async function deleteAccounts(tokens: string[]) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "DELETE",
    body: { tokens },
  });
}

export async function refreshAccounts(accessTokens: string[]) {
  return httpRequest<AccountRefreshResponse>("/api/accounts/refresh", {
    method: "POST",
    body: { access_tokens: accessTokens },
  });
}

export async function updateAccount(
  accessToken: string,
  updates: {
    type?: AccountType;
    status?: AccountStatus;
    quota?: number;
  },
) {
  return httpRequest<AccountUpdateResponse>("/api/accounts/update", {
    method: "POST",
    body: {
      access_token: accessToken,
      ...updates,
    },
  });
}

export type GeneratedImageData = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

export type ImageJob = {
  job_id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  result?: { created: number; data: GeneratedImageData[] } | null;
  error?: string;
  created_at?: string;
  updated_at?: string;
};

export async function generateImage(prompt: string, model?: ImageModel, size?: string) {
  return httpRequest<{ created: number; data: GeneratedImageData[] }>(
    "/v1/images/generations",
    {
      method: "POST",
      body: {
        prompt,
        ...(model ? { model } : {}),
        ...(size ? { size } : {}),
        n: 1,
        response_format: "url",
      },
    },
  );
}

export async function createUpstreamAccount(upstream: {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  quota?: number | null;
  capabilities?: string[];
}) {
  return httpRequest<AccountMutationResponse>("/api/accounts/upstream", {
    method: "POST",
    body: upstream,
  });
}

export async function createImageGenerationJob(prompt: string, model?: ImageModel, size?: string, projectId?: string) {
  return httpRequest<{ job: ImageJob }>("/api/image/jobs/generations", {
    method: "POST",
    body: {
      prompt,
      ...(model ? { model } : {}),
      ...(size ? { size } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      n: 1,
      response_format: "url",
    },
  });
}

export async function editImage(files: File | File[], prompt: string, model?: ImageModel, size?: string) {
  const formData = new FormData();
  const uploadFiles = Array.isArray(files) ? files : [files];

  uploadFiles.forEach((file) => {
    formData.append("image", file);
  });
  formData.append("prompt", prompt);
  if (model) {
    formData.append("model", model);
  }
  if (size) {
    formData.append("size", size);
  }
  formData.append("n", "1");
  formData.append("response_format", "url");

  return httpRequest<{ created: number; data: GeneratedImageData[] }>(
    "/v1/images/edits",
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function fetchSettingsConfig() {
  return httpRequest<{ config: SettingsConfig }>("/api/settings");
}

export async function updateSettingsConfig(settings: SettingsConfig) {
  return httpRequest<{ config: SettingsConfig }>("/api/settings", {
    method: "POST",
    body: settings,
  });
}

export async function createImageEditJob(files: File | File[], prompt: string, model?: ImageModel, size?: string, projectId?: string) {
  const formData = new FormData();
  const uploadFiles = Array.isArray(files) ? files : [files];

  uploadFiles.forEach((file) => {
    formData.append("image", file);
  });
  formData.append("prompt", prompt);
  if (model) {
    formData.append("model", model);
  }
  if (size) {
    formData.append("size", size);
  }
  if (projectId) {
    formData.append("project_id", projectId);
  }
  formData.append("n", "1");
  formData.append("response_format", "url");

  return httpRequest<{ job: ImageJob }>("/api/image/jobs/edits", {
    method: "POST",
    body: formData,
  });
}

export async function fetchImageJob(jobId: string) {
  return httpRequest<{ job: ImageJob }>(`/api/image/jobs/${jobId}`);
}

export async function fetchUIConfig() {
  return httpRequest<UIConfig>("/api/ui-config");
}

export async function fetchUserKeys() {
  return httpRequest<{ items: UserKey[] }>("/api/auth/users");
}

export async function createUserKey(name: string, quotaLimit?: number | null, plan: UserPlan = "standard") {
  return httpRequest<{ item: UserKey; key: string; items: UserKey[] }>("/api/auth/users", {
    method: "POST",
    body: { name, plan, quota_limit: quotaLimit ?? null },
  });
}

export async function fetchCurrentIdentity() {
  return httpRequest<CurrentIdentity>("/auth/me");
}

export async function updateUserKey(
  keyId: string,
  updates: { enabled?: boolean; name?: string; plan?: UserPlan; quota_limit?: number | null; quota_used?: number },
) {
  return httpRequest<{ item: UserKey; items: UserKey[] }>(`/api/auth/users/${keyId}`, {
    method: "POST",
    body: updates,
  });
}

export async function regenerateUserKey(keyId: string) {
  return httpRequest<{ item: UserKey; key: string; items: UserKey[] }>(`/api/auth/users/${keyId}/regenerate`, {
    method: "POST",
  });
}

export async function deleteUserKey(keyId: string) {
  return httpRequest<{ items: UserKey[] }>(`/api/auth/users/${keyId}`, {
    method: "DELETE",
  });
}

// ── CPA (CLIProxyAPI) ──────────────────────────────────────────────

export type CPAPool = {
  id: string;
  name: string;
  base_url: string;
  has_secret_key?: boolean;
  import_job?: CPAImportJob | null;
};

export type CPARemoteFile = {
  name: string;
  email: string;
};

export type CPAImportJob = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  total: number;
  completed: number;
  added: number;
  skipped: number;
  refreshed: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
};

export async function fetchCPAPools() {
  return httpRequest<{ pools: CPAPool[] }>("/api/cpa/pools");
}

export async function createCPAPool(pool: { name: string; base_url: string; secret_key: string }) {
  return httpRequest<{ pool: CPAPool; pools: CPAPool[] }>("/api/cpa/pools", {
    method: "POST",
    body: pool,
  });
}

export async function updateCPAPool(
  poolId: string,
  updates: { name?: string; base_url?: string; secret_key?: string },
) {
  return httpRequest<{ pool: CPAPool; pools: CPAPool[] }>(`/api/cpa/pools/${poolId}`, {
    method: "POST",
    body: updates,
  });
}

export async function deleteCPAPool(poolId: string) {
  return httpRequest<{ pools: CPAPool[] }>(`/api/cpa/pools/${poolId}`, {
    method: "DELETE",
  });
}

export async function fetchCPAPoolFiles(poolId: string) {
  return httpRequest<{ pool_id: string; files: CPARemoteFile[] }>(`/api/cpa/pools/${poolId}/files`);
}

export async function startCPAImport(poolId: string, names: string[]) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/cpa/pools/${poolId}/import`, {
    method: "POST",
    body: { names },
  });
}

export async function fetchCPAPoolImportJob(poolId: string) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/cpa/pools/${poolId}/import`);
}

// ── Sub2API ────────────────────────────────────────────────────────

export type Sub2APIServer = {
  id: string;
  name: string;
  base_url: string;
  email: string;
  has_api_key: boolean;
  group_id: string;
  import_job?: CPAImportJob | null;
};

export type Sub2APIRemoteAccount = {
  id: string;
  name: string;
  email: string;
  plan_type: string;
  status: string;
  expires_at: string;
  has_refresh_token: boolean;
};

export type Sub2APIRemoteGroup = {
  id: string;
  name: string;
  description: string;
  platform: string;
  status: string;
  account_count: number;
  active_account_count: number;
};

export async function fetchSub2APIServers() {
  return httpRequest<{ servers: Sub2APIServer[] }>("/api/sub2api/servers");
}

export async function createSub2APIServer(server: {
  name: string;
  base_url: string;
  email: string;
  password: string;
  api_key: string;
  group_id: string;
}) {
  return httpRequest<{ server: Sub2APIServer; servers: Sub2APIServer[] }>("/api/sub2api/servers", {
    method: "POST",
    body: server,
  });
}

export async function updateSub2APIServer(
  serverId: string,
  updates: {
    name?: string;
    base_url?: string;
    email?: string;
    password?: string;
    api_key?: string;
    group_id?: string;
  },
) {
  return httpRequest<{ server: Sub2APIServer; servers: Sub2APIServer[] }>(`/api/sub2api/servers/${serverId}`, {
    method: "POST",
    body: updates,
  });
}

export async function fetchSub2APIServerGroups(serverId: string) {
  return httpRequest<{ server_id: string; groups: Sub2APIRemoteGroup[] }>(
    `/api/sub2api/servers/${serverId}/groups`,
  );
}

export async function deleteSub2APIServer(serverId: string) {
  return httpRequest<{ servers: Sub2APIServer[] }>(`/api/sub2api/servers/${serverId}`, {
    method: "DELETE",
  });
}

export async function fetchSub2APIServerAccounts(serverId: string) {
  return httpRequest<{ server_id: string; accounts: Sub2APIRemoteAccount[] }>(
    `/api/sub2api/servers/${serverId}/accounts`,
  );
}

export async function startSub2APIImport(serverId: string, accountIds: string[]) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/sub2api/servers/${serverId}/import`, {
    method: "POST",
    body: { account_ids: accountIds },
  });
}

export async function fetchSub2APIImportJob(serverId: string) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/sub2api/servers/${serverId}/import`);
}

// ── Upstream proxy ────────────────────────────────────────────────

export type ProxySettings = {
  enabled: boolean;
  url: string;
};

export type ProxyTestResult = {
  ok: boolean;
  status: number;
  latency_ms: number;
  error: string | null;
};

export async function fetchProxy() {
  return httpRequest<{ proxy: ProxySettings }>("/api/proxy");
}

export async function updateProxy(updates: { enabled?: boolean; url?: string }) {
  return httpRequest<{ proxy: ProxySettings }>("/api/proxy", {
    method: "POST",
    body: updates,
  });
}

export async function testProxy(url?: string) {
  return httpRequest<{ result: ProxyTestResult }>("/api/proxy/test", {
    method: "POST",
    body: { url: url ?? "" },
  });
}

export type StorageInfo = {
  backend: Record<string, unknown>;
  health: Record<string, unknown>;
  app_data: Record<string, unknown>;
  object_storage: Record<string, unknown>;
};

export async function fetchStorageInfo() {
  return httpRequest<StorageInfo>("/api/storage/info");
}

export async function migrateStorageToDatabase() {
  return httpRequest<{ result: Record<string, unknown> }>("/api/storage/migrate-to-database", {
    method: "POST",
    body: {},
  });
}

export async function testObjectStorage() {
  return httpRequest<{ result: Record<string, unknown> }>("/api/object-storage/test", {
    method: "POST",
    body: {},
  });
}

export type ActivityLog = {
  id: string;
  created_at: string;
  event: string;
  level: string;
  status: string;
  route: string;
  model: string;
  subject_id: string;
  role: string;
  prompt_preview: string;
  duration_ms: number | null;
  error: string;
  metadata: Record<string, unknown>;
};

export type ActivityLogSummary = {
  total: number;
  failures: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
  by_event: Record<string, number>;
  by_status: Record<string, number>;
  latest: ActivityLog[];
};

export type PaginatedResponse<T> = {
  items: T[];
  total?: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

export async function fetchActivityLogs(params: {
  limit?: number;
  offset?: number;
  level?: string;
  status?: string;
  event?: string;
  model?: string;
  role?: string;
  min_duration_ms?: number;
  q?: string;
} = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return httpRequest<PaginatedResponse<ActivityLog>>(`/api/logs${query ? `?${query}` : ""}`);
}

export async function fetchActivityLogSummary() {
  return httpRequest<{ summary: ActivityLogSummary }>("/api/logs/summary");
}

export async function fetchProjects(params: { limit?: number; offset?: number; q?: string } = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return httpRequest<PaginatedResponse<ProjectItem>>(`/api/projects${query ? `?${query}` : ""}`);
}

export async function fetchProjectSummary() {
  return httpRequest<{ summary: ProjectSummary }>("/api/projects/summary");
}

export async function createProject(project: { name: string; description?: string; settings?: Partial<ProjectSettings> }) {
  return httpRequest<{ item: ProjectItem; items: ProjectItem[] }>("/api/projects", {
    method: "POST",
    body: project,
  });
}

export async function updateProject(
  projectId: string,
  updates: { name?: string; description?: string; archived?: boolean; settings?: Partial<ProjectSettings> },
) {
  return httpRequest<{ item: ProjectItem; items: ProjectItem[] }>(`/api/projects/${projectId}`, {
    method: "POST",
    body: updates,
  });
}

export async function archiveProject(projectId: string) {
  return httpRequest<{ item: ProjectItem; items: ProjectItem[] }>(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function moveLibraryItemToProject(imageId: string, projectId: string) {
  return httpRequest<{ item: LibraryImageItem }>(`/api/library/${imageId}/project`, {
    method: "POST",
    body: { project_id: projectId },
  });
}

export async function moveConversationToProject(conversationId: string, projectId: string) {
  return httpRequest<{
    item: {
      id: string;
      projectId: string;
      project_id: string;
      project_name: string;
      updatedAt: string;
    };
  }>(`/api/conversations/${encodeURIComponent(conversationId)}/project`, {
    method: "POST",
    body: { project_id: projectId },
  });
}

export async function fetchLibraryItems(params: { limit?: number; offset?: number; q?: string; mode?: string; project_id?: string } = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return httpRequest<PaginatedResponse<LibraryImageItem>>(`/api/library${query ? `?${query}` : ""}`);
}
