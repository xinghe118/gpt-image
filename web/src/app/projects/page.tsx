"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderKanban, ImageIcon, Images, LoaderCircle, Plus, Search, Sparkles, SquareArrowOutUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createProject, fetchProjects, type ProjectItem } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

const ACTIVE_PROJECT_STORAGE_KEY = "gpt-image:active_project_id";

function formatTime(value?: string) {
  if (!value) {
    return "暂无活动";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无活动";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function ProjectsPage() {
  const router = useRouter();
  const { isCheckingAuth, session } = useAuthGuard();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const data = await fetchProjects();
      setProjects(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取项目失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isCheckingAuth || !session) {
      return;
    }
    void loadProjects();
  }, [isCheckingAuth, session]);

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return projects;
    }
    return projects.filter((project) =>
      [project.name, project.description, project.subject_name].join(" ").toLowerCase().includes(keyword),
    );
  }, [projects, query]);

  const totals = useMemo(
    () =>
      projects.reduce(
        (acc, project) => {
          acc.projects += 1;
          acc.images += project.image_count || 0;
          acc.conversations += project.conversation_count || 0;
          return acc;
        },
        { projects: 0, images: 0, conversations: 0 },
      ),
    [projects],
  );

  const openProject = (project: ProjectItem, target: "image" | "library") => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, project.id);
    }
    router.push(target === "image" ? "/image/" : `/library/?project_id=${encodeURIComponent(project.id)}`);
  };

  const openProjectDetail = (project: ProjectItem) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, project.id);
    }
    router.push(`/projects/detail/?project_id=${encodeURIComponent(project.id)}`);
  };

  const handleCreateProject = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("请输入项目名称");
      return;
    }
    setIsCreating(true);
    try {
      const data = await createProject({ name });
      setProjects(data.items);
      setNewName("");
      toast.success("项目已创建");
      openProject(data.item, "image");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建项目失败");
    } finally {
      setIsCreating(false);
    }
  };

  if (isCheckingAuth || !session) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <section className="page-shell space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
              <FolderKanban className="size-4" />
              PROJECT SPACE
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">项目总览</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {session.role === "admin" ? "管理员可查看所有用户的项目、会话和作品统计。" : "按项目整理你的会话、作品和创作上下文。"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="项目" value={totals.projects} />
            <Stat label="会话" value={totals.conversations} />
            <Stat label="作品" value={totals.images} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目名称、说明或用户"
              className="h-10 rounded-lg border-slate-200 pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCreateProject();
                }
              }}
              placeholder="新项目名称"
              className="h-10 rounded-lg border-slate-200"
            />
            <Button className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800" disabled={isCreating} onClick={() => void handleCreateProject()}>
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              创建
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid min-h-[360px] place-items-center rounded-2xl border border-slate-200 bg-white">
          <LoaderCircle className="size-5 animate-spin text-slate-400" />
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
          <div className="max-w-sm px-6">
            <FolderKanban className="mx-auto size-10 text-slate-300" />
            <div className="mt-4 text-lg font-semibold text-slate-950">还没有项目</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">创建一个项目后，相关会话和作品会集中显示在这里。</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((project) => (
            <article key={project.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className={cn(
                  "grid aspect-[16/9] w-full place-items-center overflow-hidden bg-slate-100",
                  project.cover_url ? "cursor-zoom-in" : "cursor-pointer",
                )}
                onClick={() => openProjectDetail(project)}
              >
                {project.cover_url ? (
                  <img src={project.cover_url} alt={project.name} className="h-full w-full object-cover transition hover:scale-[1.02]" />
                ) : (
                  <div className="grid size-16 place-items-center rounded-2xl bg-white text-slate-300 shadow-sm">
                    <Images className="size-8" />
                  </div>
                )}
              </button>
              <div className="space-y-4 p-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="line-clamp-1 text-lg font-semibold text-slate-950">{project.name}</h2>
                    {project.is_default ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">默认</span>
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[40px] text-sm leading-5 text-slate-500">
                    {project.description || "暂无项目说明。"}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="会话" value={project.conversation_count || 0} compact />
                  <Stat label="作品" value={project.image_count || 0} compact />
                  <Stat label="最近" value={formatTime(project.last_activity_at)} compact />
                </div>
                {session.role === "admin" ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    用户：{project.subject_name || project.subject_id || "未知"}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button className="h-10 flex-1 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => openProject(project, "image")}>
                    <Sparkles className="size-4" />
                    进入工作台
                  </Button>
                  <Button variant="outline" className="h-10 flex-1 rounded-lg border-slate-200 bg-white" onClick={() => openProject(project, "library")}>
                    <ImageIcon className="size-4" />
                    查看作品
                  </Button>
                </div>
                <Button variant="outline" className="h-10 w-full rounded-lg border-slate-200 bg-white" onClick={() => openProjectDetail(project)}>
                  <SquareArrowOutUpRight className="size-4" />
                  项目详情
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, compact = false }: { label: string; value: number | string; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl bg-slate-50", compact ? "px-2 py-2" : "px-4 py-3")}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={cn("mt-1 font-semibold text-slate-950", compact ? "text-sm" : "text-lg")}>{value}</div>
    </div>
  );
}
