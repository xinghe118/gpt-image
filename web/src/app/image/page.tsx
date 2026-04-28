"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, FolderKanban, Gauge, History, ImageIcon, LoaderCircle, Pencil, Plus, RotateCcw, Save, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ImageComposer } from "@/app/image/components/image-composer";
import { ImageResults, type ImageLightboxItem } from "@/app/image/components/image-results";
import { ImageSidebar } from "@/app/image/components/image-sidebar";
import { ImageLightbox } from "@/components/image-lightbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  archiveProject,
  createImageEditJob,
  createImageGenerationJob,
  createProject,
  fetchAccounts,
  fetchCurrentIdentity,
  fetchImageJob,
  fetchProjects,
  fetchUIConfig,
  updateProject,
  type Account,
  type CurrentIdentity,
  type GeneratedImageData,
  type ImageModel,
  type ProjectItem,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import {
  deleteImageConversation,
  deleteImageConversations,
  getImageConversationStats,
  listImageConversations,
  saveImageConversations,
  type ImageConversation,
  type ImageConversationMode,
  type ImageReferenceStrength,
  type ImageTurn,
  type ImageTurnStatus,
  type StoredImage,
  type StoredReferenceImage,
} from "@/store/image-conversations";

const ACTIVE_CONVERSATION_STORAGE_KEY = "gpt-image:image_active_conversation_id";
const IMAGE_SIZE_STORAGE_KEY = "gpt-image:image_last_size";
const IMAGE_MODEL_STORAGE_KEY = "gpt-image:image_last_model";
const STYLE_PRESETS_STORAGE_KEY = "gpt-image:image_style_presets";
const PENDING_REFERENCE_IMAGE_STORAGE_KEY = "gpt-image:pending_reference_image";
const ACTIVE_PROJECT_STORAGE_KEY = "gpt-image:active_project_id";
const LEGACY_STORAGE_PREFIX = "chatgpt" + "2api";
const LEGACY_ACTIVE_CONVERSATION_STORAGE_KEY = `${LEGACY_STORAGE_PREFIX}:image_active_conversation_id`;
const LEGACY_IMAGE_SIZE_STORAGE_KEY = `${LEGACY_STORAGE_PREFIX}:image_last_size`;
const activeConversationQueueIds = new Set<string>();

const IMAGE_MODELS = [
  {
    value: "auto",
    title: "自动选择",
    description: "由后端按可用账号与默认模型处理",
  },
  {
    value: "gpt-image-2",
    title: "GPT Image 2",
    description: "默认图像生成模型，适合大多数创作",
  },
  {
    value: "gpt-image-1",
    title: "GPT Image 1",
    description: "兼容旧接口和旧账号能力",
  },
  {
    value: "codex-gpt-image-2",
    title: "Codex GPT Image 2",
    description: "保留给 Codex 图像通道",
  },
] as const;

function isImageModel(value: string): value is ImageModel {
  return IMAGE_MODELS.some((model) => model.value === value);
}

type StylePreset = {
  id: string;
  title: string;
  tag: string;
  prompt: string;
  builtin?: boolean;
};

const REFERENCE_STRENGTH_OPTIONS: Array<{
  value: ImageReferenceStrength;
  title: string;
  description: string;
}> = [
  {
    value: "low",
    title: "低",
    description: "只参考大致构图和氛围，优先按提示词重做画面",
  },
  {
    value: "medium",
    title: "中",
    description: "保留主体和主要构图，同时明显执行修改要求",
  },
  {
    value: "high",
    title: "高",
    description: "尽量保持原图主体、位置和细节，只做必要修改",
  },
];

const DEFAULT_STYLE_PRESETS: StylePreset[] = [
  {
    id: "cinematic-story",
    title: "电影级叙事",
    tag: "Cinematic",
    prompt: "电影级构图，主体明确，真实镜头语言，柔和但有方向性的光线，浅景深，细腻胶片颗粒，高级色彩分级，画面具有故事感",
    builtin: true,
  },
  {
    id: "commercial-product",
    title: "商业产品海报",
    tag: "Product",
    prompt: "高端商业产品摄影，干净背景，精准布光，产品边缘清晰，材质质感突出，适合广告海报，留有排版空间，画面高级克制",
    builtin: true,
  },
  {
    id: "realistic-photo",
    title: "写实摄影",
    tag: "Photo",
    prompt: "真实摄影风格，自然光影，真实材质和细节，镜头焦段合理，色彩不过度饱和，画面可信且有生活质感",
    builtin: true,
  },
  {
    id: "commerce-main-image",
    title: "电商主图",
    tag: "Commerce",
    prompt: "电商主图构图，主体居中突出，背景简洁明亮，卖点清晰，高清质感，适合商品展示，避免杂乱元素",
    builtin: true,
  },
  {
    id: "modern-oriental",
    title: "东方新中式",
    tag: "Oriental",
    prompt: "东方新中式美学，留白克制，温润材质，低饱和自然色，优雅构图，融合现代设计与传统意境",
    builtin: true,
  },
  {
    id: "trend-illustration",
    title: "潮流插画",
    tag: "Illustration",
    prompt: "潮流插画风格，形体概括有力，色块干净，细节精致，具有品牌视觉感，适合封面或社交媒体传播",
    builtin: true,
  },
  {
    id: "ui-icon",
    title: "UI 图标",
    tag: "Icon",
    prompt: "精致 UI 图标设计，简洁几何造型，统一透视，柔和阴影，清晰轮廓，适合应用图标或功能入口",
    builtin: true,
  },
  {
    id: "architecture-space",
    title: "建筑空间",
    tag: "Space",
    prompt: "高级建筑空间摄影，空间层次清晰，自然采光，材质细节丰富，构图稳定，呈现安静、现代、可居住的氛围",
    builtin: true,
  },
];

function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...`;
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAvailableQuota(accounts: Account[]) {
  const availableAccounts = accounts.filter((account) => account.status !== "禁用");
  return String(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeStylePresets(value: unknown): StylePreset[] {
  if (!Array.isArray(value)) {
    return DEFAULT_STYLE_PRESETS;
  }

  const normalized = value
    .map((item): StylePreset | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const preset = item as Partial<StylePreset>;
      const title = String(preset.title || "").trim();
      const prompt = String(preset.prompt || "").trim();
      if (!title || !prompt) {
        return null;
      }
      return {
        id: String(preset.id || createId()),
        title,
        tag: String(preset.tag || "Custom").trim() || "Custom",
        prompt,
        builtin: Boolean(preset.builtin),
      };
    })
    .filter((item): item is StylePreset => Boolean(item));

  return normalized.length ? normalized : DEFAULT_STYLE_PRESETS;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取参考图失败"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType || matchedMimeType || "image/png" });
}

async function imageUrlToReferenceImage(url: string, fileName: string): Promise<StoredReferenceImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("读取结果图失败");
    }
    const blob = await response.blob();
    const dataUrl = await readFileAsDataUrl(new File([blob], fileName, { type: blob.type || "image/png" }));
    return {
      name: fileName,
      type: blob.type || "image/png",
      dataUrl,
    };
  } catch {
    return null;
  }
}

function buildReferenceImageFromResult(image: StoredImage, fileName: string): StoredReferenceImage | null {
  if (!image.b64_json) {
    return null;
  }

  return {
    name: fileName,
    type: "image/png",
    dataUrl: `data:image/png;base64,${image.b64_json}`,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForImageJob(jobId: string) {
  const startedAt = Date.now();
  let interval = 1500;
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    const { job } = await fetchImageJob(jobId);
    if (job.status === "succeeded") {
      return job.result;
    }
    if (job.status === "failed") {
      throw new Error(job.error || "生成失败");
    }
    await delay(interval);
    interval = Math.min(5000, interval + 500);
  }
  throw new Error("图片生成仍在处理中，请稍后到作品库查看");
}

async function runImageJob(
  mode: ImageConversationMode,
  referenceFiles: File[],
  prompt: string,
  model: ImageModel,
  size: string,
  referenceStrength: ImageReferenceStrength,
  projectId: string,
): Promise<GeneratedImageData> {
  const finalPrompt = mode === "edit" ? buildEditPrompt(prompt, referenceStrength) : prompt;
  const { job } =
    mode === "edit"
      ? await createImageEditJob(referenceFiles, finalPrompt, model, size, projectId)
      : await createImageGenerationJob(finalPrompt, model, size, projectId);
  const result = await waitForImageJob(job.job_id);
  const first = result?.data?.[0];
  if (!first?.b64_json && !first?.url) {
    throw new Error("未返回图片数据");
  }
  return first;
}

function pickFallbackConversationId(conversations: ImageConversation[]) {
  const activeConversation = conversations.find((conversation) =>
    conversation.turns.some((turn) => turn.status === "queued" || turn.status === "generating"),
  );
  return activeConversation?.id ?? conversations[0]?.id ?? null;
}

function sortImageConversations(conversations: ImageConversation[]) {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function appendPromptSegment(current: string, segment: string) {
  const trimmed = current.trim();
  return trimmed ? `${trimmed}，${segment}` : segment;
}

function enhanceImagePrompt(prompt: string, mode: ImageConversationMode, size: string, strength: ImageReferenceStrength) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("画面主体：") || trimmed.includes("创作目标：")) {
    return trimmed;
  }

  const ratioHint = size ? `画幅比例为 ${size}` : "画幅比例按内容自动选择";
  const modeHint =
    mode === "edit"
      ? `图生图编辑，参考图影响强度为${strength === "high" ? "高" : strength === "low" ? "低" : "中"}`
      : "文生图创作";

  return [
    `创作目标：${trimmed}`,
    "画面主体：明确突出主要对象，保持视觉焦点清晰。",
    `构图与镜头：${ratioHint}，主体居中或遵循三分法，层次分明，留白自然。`,
    "风格与质感：画面精致、细节丰富、光影真实，色彩协调，避免廉价模板感。",
    `执行要求：${modeHint}，不要生成乱码文字、畸形手部、多余肢体、低清晰度或水印。`,
  ].join("\n");
}

function buildEditPrompt(userPrompt: string, strength: ImageReferenceStrength) {
  const normalizedPrompt = userPrompt.trim();
  const strengthInstruction =
    strength === "low"
      ? "参考强度：低。参考图只作为画面氛围、色彩方向和大致构图参考；允许根据用户要求重新组织主体、场景和细节。"
      : strength === "high"
        ? "参考强度：高。尽量保持参考图中的主体身份、位置关系、构图、姿态、材质和关键细节；只执行用户明确要求的变化，避免无关改动。"
        : "参考强度：中。保留参考图的主要主体、构图和空间关系，同时让用户修改要求在画面中清晰可见。";
  return [
    "请基于上传的参考图进行图像编辑。",
    strengthInstruction,
    `用户修改要求：${normalizedPrompt}`,
    "输出要求：画面自然完整，边缘和材质细节可信，不要添加与用户要求无关的文字、水印或多余主体。",
  ].join("\n");
}

async function recoverConversationHistory(items: ImageConversation[]) {
  const normalized = items.map((conversation) => {
    let changed = false;

    const turns = conversation.turns.map((turn) => {
      if (turn.status !== "queued" && turn.status !== "generating") {
        return turn;
      }

      const loadingCount = turn.images.filter((image) => image.status === "loading").length;
      if (loadingCount > 0) {
        const message = "页面刷新或任务中断，未完成的图片已标记为失败";
        changed = true;
        return {
          ...turn,
          status: "error" as const,
          error: message,
          images: turn.images.map((image) =>
            image.status === "loading" ? { ...image, status: "error" as const, error: message } : image,
          ),
        };
      }

      const failedCount = turn.images.filter((image) => image.status === "error").length;
      const successCount = turn.images.filter((image) => image.status === "success").length;
      const nextStatus: ImageTurnStatus =
        failedCount > 0 ? "error" : successCount > 0 ? "success" : "queued";
      const nextError = failedCount > 0 ? turn.error || `其中 ${failedCount} 张未成功生成` : undefined;
      if (nextStatus === turn.status && nextError === turn.error) {
        return turn;
      }

      changed = true;
      return {
        ...turn,
        status: nextStatus,
        error: nextError,
      };
    });

    if (!changed) {
      return conversation;
    }

    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    return {
      ...conversation,
      turns,
      updatedAt: lastTurn?.createdAt || conversation.updatedAt,
    };
  });

  const changedConversations = normalized.filter((conversation, index) => conversation !== items[index]);
  if (changedConversations.length > 0) {
    await saveImageConversations(normalized);
  }

  return normalized;
}

function ImagePageContent({ isAdmin }: { isAdmin: boolean }) {
  const didLoadQuotaRef = useRef(false);
  const conversationsRef = useRef<ImageConversation[]>([]);
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageMode, setImageMode] = useState<ImageConversationMode>("generate");
  const [imageModel, setImageModel] = useState<ImageModel>("gpt-image-2");
  const [showImageModelSelector, setShowImageModelSelector] = useState(true);
  const [imageSize, setImageSize] = useState("");
  const [referenceStrength, setReferenceStrength] = useState<ImageReferenceStrength>("medium");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMobileParamsOpen, setIsMobileParamsOpen] = useState(false);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<StoredReferenceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isNewConversationDraft, setIsNewConversationDraft] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [availableQuota, setAvailableQuota] = useState("加载中...");
  const [currentIdentity, setCurrentIdentity] = useState<CurrentIdentity | null>(null);
  const [lightboxImages, setLightboxImages] = useState<ImageLightboxItem[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [stylePresets, setStylePresets] = useState<StylePreset[]>(DEFAULT_STYLE_PRESETS);
  const [isPresetEditorOpen, setIsPresetEditorOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<StylePreset | null>(null);
  const [presetTitle, setPresetTitle] = useState("");
  const [presetTag, setPresetTag] = useState("");
  const [presetPrompt, setPresetPrompt] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("default");
  const [newProjectName, setNewProjectName] = useState("");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);

  const parsedCount = useMemo(() => Math.max(1, Math.min(10, Number(imageCount) || 1)), [imageCount]);
  const projectConversations = useMemo(
    () => conversations.filter((item) => (item.projectId || "default") === activeProjectId),
    [activeProjectId, conversations],
  );
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null,
    [activeProjectId, projects],
  );
  const activeProjectImageCount = useMemo(
    () =>
      projectConversations.reduce(
        (total, conversation) =>
          total + conversation.turns.reduce((turnTotal, turn) => turnTotal + (turn.images?.length || 0), 0),
        0,
      ),
    [projectConversations],
  );
  const taskSummary = useMemo(
    () =>
      conversations.reduce(
        (summary, conversation) => {
          const stats = getImageConversationStats(conversation);
          summary.queued += stats.queued;
          summary.running += stats.running;
          summary.failedImages += conversation.turns.reduce(
            (sum, turn) => sum + turn.images.filter((image) => image.status === "error").length,
            0,
          );
          return summary;
        },
        { queued: 0, running: 0, failedImages: 0 },
      ),
    [conversations],
  );
  const activeTaskCount = taskSummary.queued + taskSummary.running;

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, imageModel);
    }
  }, [imageModel]);

  useEffect(() => {
    let cancelled = false;

    const loadUIConfig = async () => {
      try {
        const data = await fetchUIConfig();
        if (cancelled) {
          return;
        }
        setShowImageModelSelector(data.show_image_model_selector);
        setImageModel(data.show_image_model_selector ? data.default_image_model : "gpt-image-2");
      } catch {
        if (!cancelled) {
          setShowImageModelSelector(true);
        }
      }
    };

    void loadUIConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, imageSize);
    }
  }, [imageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const rawPresets = window.localStorage.getItem(STYLE_PRESETS_STORAGE_KEY);
    if (!rawPresets) {
      return;
    }
    try {
      setStylePresets(normalizeStylePresets(JSON.parse(rawPresets)));
    } catch {
      setStylePresets(DEFAULT_STYLE_PRESETS);
    }
  }, []);

  const persistStylePresets = useCallback((items: StylePreset[]) => {
    const normalized = normalizeStylePresets(items);
    setStylePresets(normalized);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STYLE_PRESETS_STORAGE_KEY, JSON.stringify(normalized));
    }
  }, []);

  const openCreatePreset = useCallback(() => {
    setEditingPreset(null);
    setPresetTitle("");
    setPresetTag("Custom");
    setPresetPrompt("");
    setIsPresetEditorOpen(true);
  }, []);

  const openEditPreset = useCallback((preset: StylePreset) => {
    setEditingPreset(preset);
    setPresetTitle(preset.title);
    setPresetTag(preset.tag);
    setPresetPrompt(preset.prompt);
    setIsPresetEditorOpen(true);
  }, []);

  const handleSavePreset = useCallback(() => {
    const title = presetTitle.trim();
    const tag = presetTag.trim() || "Custom";
    const prompt = presetPrompt.trim();

    if (!title) {
      toast.error("请输入预设名称");
      return;
    }
    if (!prompt) {
      toast.error("请输入预设提示词");
      return;
    }

    if (editingPreset) {
      persistStylePresets(
        stylePresets.map((preset) =>
          preset.id === editingPreset.id
            ? {
                ...preset,
                title,
                tag,
                prompt,
              }
            : preset,
        ),
      );
      toast.success("风格预设已更新");
    } else {
      persistStylePresets([
        ...stylePresets,
        {
          id: createId(),
          title,
          tag,
          prompt,
          builtin: false,
        },
      ]);
      toast.success("已新增风格预设");
    }

    setIsPresetEditorOpen(false);
  }, [editingPreset, persistStylePresets, presetPrompt, presetTag, presetTitle, stylePresets]);

  const handleDeletePreset = useCallback(
    (preset: StylePreset) => {
      if (preset.builtin) {
        toast.error("默认预设只能编辑，不能删除");
        return;
      }
      persistStylePresets(stylePresets.filter((item) => item.id !== preset.id));
      toast.success("已删除自定义预设");
    },
    [persistStylePresets, stylePresets],
  );

  const resetStylePresets = useCallback(() => {
    persistStylePresets(DEFAULT_STYLE_PRESETS);
    toast.success("已恢复默认风格预设");
  }, [persistStylePresets]);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const storedSize =
          typeof window !== "undefined"
            ? window.localStorage.getItem(IMAGE_SIZE_STORAGE_KEY) ||
              window.localStorage.getItem(LEGACY_IMAGE_SIZE_STORAGE_KEY)
            : null;
        const storedModel =
          typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_MODEL_STORAGE_KEY) : null;
        if (storedSize && typeof window !== "undefined") {
          window.localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, storedSize);
        }
        if (storedModel && isImageModel(storedModel)) {
          setImageModel(storedModel);
        }
        setImageSize(storedSize || "");

        const items = await listImageConversations();
        const normalizedItems = await recoverConversationHistory(items);
        if (cancelled) {
          return;
        }

        conversationsRef.current = normalizedItems;
        setConversations(normalizedItems);
        const storedConversationId =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) ||
              window.localStorage.getItem(LEGACY_ACTIVE_CONVERSATION_STORAGE_KEY)
            : null;
        if (storedConversationId && typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, storedConversationId);
        }
        const nextSelectedConversationId =
          (storedConversationId && normalizedItems.some((conversation) => conversation.id === storedConversationId)
            ? storedConversationId
            : null) ?? pickFallbackConversationId(normalizedItems);
        setSelectedConversationId(nextSelectedConversationId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取会话记录失败";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadQuota = useCallback(async () => {
    if (!isAdmin) {
      try {
        const identity = await fetchCurrentIdentity();
        setCurrentIdentity(identity);
        setAvailableQuota(identity.quota_remaining === null ? "不限" : String(identity.quota_remaining ?? "--"));
      } catch {
        setAvailableQuota("--");
      }
      return;
    }
    try {
      const data = await fetchAccounts();
      setAvailableQuota(formatAvailableQuota(data.items));
      const identity = await fetchCurrentIdentity();
      setCurrentIdentity(identity);
    } catch {
      setAvailableQuota((prev) => (prev === "加载中..." ? "--" : prev));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;

    const handleFocus = () => {
      void loadQuota();
    };

    void loadQuota();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAdmin, loadQuota]);

  useEffect(() => {
    let cancelled = false;
    const loadProjects = async () => {
      try {
        const data = await fetchProjects();
        if (cancelled) {
          return;
        }
        setProjects(data.items);
        const storedProjectId =
          typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) : "";
        const nextProjectId =
          storedProjectId && data.items.some((item) => item.id === storedProjectId)
            ? storedProjectId
            : data.items[0]?.id || "default";
        setActiveProjectId(nextProjectId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取项目失败");
      }
    };
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    setProjectNameDraft(activeProject?.is_default ? "" : activeProject?.name || "");
    setProjectDescriptionDraft(activeProject?.is_default ? "" : activeProject?.description || "");
  }, [activeProject]);

  useEffect(() => {
    if (!selectedConversation) {
      return;
    }

    resultsViewportRef.current?.scrollTo({
      top: resultsViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedConversation?.updatedAt, selectedConversation?.turns.length, selectedConversation]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedConversationId) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, selectedConversationId);
      window.localStorage.removeItem(LEGACY_ACTIVE_CONVERSATION_STORAGE_KEY);
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (imageSize) {
      window.localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, imageSize);
      window.localStorage.removeItem(LEGACY_IMAGE_SIZE_STORAGE_KEY);
      return;
    }
    window.localStorage.removeItem(IMAGE_SIZE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_IMAGE_SIZE_STORAGE_KEY);
  }, [imageSize]);

  useEffect(() => {
    if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) {
      setIsNewConversationDraft(false);
      setSelectedConversationId(pickFallbackConversationId(conversations));
    }
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    if (selectedConversationId && !projectConversations.some((conversation) => conversation.id === selectedConversationId)) {
      setIsNewConversationDraft(false);
      setSelectedConversationId(pickFallbackConversationId(projectConversations));
    }
    if (!selectedConversationId && !isNewConversationDraft && projectConversations.length > 0) {
      setSelectedConversationId(pickFallbackConversationId(projectConversations));
    }
  }, [activeProjectId, isNewConversationDraft, projectConversations, selectedConversationId]);

  const selectConversation = useCallback((id: string | null) => {
    setIsNewConversationDraft(false);
    setSelectedConversationId(id);
  }, []);

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) {
      toast.error("请输入项目名称");
      return;
    }
    setIsCreatingProject(true);
    try {
      const data = await createProject({ name });
      setProjects(data.items);
      setActiveProjectId(data.item.id);
      setIsNewConversationDraft(true);
      setSelectedConversationId(null);
      setNewProjectName("");
      resetComposer();
      toast.success("项目已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建项目失败");
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleRenameProject = async () => {
    if (!activeProject || activeProject.is_default) {
      return;
    }
    const name = projectNameDraft.trim();
    if (!name) {
      toast.error("项目名称不能为空");
      return;
    }
    setIsSavingProject(true);
    try {
      const data = await updateProject(activeProject.id, {
        name,
        description: projectDescriptionDraft.trim(),
      });
      setProjects(data.items);
      toast.success("项目已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存项目失败");
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleArchiveProject = async () => {
    if (!activeProject || activeProject.is_default) {
      return;
    }
    setIsSavingProject(true);
    try {
      const data = await archiveProject(activeProject.id);
      setProjects(data.items);
      const nextProjectId = data.items[0]?.id || "default";
      setActiveProjectId(nextProjectId);
      setIsNewConversationDraft(true);
      setSelectedConversationId(null);
      toast.success("项目已归档");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "归档项目失败");
    } finally {
      setIsSavingProject(false);
    }
  };

  const persistConversation = async (conversation: ImageConversation) => {
    const nextConversations = sortImageConversations([
      conversation,
      ...conversationsRef.current.filter((item) => item.id !== conversation.id),
    ]);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    await saveImageConversations(nextConversations);
  };

  const updateConversation = useCallback(
    async (
      conversationId: string,
      updater: (current: ImageConversation | null) => ImageConversation,
      options: { persist?: boolean } = {},
    ) => {
      const current = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
      const nextConversation = updater(current);
      const nextConversations = sortImageConversations([
        nextConversation,
        ...conversationsRef.current.filter((item) => item.id !== conversationId),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      if (options.persist !== false) {
        await saveImageConversations(nextConversations);
      }
    },
    [],
  );

  const clearComposerInputs = useCallback(() => {
    setImagePrompt("");
    setImageCount("1");
    setReferenceImageFiles([]);
    setReferenceImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const resetComposer = useCallback(() => {
    setImageMode("generate");
    clearComposerInputs();
  }, [clearComposerInputs]);

  const handleCreateDraft = () => {
    setIsNewConversationDraft(true);
    setSelectedConversationId(null);
    resetComposer();
    requestAnimationFrame(() => textareaRef.current?.focus());
    toast.success("已进入新对话");
  };

  const handleDeleteConversation = async (id: string) => {
    const nextConversations = conversations.filter((item) => item.id !== id);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    if (selectedConversationId === id) {
      selectConversation(pickFallbackConversationId(nextConversations));
      resetComposer();
    }

    try {
      await deleteImageConversation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除会话失败";
      toast.error(message);
      const items = await listImageConversations();
      conversationsRef.current = items;
      setConversations(items);
    }
  };

  const handleClearHistory = async () => {
    try {
      const deletingIds = conversationsRef.current
        .filter((conversation) => (conversation.projectId || "default") === activeProjectId)
        .map((conversation) => conversation.id);
      const nextConversations = conversationsRef.current.filter(
        (conversation) => (conversation.projectId || "default") !== activeProjectId,
      );
      await deleteImageConversations(deletingIds);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      setIsNewConversationDraft(true);
      setSelectedConversationId(null);
      resetComposer();
      toast.success("已清空当前项目的历史记录");
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空历史记录失败";
      toast.error(message);
    }
  };

  const appendReferenceImages = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    try {
      const previews = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || "image/png",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );

      setReferenceImageFiles((prev) => [...prev, ...files]);
      setReferenceImages((prev) => [...prev, ...previews]);
      setImageMode("edit");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取参考图失败";
      toast.error(message);
    }
  }, []);

  const handleReferenceImageChange = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      await appendReferenceImages(files);
    },
    [appendReferenceImages],
  );

  const handleRemoveReferenceImage = useCallback((index: number) => {
    setReferenceImageFiles((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
    setReferenceImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const handleContinueEdit = useCallback(
    async (conversationId: string, image: StoredImage | StoredReferenceImage) => {
      const nextReferenceImage = await (
        "dataUrl" in image
          ? Promise.resolve(image)
          : image.url
            ? imageUrlToReferenceImage(image.url, `conversation-${conversationId}-${Date.now()}.png`)
            : Promise.resolve(buildReferenceImageFromResult(image, `conversation-${conversationId}-${Date.now()}.png`))
      );
      if (!nextReferenceImage) {
        toast.error("无法读取结果图，请从作品库下载后作为参考图上传");
        return;
      }

      selectConversation(conversationId);
      setImageMode("edit");
      setReferenceImages((prev) => [...prev, nextReferenceImage]);
      setReferenceImageFiles((prev) => [
        ...prev,
        dataUrlToFile(nextReferenceImage.dataUrl, nextReferenceImage.name, nextReferenceImage.type),
      ]);
      setImagePrompt("");
      textareaRef.current?.focus();
      toast.success("已加入当前参考图，继续输入描述即可编辑");
    },
    [selectConversation],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const rawPayload = window.localStorage.getItem(PENDING_REFERENCE_IMAGE_STORAGE_KEY);
    if (!rawPayload) {
      return;
    }

    window.localStorage.removeItem(PENDING_REFERENCE_IMAGE_STORAGE_KEY);
    let cancelled = false;

    const loadPendingReference = async () => {
      try {
        const payload = JSON.parse(rawPayload) as {
          url?: string;
          name?: string;
          prompt?: string;
          model?: string;
          size?: string;
        };
        if (!payload.url) {
          return;
        }

        const referenceImage = await imageUrlToReferenceImage(
          payload.url,
          payload.name || `library-reference-${Date.now()}.png`,
        );
        if (cancelled) {
          return;
        }
        if (!referenceImage) {
          toast.error("无法读取作品库图片，请下载后手动上传参考图");
          return;
        }

        setSelectedConversationId(null);
        setImageMode("edit");
        if (payload.model && isImageModel(payload.model)) {
          setImageModel(payload.model);
        }
        setImageSize(payload.size || "");
        setReferenceImages((prev) => [...prev, referenceImage]);
        setReferenceImageFiles((prev) => [
          ...prev,
          dataUrlToFile(referenceImage.dataUrl, referenceImage.name, referenceImage.type),
        ]);
        setImagePrompt(payload.prompt || "");
        textareaRef.current?.focus();
        toast.success("已复用作品参数并加入参考图");
      } catch {
        if (!cancelled) {
          toast.error("读取作品库图片失败");
        }
      }
    };

    void loadPendingReference();
    return () => {
      cancelled = true;
    };
  }, []);

  const openLightbox = useCallback((images: ImageLightboxItem[], index: number) => {
    if (images.length === 0) {
      return;
    }

    setLightboxImages(images);
    setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
    setLightboxOpen(true);
  }, []);

  /* eslint-disable react-hooks/preserve-manual-memoization */
  const runConversationQueue = useCallback(
    async (conversationId: string) => {
      if (activeConversationQueueIds.has(conversationId)) {
        return;
      }

      const snapshot = conversationsRef.current.find((conversation) => conversation.id === conversationId);
      const queuedTurn = snapshot?.turns.find((turn) => turn.status === "queued");
      if (!snapshot || !queuedTurn) {
        return;
      }

      activeConversationQueueIds.add(conversationId);
      await updateConversation(conversationId, (current) => {
        const conversation = current ?? snapshot;
        return {
          ...conversation,
          updatedAt: new Date().toISOString(),
          turns: conversation.turns.map((turn) =>
            turn.id === queuedTurn.id
              ? {
                  ...turn,
                  status: "generating",
                  error: undefined,
                }
              : turn,
          ),
        };
      });

      try {
        const referenceFiles = queuedTurn.referenceImages.map((image, index) =>
          dataUrlToFile(image.dataUrl, image.name || `${queuedTurn.id}-${index + 1}.png`, image.type),
        );
        const pendingImages = queuedTurn.images.filter((image) => image.status === "loading");

        if (queuedTurn.mode === "edit" && referenceFiles.length === 0) {
          throw new Error("未找到可用于继续编辑的参考图");
        }

        if (pendingImages.length === 0) {
          const existingFailedCount = queuedTurn.images.filter((image) => image.status === "error").length;
          const existingSuccessCount = queuedTurn.images.filter((image) => image.status === "success").length;
          await updateConversation(conversationId, (current) => {
            const conversation = current ?? snapshot;
            return {
              ...conversation,
              updatedAt: new Date().toISOString(),
              turns: conversation.turns.map((turn) =>
                turn.id === queuedTurn.id
                  ? {
                      ...turn,
                      status: existingFailedCount > 0 ? "error" : existingSuccessCount > 0 ? "success" : "queued",
                      error: existingFailedCount > 0 ? `其中 ${existingFailedCount} 张未成功生成` : undefined,
                    }
                  : turn,
              ),
            };
          });
          return;
        }

        const tasks = pendingImages.map(async (pendingImage) => {
          try {
            const first = await runImageJob(
              queuedTurn.mode,
              referenceFiles,
              queuedTurn.prompt,
              queuedTurn.model,
              queuedTurn.size,
              queuedTurn.referenceStrength || "medium",
              snapshot.projectId || activeProjectId,
            );

            const nextImage: StoredImage = {
              id: pendingImage.id,
              status: "success",
              b64_json: first.b64_json,
              url: first.url,
            };

            await updateConversation(
              conversationId,
              (current) => {
                const conversation = current ?? snapshot;
                return {
                  ...conversation,
                  updatedAt: new Date().toISOString(),
                  turns: conversation.turns.map((turn) =>
                    turn.id === queuedTurn.id
                      ? {
                          ...turn,
                          images: turn.images.map((image) => (image.id === nextImage.id ? nextImage : image)),
                        }
                      : turn,
                  ),
                };
              },
              { persist: false },
            );

            return nextImage;
          } catch (error) {
            const message = error instanceof Error ? error.message : "生成失败";
            const failedImage: StoredImage = {
              id: pendingImage.id,
              status: "error",
              error: message,
            };

            await updateConversation(
              conversationId,
              (current) => {
                const conversation = current ?? snapshot;
                return {
                  ...conversation,
                  updatedAt: new Date().toISOString(),
                  turns: conversation.turns.map((turn) =>
                    turn.id === queuedTurn.id
                      ? {
                          ...turn,
                          images: turn.images.map((image) => (image.id === failedImage.id ? failedImage : image)),
                        }
                      : turn,
                  ),
                };
              },
              { persist: false },
            );

            throw error;
          }
        });

        const settled = await Promise.allSettled(tasks);
        const resumedSuccessCount = settled.filter(
          (item): item is PromiseFulfilledResult<StoredImage> => item.status === "fulfilled",
        ).length;
        const resumedFailedCount = settled.length - resumedSuccessCount;
        const existingSuccessCount = queuedTurn.images.filter((image) => image.status === "success").length;
        const existingFailedCount = queuedTurn.images.filter((image) => image.status === "error").length;
        const successCount = existingSuccessCount + resumedSuccessCount;
        const failedCount = existingFailedCount + resumedFailedCount;

        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === queuedTurn.id
                ? {
                    ...turn,
                    status: failedCount > 0 ? "error" : "success",
                    error: failedCount > 0 ? `其中 ${failedCount} 张未成功生成` : undefined,
                  }
                : turn,
            ),
          };
        });

        await loadQuota();
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成图片失败";
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === queuedTurn.id
                ? {
                    ...turn,
                    status: "error",
                    error: message,
                    images: turn.images.map((image) =>
                      image.status === "loading" ? { ...image, status: "error", error: message } : image,
                    ),
                  }
                : turn,
            ),
          };
        });
        toast.error(message);
      } finally {
        activeConversationQueueIds.delete(conversationId);
        for (const conversation of conversationsRef.current) {
          if (
            !activeConversationQueueIds.has(conversation.id) &&
            conversation.turns.some((turn) => turn.status === "queued")
          ) {
            void runConversationQueue(conversation.id);
          }
        }
      }
    },
    [activeProjectId, loadQuota, updateConversation],
  );
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const handleRetryImage = useCallback(
    async (conversationId: string, turnId: string, imageId: string) => {
      const snapshot = conversationsRef.current.find((conversation) => conversation.id === conversationId);
      const targetTurn = snapshot?.turns.find((turn) => turn.id === turnId);
      const targetImage = targetTurn?.images.find((image) => image.id === imageId);
      if (!snapshot || !targetTurn || targetImage?.status !== "error") {
        return;
      }

      await updateConversation(conversationId, (current) => {
        const conversation = current ?? snapshot;
        return {
          ...conversation,
          updatedAt: new Date().toISOString(),
          turns: conversation.turns.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  status: "queued",
                  error: undefined,
                  images: turn.images.map((image) =>
                    image.id === imageId ? { id: image.id, status: "loading" as const } : image,
                  ),
                }
              : turn,
          ),
        };
      });
      selectConversation(conversationId);
      toast.success("已重新加入生成队列");
      void runConversationQueue(conversationId);
    },
    [runConversationQueue, selectConversation, updateConversation],
  );

  const handleEnhancePrompt = useCallback(() => {
    const enhancedPrompt = enhanceImagePrompt(imagePrompt, imageMode, imageSize, referenceStrength);
    if (!enhancedPrompt) {
      toast.error("先输入一句想生成的画面，再进行增强");
      return;
    }
    if (enhancedPrompt === imagePrompt.trim()) {
      toast.info("当前提示词已经是增强格式");
      return;
    }
    setImagePrompt(enhancedPrompt);
    textareaRef.current?.focus();
    toast.success("已增强提示词");
  }, [imageMode, imagePrompt, imageSize, referenceStrength]);

  useEffect(() => {
    for (const conversation of conversations) {
      if (
        !activeConversationQueueIds.has(conversation.id) &&
        conversation.turns.some((turn) => turn.status === "queued")
      ) {
        void runConversationQueue(conversation.id);
      }
    }
  }, [conversations, runConversationQueue]);

  const handleSubmit = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error("请输入提示词");
      return;
    }

    if (imageMode === "edit" && referenceImageFiles.length === 0) {
      toast.error("请先上传参考图");
      return;
    }

    const targetConversation = selectedConversationId
      ? conversationsRef.current.find((conversation) => conversation.id === selectedConversationId) ?? null
      : null;
    const now = new Date().toISOString();
    const conversationId = targetConversation?.id ?? createId();
    const turnId = createId();
    const draftTurn: ImageTurn = {
      id: turnId,
      prompt,
      model: showImageModelSelector ? imageModel : "gpt-image-2",
      mode: imageMode,
      referenceImages: imageMode === "edit" ? referenceImages : [],
      count: parsedCount,
      size: imageSize,
      referenceStrength: imageMode === "edit" ? referenceStrength : undefined,
      images: Array.from({ length: parsedCount }, (_, index) => ({
        id: `${turnId}-${index}`,
        status: "loading" as const,
      })),
      createdAt: now,
      status: "queued",
    };

    const baseConversation: ImageConversation = targetConversation
        ? {
          ...targetConversation,
          projectId: targetConversation.projectId || activeProjectId,
          updatedAt: now,
          turns: [...targetConversation.turns, draftTurn],
        }
      : {
          id: conversationId,
          projectId: activeProjectId,
          title: buildConversationTitle(prompt),
          createdAt: now,
          updatedAt: now,
          turns: [draftTurn],
        };

    selectConversation(conversationId);
    clearComposerInputs();

    await persistConversation(baseConversation);
    void runConversationQueue(conversationId);

    const targetStats = getImageConversationStats(baseConversation);
    if (targetStats.running > 0 || targetStats.queued > 1) {
      toast.success("已加入当前对话队列");
    } else if (!targetConversation) {
      toast.success("已创建新对话并开始处理");
    } else {
      toast.success("已发送到当前对话");
    }
  };

  return (
    <>
      <section className="grid h-[calc(100vh-5.75rem)] min-h-[680px] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <div className="hidden h-full min-h-0 border-r border-slate-200 bg-slate-50/80 p-3 lg:block">
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <FolderKanban className="size-4" />
                项目空间
              </label>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                {projectConversations.length} 会话 / {activeProjectImageCount} 图
              </span>
            </div>
            <select
              value={activeProjectId}
              onChange={(event) => {
                setActiveProjectId(event.target.value);
                setIsNewConversationDraft(true);
                setSelectedConversationId(null);
                resetComposer();
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-cyan-300"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <div className="mt-2 flex gap-2">
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleCreateProject();
                  }
                }}
                placeholder="新项目名称"
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-300"
              />
              <Button
                className="h-9 rounded-lg bg-slate-950 px-3 text-white hover:bg-slate-800"
                onClick={() => void handleCreateProject()}
                disabled={isCreatingProject}
              >
                {isCreatingProject ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </Button>
            </div>
            {!activeProject?.is_default ? (
              <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                <div className="text-xs font-medium text-slate-500">当前项目管理</div>
                <div className="grid gap-2">
                  <input
                    value={projectNameDraft}
                    onChange={(event) => setProjectNameDraft(event.target.value)}
                    placeholder="项目名称"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-300"
                  />
                  <textarea
                    value={projectDescriptionDraft}
                    onChange={(event) => setProjectDescriptionDraft(event.target.value)}
                    placeholder="项目说明，例如客户、用途、版本目标"
                    rows={2}
                    className="min-h-[64px] resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="h-9 flex-1 rounded-lg border-slate-200 bg-white px-3"
                    onClick={() => void handleRenameProject()}
                    disabled={isSavingProject}
                  >
                    {isSavingProject ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    <Save className="size-4" />
                    保存
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 flex-1 rounded-lg border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50"
                    onClick={() => void handleArchiveProject()}
                    disabled={isSavingProject}
                  >
                    <Trash2 className="size-4" />
                    归档
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <ImageSidebar
            conversations={projectConversations}
            isLoadingHistory={isLoadingHistory}
            selectedConversationId={selectedConversationId}
            onCreateDraft={handleCreateDraft}
            onClearHistory={handleClearHistory}
            onSelectConversation={selectConversation}
            onDeleteConversation={handleDeleteConversation}
            formatConversationTime={formatConversationTime}
          />
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="flex h-[80vh] w-[92vw] max-w-[420px] flex-col overflow-hidden rounded-[32px] border-stone-200 bg-white p-0 shadow-2xl">
            <DialogHeader className="px-6 pt-6 pb-2">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                <History className="size-5" />
                历史记录
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
              <ImageSidebar
                conversations={projectConversations}
                isLoadingHistory={isLoadingHistory}
                selectedConversationId={selectedConversationId}
                onCreateDraft={() => {
                  handleCreateDraft();
                  setIsHistoryOpen(false);
                }}
                onClearHistory={handleClearHistory}
                onSelectConversation={(id) => {
                  selectConversation(id);
                  setIsHistoryOpen(false);
                }}
                onDeleteConversation={handleDeleteConversation}
                formatConversationTime={formatConversationTime}
                hideActionButtons
              />
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isMobileParamsOpen} onOpenChange={setIsMobileParamsOpen}>
          <DialogContent className="fixed bottom-0 top-auto flex max-h-[82vh] w-full max-w-none translate-y-0 flex-col overflow-hidden rounded-t-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:left-1/2 sm:max-w-[520px] sm:-translate-x-1/2 sm:rounded-[28px]">
            <DialogHeader className="border-b border-slate-200 px-5 pb-3 pt-5">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                <SlidersHorizontal className="size-5" />
                创作参数
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">模式</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`h-10 rounded-lg text-sm font-medium ${imageMode === "generate" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}
                      onClick={() => setImageMode("generate")}
                    >
                      文生图
                    </button>
                    <button
                      className={`h-10 rounded-lg text-sm font-medium ${imageMode === "edit" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}
                      onClick={() => setImageMode("edit")}
                    >
                      图生图
                    </button>
                  </div>
                </div>
                {showImageModelSelector ? (
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-500">模型</div>
                    <select
                      className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                      value={imageModel}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (isImageModel(value)) {
                          setImageModel(value);
                        }
                      }}
                    >
                      {IMAGE_MODELS.map((model) => (
                        <option key={model.value} value={model.value}>
                          {model.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">生成张数</div>
                  <input
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-300"
                    type="number"
                    min={1}
                    max={10}
                    value={imageCount}
                    onChange={(event) => setImageCount(event.target.value)}
                  />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">图片比例</div>
                  <div className="grid grid-cols-3 gap-2">
                    {["1:1", "16:9", "9:16", "4:3", "3:4", ""].map((size) => (
                      <button
                        key={size || "auto"}
                        className={`h-10 rounded-lg text-xs font-medium ${imageSize === size ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"}`}
                        onClick={() => setImageSize(size)}
                      >
                        {size || "自动"}
                      </button>
                    ))}
                  </div>
                </div>
                {imageMode === "edit" ? (
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-500">参考强度</div>
                    <div className="grid grid-cols-3 gap-2">
                      {REFERENCE_STRENGTH_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={`h-10 rounded-lg text-xs font-medium ${
                            referenceStrength === option.value ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"
                          }`}
                          onClick={() => setReferenceStrength(option.value)}
                        >
                          {option.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">风格预设</div>
                  <div className="grid gap-2">
                    {stylePresets.slice(0, 6).map((preset) => (
                      <button
                        key={preset.id}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50/60"
                        onClick={() => {
                          setImagePrompt((value) => appendPromptSegment(value, preset.prompt));
                          setIsMobileParamsOpen(false);
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{preset.title}</span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {preset.tag}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{preset.prompt}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex min-h-0 flex-col bg-white">
          <div className="border-b border-slate-200 bg-white/95 px-3 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                  <Sparkles className="size-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold text-slate-950 sm:text-lg">
                    {isNewConversationDraft ? "新对话" : selectedConversation?.title || "图片工作台"}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="size-3.5" />
                      {projectConversations.length} 个会话
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <FolderKanban className="size-3.5" />
                      {activeProject?.name || "默认项目"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Activity className="size-3.5" />
                      {activeTaskCount > 0
                        ? `${taskSummary.running} 处理中 / ${taskSummary.queued} 排队`
                        : "空闲"}
                    </span>
                    {taskSummary.failedImages > 0 ? (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600">
                        {taskSummary.failedImages} 张失败可重试
                      </span>
                    ) : null}
                    <span>额度 {availableQuota}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 lg:hidden">
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                  onClick={() => setIsMobileParamsOpen(true)}
                >
                  <SlidersHorizontal className="size-4" />
                  参数
                </Button>
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                  onClick={() => setIsHistoryOpen(true)}
                >
                  <History className="size-4" />
                  历史
                </Button>
                <Button
                  className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                  onClick={handleCreateDraft}
                >
                  <Plus className="size-4" />
                  新建
                </Button>
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-slate-200 bg-white px-3 text-slate-600"
                  onClick={() => void handleClearHistory()}
                  disabled={conversations.length === 0}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 lg:hidden">
              <select
                value={activeProjectId}
                onChange={(event) => {
                  setActiveProjectId(event.target.value);
                  setIsNewConversationDraft(true);
                  setSelectedConversationId(null);
                  resetComposer();
                }}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-cyan-300"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="新项目名称"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-300"
                />
                <Button
                  className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                  onClick={() => void handleCreateProject()}
                  disabled={isCreatingProject}
                >
                  {isCreatingProject ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  项目
                </Button>
              </div>
            </div>
          </div>

          <div
            ref={resultsViewportRef}
            className="hide-scrollbar min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_44%)] px-3 py-4 sm:px-6"
          >
            <ImageResults
              selectedConversation={selectedConversation}
              onOpenLightbox={openLightbox}
              onContinueEdit={handleContinueEdit}
              onRetryImage={handleRetryImage}
              formatConversationTime={formatConversationTime}
            />
          </div>

          <div className="border-t border-slate-200 bg-slate-50/90 px-3 py-3 sm:px-5">
            <ImageComposer
              mode={imageMode}
              prompt={imagePrompt}
              availableQuota={availableQuota}
              activeTaskCount={activeTaskCount}
              referenceStrength={referenceStrength}
              referenceImages={referenceImages}
              textareaRef={textareaRef}
              fileInputRef={fileInputRef}
              onPromptChange={setImagePrompt}
              onReferenceStrengthChange={setReferenceStrength}
              onEnhancePrompt={handleEnhancePrompt}
              onSubmit={handleSubmit}
              onPickReferenceImage={() => fileInputRef.current?.click()}
              onReferenceImageChange={handleReferenceImageChange}
              onRemoveReferenceImage={handleRemoveReferenceImage}
            />
          </div>
        </div>

        <aside className="hidden min-h-0 border-l border-slate-200 bg-slate-50/80 p-4 xl:flex xl:flex-col xl:gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-600">Quota</div>
                <div className="mt-1 text-lg font-semibold text-slate-950">额度状态</div>
              </div>
              <div className="grid size-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                <Gauge className="size-5" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-slate-400">总额</div>
                <div className="mt-1 font-semibold text-slate-900">{currentIdentity?.quota_limit ?? (isAdmin ? "管理" : "不限")}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-slate-400">已用</div>
                <div className="mt-1 font-semibold text-slate-900">{currentIdentity?.quota_used ?? 0}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-slate-400">剩余</div>
                <div className="mt-1 font-semibold text-slate-900">{availableQuota}</div>
              </div>
            </div>
            {currentIdentity?.quota_limit ? (
              <div className="mt-4 h-2 rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-cyan-500"
                  style={{
                    width: `${Math.min(100, Math.round(((currentIdentity.quota_used || 0) / Math.max(1, currentIdentity.quota_limit)) * 100))}%`,
                  }}
                />
              </div>
            ) : null}
          </div>

          <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-950">创作参数</div>
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-xs font-medium text-slate-500">模式</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`h-9 rounded-lg text-sm font-medium ${imageMode === "generate" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}
                    onClick={() => setImageMode("generate")}
                  >
                    文生图
                  </button>
                  <button
                    className={`h-9 rounded-lg text-sm font-medium ${imageMode === "edit" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}
                    onClick={() => setImageMode("edit")}
                  >
                    图生图
                  </button>
                </div>
              </div>
              {showImageModelSelector ? (
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">模型</div>
                  <select
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    value={imageModel}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isImageModel(value)) {
                        setImageModel(value);
                      }
                    }}
                  >
                    {IMAGE_MODELS.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.title}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {IMAGE_MODELS.find((model) => model.value === imageModel)?.description}
                  </p>
                </div>
              ) : null}
              <div>
                <div className="mb-2 text-xs font-medium text-slate-500">生成张数</div>
                <input
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-300"
                  type="number"
                  min={1}
                  max={10}
                  value={imageCount}
                  onChange={(event) => setImageCount(event.target.value)}
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-slate-500">图片比例</div>
                <div className="grid grid-cols-3 gap-2">
                  {["1:1", "16:9", "9:16", "4:3", "3:4", ""].map((size) => (
                    <button
                      key={size || "auto"}
                      className={`h-9 rounded-lg text-xs font-medium ${imageSize === size ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"}`}
                      onClick={() => setImageSize(size)}
                    >
                      {size || "自动"}
                    </button>
                  ))}
                </div>
              </div>
              {imageMode === "edit" ? (
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">参考强度</div>
                  <div className="grid grid-cols-3 gap-2">
                    {REFERENCE_STRENGTH_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        className={`h-9 rounded-lg text-xs font-medium ${
                          referenceStrength === option.value ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                        onClick={() => setReferenceStrength(option.value)}
                      >
                        {option.title}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {REFERENCE_STRENGTH_OPTIONS.find((option) => option.value === referenceStrength)?.description}
                  </p>
                </div>
              ) : null}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-slate-500">风格预设</div>
                  <div className="flex items-center gap-1">
                    <button
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-slate-950 px-2 text-xs font-medium text-white transition hover:bg-slate-800"
                      onClick={openCreatePreset}
                    >
                      <Plus className="size-3.5" />
                      新增
                    </button>
                    <button
                      className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700"
                      title="恢复默认预设"
                      onClick={resetStylePresets}
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-2">
                  {stylePresets.map((preset) => (
                    <div
                      key={preset.id}
                      className="rounded-xl border border-slate-200 bg-white transition hover:border-cyan-200 hover:bg-cyan-50/60"
                    >
                      <button
                        className="w-full p-3 text-left"
                        onClick={() => setImagePrompt((value) => appendPromptSegment(value, preset.prompt))}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{preset.title}</span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {preset.tag}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{preset.prompt}</p>
                      </button>
                      <div className="flex items-center gap-2 px-3 pb-3">
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 transition hover:border-cyan-200 hover:text-cyan-700"
                          onClick={() => openEditPreset(preset)}
                        >
                          <Pencil className="size-3.5" />
                          编辑
                        </button>
                        {!preset.builtin ? (
                          <button
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-100 bg-rose-50 px-2 text-xs font-medium text-rose-600 transition hover:border-rose-200 hover:bg-rose-100"
                            onClick={() => handleDeletePreset(preset)}
                          >
                            <Trash2 className="size-3.5" />
                            删除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <Dialog open={isPresetEditorOpen} onOpenChange={setIsPresetEditorOpen}>
        <DialogContent className="w-[92vw] max-w-[560px] rounded-2xl border-slate-200 bg-white p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-950">
              <Sparkles className="size-5 text-cyan-700" />
              {editingPreset ? "编辑风格预设" : "新增风格预设"}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
              <label className="block">
                <span className="text-xs font-medium text-slate-500">预设名称</span>
                <input
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  value={presetTitle}
                  onChange={(event) => setPresetTitle(event.target.value)}
                  placeholder="例如：高级杂志封面"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">标签</span>
                <input
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  value={presetTag}
                  onChange={(event) => setPresetTag(event.target.value)}
                  placeholder="Editorial"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">提示词片段</span>
              <textarea
                className="mt-1 min-h-32 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                value={presetPrompt}
                onChange={(event) => setPresetPrompt(event.target.value)}
                placeholder="描述这个风格会追加到提示词里的视觉要求、光影、构图和材质..."
              />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
              onClick={() => setIsPresetEditorOpen(false)}
            >
              取消
            </Button>
            <Button className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={handleSavePreset}>
              <Save className="size-4" />
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
    </>
  );
}

export default function ImagePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ImagePageContent isAdmin={session.role === "admin"} />;
}
