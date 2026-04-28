"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Clock, FolderKanban, ImageIcon, Images, LoaderCircle, MessageSquareText, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  fetchLibraryItems,
  fetchProjects,
  moveConversationToProject,
  type LibraryImageItem,
  type ProjectItem,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";
import { listImageConversations, type ImageConversation } from "@/store/image-conversations";

const ACTIVE_PROJECT_STORAGE_KEY = "gpt-image:active_project_id";

function formatTime(value?: string) {
  if (!value) {
    return "暂无";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getInitialProjectId() {
  if (typeof window === "undefined") {
    return "default";
  }
  const queryId = new URLSearchParams(window.location.search).get("project_id");
  return queryId || window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || "default";
}

export default function ProjectDetailPage() {
  const router = useRouter();
  const { isCheckingAuth, session } = useAuthGuard();
  const [projectId, setProjectId] = useState("default");
  const [project, setProject] = useState<ProjectItem | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryImageItem[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [conversationMoveTargets, setConversationMoveTargets] = useState<Record<string, string>>({});
  const [movingConversationId, setMovingConversationId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setProjectId(getInitialProjectId());
  }, []);

  useEffect(() => {
    if (isCheckingAuth || !session) {
      return;
    }
    let cancelled = false;
    const loadProject = async () => {
      setIsLoading(true);
      try {
        const [projectData, libraryData, conversationItems] = await Promise.all([
          fetchProjects(),
          fetchLibraryItems({ project_id: projectId, limit: 12 }),
          listImageConversations(),
        ]);
        if (cancelled) {
          return;
        }
        const nextProject = projectData.items.find((item) => item.id === projectId) || null;
        setProjects(projectData.items);
        setProject(nextProject);
        setLibraryItems(libraryData.items);
        setConversations(conversationItems.filter((item) => (item.projectId || item.project_id || "default") === projectId));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取项目详情失败");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void loadProject();
    return () => {
      cancelled = true;
    };
  }, [isCheckingAuth, projectId, session]);

  const openWorkbench = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
    }
    router.push("/image/");
  };

  const openLibrary = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
    }
    router.push(`/library/?project_id=${encodeURIComponent(projectId)}`);
  };

  const moveConversation = async (conversation: ImageConversation) => {
    const targetProjectId = conversationMoveTargets[conversation.id] || projectId;
    if (!targetProjectId || targetProjectId === projectId) {
      toast.error("请选择另一个目标项目");
      return;
    }
    setMovingConversationId(conversation.id);
    try {
      await moveConversationToProject(conversation.id, targetProjectId);
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      toast.success("会话已移动到目标项目");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移动会话失败");
    } finally {
      setMovingConversationId("");
    }
  };

  if (isCheckingAuth || !session || isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!project) {
    return (
      <section className="page-shell">
        <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
          <div>
            <FolderKanban className="mx-auto size-10 text-slate-300" />
            <div className="mt-4 text-lg font-semibold text-slate-950">项目不存在或无权访问</div>
            <Button className="mt-4 rounded-lg bg-slate-950 text-white" onClick={() => router.push("/projects/")}>
              返回项目总览
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-950"
          onClick={() => router.push("/projects/")}
        >
          <ArrowLeft className="size-4" />
          项目总览
        </button>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
              <FolderKanban className="size-4" />
              PROJECT DETAIL
            </div>
            <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-950">{project.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              {project.description || "暂无项目说明，可以在工作台左侧为项目补充客户、用途和版本目标。"}
            </p>
            {session.role === "admin" ? (
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                所属用户：{project.subject_name || project.subject_id || "未知"}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button className="rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={openWorkbench}>
                <Sparkles className="size-4" />
                进入项目工作台
              </Button>
              <Button variant="outline" className="rounded-lg border-slate-200 bg-white" onClick={openLibrary}>
                <ImageIcon className="size-4" />
                查看项目作品
              </Button>
            </div>
          </div>
          <div
            className={cn(
              "grid aspect-[16/10] place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100",
              project.cover_url ? "p-0" : "p-6",
            )}
          >
            {project.cover_url ? (
              <img src={project.cover_url} alt={project.name} className="h-full w-full object-cover" />
            ) : (
              <div className="text-center text-slate-400">
                <Images className="mx-auto size-10" />
                <div className="mt-2 text-sm">生成作品后自动显示封面</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="会话" value={project.conversation_count || conversations.length} icon={<MessageSquareText className="size-4" />} />
        <Stat label="作品" value={project.image_count || libraryItems.length} icon={<Images className="size-4" />} />
        <Stat label="最近活动" value={formatTime(project.last_activity_at || project.updated_at)} icon={<Clock className="size-4" />} />
        <Stat label="项目总数" value={projects.length} icon={<FolderKanban className="size-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">最近作品</h2>
              <p className="mt-1 text-sm text-slate-500">项目内生成的图片会自动汇总到这里。</p>
            </div>
            <Button variant="outline" className="rounded-lg border-slate-200 bg-white" onClick={openLibrary}>
              全部作品
            </Button>
          </div>
          {libraryItems.length === 0 ? (
            <div className="mt-4 grid min-h-[260px] place-items-center rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-500">
              暂无作品
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {libraryItems.slice(0, 6).map((item) => (
                <article key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="aspect-square bg-slate-100">
                    <img src={item.thumb_url || item.image_url} alt={item.prompt} className="h-full w-full object-cover" />
                  </div>
                  <div className="p-3">
                    <div className="line-clamp-2 text-sm font-medium text-slate-900">{item.prompt || "未命名作品"}</div>
                    <div className="mt-2 text-xs text-slate-400">{formatTime(item.created_at)}</div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">最近会话</h2>
            <div className="mt-3 space-y-2">
              {conversations.slice(0, 6).map((conversation) => (
                <div
                  key={conversation.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-cyan-200 hover:bg-cyan-50/60"
                >
                  <button type="button" className="w-full text-left" onClick={openWorkbench}>
                    <div className="line-clamp-1 text-sm font-medium text-slate-900">{conversation.title || "未命名会话"}</div>
                    <div className="mt-1 text-xs text-slate-400">{formatTime(conversation.updatedAt)}</div>
                  </button>
                  <div className="mt-3 flex gap-2">
                    <select
                      value={conversationMoveTargets[conversation.id] || projectId}
                      onChange={(event) =>
                        setConversationMoveTargets((value) => ({
                          ...value,
                          [conversation.id]: event.target.value,
                        }))
                      }
                      className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-cyan-300"
                    >
                      {projects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      className="h-9 rounded-lg border-slate-200 bg-white px-3 text-xs"
                      onClick={() => void moveConversation(conversation)}
                      disabled={movingConversationId === conversation.id}
                    >
                      {movingConversationId === conversation.id ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                      移动
                    </Button>
                  </div>
                </div>
              ))}
              {conversations.length === 0 ? <div className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">暂无会话</div> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{label}</div>
        <div className="grid size-8 place-items-center rounded-lg bg-cyan-50 text-cyan-700">{icon}</div>
      </div>
      <div className="mt-3 truncate text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}
