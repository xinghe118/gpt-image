"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  FolderKanban,
  ImageIcon,
  Images,
  LayoutGrid,
  List,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createProject, fetchProjectSummary, fetchProjects, type ProjectItem, type ProjectSummary } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

const ACTIVE_PROJECT_STORAGE_KEY = "gpt-image:active_project_id";
const PROJECT_PAGE_SIZE = 48;
type ProjectFilter = "all" | "active" | "with_images" | "empty";
type ProjectView = "table" | "card";

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
  const [newDescription, setNewDescription] = useState("");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [viewMode, setViewMode] = useState<ProjectView>("table");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isOwnerStatsOpen, setIsOwnerStatsOpen] = useState(false);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const loadProjects = useCallback(async ({ append = false, offset = 0 }: { append?: boolean; offset?: number } = {}) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    try {
      const [projectData, summaryData] = await Promise.all([
        fetchProjects({ limit: PROJECT_PAGE_SIZE, offset: append ? offset : 0 }),
        fetchProjectSummary(),
      ]);
      setProjects((current) => (append ? [...current, ...projectData.items] : projectData.items));
      setHasMore(projectData.has_more);
      setSummary(summaryData.summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取项目失败");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (isCheckingAuth || !session) {
      return;
    }
    void loadProjects();
  }, [isCheckingAuth, loadProjects, session]);

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesKeyword =
        !keyword || [project.name, project.description, project.subject_name].join(" ").toLowerCase().includes(keyword);
      const matchesFilter =
        projectFilter === "all" ||
        (projectFilter === "active" && !project.archived) ||
        (projectFilter === "with_images" && (project.image_count || 0) > 0) ||
        (projectFilter === "empty" && (project.image_count || 0) === 0);
      return matchesKeyword && matchesFilter;
    });
  }, [projectFilter, projects, query]);

  const totals = useMemo(
    () => {
      if (summary) {
        return {
          projects: summary.total_projects,
          images: summary.total_images,
          conversations: summary.total_conversations,
          archived: summary.archived_projects,
        };
      }
      return projects.reduce(
        (acc, project) => {
          acc.projects += 1;
          acc.images += project.image_count || 0;
          acc.conversations += project.conversation_count || 0;
          return acc;
        },
        { projects: 0, images: 0, conversations: 0, archived: 0 },
      );
    },
    [projects, summary],
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
      const data = await createProject({ name, description: newDescription.trim() || undefined });
      setProjects(data.items);
      setHasMore(false);
      void fetchProjectSummary().then((summaryData) => setSummary(summaryData.summary)).catch(() => undefined);
      setNewName("");
      setNewDescription("");
      setIsCreateOpen(false);
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
              {session.role === "admin" ? "管理员可查看项目、会话数量和作品数量统计。" : "按项目整理你的会话、作品和创作上下文。"}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="项目" value={totals.projects} />
            <Stat label="会话" value={totals.conversations} />
            <Stat label="作品" value={totals.images} />
            <Stat label="归档" value={totals.archived} />
          </div>
        </div>
      </div>

      {session.role === "admin" && summary?.owners?.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">用户项目分布</h2>
              <p className="text-sm text-slate-500">用于商用运营时快速查看每个用户的项目、作品和会话数量占比。</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-400">最近活动：{formatTime(summary.latest_activity_at)}</div>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-slate-200 bg-white"
                onClick={() => setIsOwnerStatsOpen((value) => !value)}
              >
                {isOwnerStatsOpen ? "收起" : "展开"}
                <ChevronDown className={cn("size-4 transition", isOwnerStatsOpen ? "rotate-180" : "")} />
              </Button>
            </div>
          </div>
          {isOwnerStatsOpen ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {summary.owners.slice(0, 8).map((owner) => (
                <div key={owner.subject_id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="truncate text-sm font-semibold text-slate-900">{owner.subject_name || owner.subject_id}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    <Stat label="项目" value={owner.project_count} compact />
                    <Stat label="作品" value={owner.image_count} compact />
                    <Stat label="会话数" value={owner.conversation_count} compact />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {summary.owners.slice(0, 6).map((owner) => (
                <Badge key={owner.subject_id} variant="outline" className="rounded-lg bg-slate-50 px-3 py-1 text-slate-600">
                  {owner.subject_name || owner.subject_id}：{owner.project_count} 项目 / {owner.image_count} 作品
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目名称、说明或用户"
              className="h-10 rounded-lg border-slate-200 pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            {[
              ["all", "全部"],
              ["active", "活跃"],
              ["with_images", "有作品"],
              ["empty", "空项目"],
            ].map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={projectFilter === value ? "default" : "outline"}
                className={cn(
                  "h-10 rounded-lg",
                  projectFilter === value ? "bg-slate-950 text-white hover:bg-slate-800" : "border-slate-200 bg-white",
                )}
                onClick={() => setProjectFilter(value as ProjectFilter)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <Button
              type="button"
              variant="ghost"
              className={cn("h-8 rounded-md", viewMode === "table" ? "bg-white shadow-sm" : "text-slate-500")}
              onClick={() => setViewMode("table")}
            >
              <List className="size-4" />
              表格
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn("h-8 rounded-md", viewMode === "card" ? "bg-white shadow-sm" : "text-slate-500")}
              onClick={() => setViewMode("card")}
            >
              <LayoutGrid className="size-4" />
              卡片
            </Button>
          </div>
          <Button className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => setIsCreateOpen(true)}>
            <Plus className="size-4" />
            新建项目
          </Button>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="rounded-2xl border-slate-200 bg-white">
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
              <DialogDescription>项目创建后会立即进入独立工作台，后续会话和作品只归属当前项目。</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    void handleCreateProject();
                  }
                }}
                placeholder="项目名称"
                className="h-11 rounded-lg border-slate-200"
              />
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="项目说明，例如客户、用途或版本目标"
                rows={4}
                className="min-h-28 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-lg border-slate-200 bg-white" onClick={() => setIsCreateOpen(false)}>
                取消
              </Button>
              <Button type="button" className="rounded-lg bg-slate-950 text-white hover:bg-slate-800" disabled={isCreating} onClick={() => void handleCreateProject()}>
                {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                创建项目
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="mt-3 text-xs text-slate-400">
          当前显示 {filteredProjects.length} 个项目，仅展示项目归属和会话数量统计。
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
      ) : viewMode === "table" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">项目</th>
                  {session.role === "admin" ? <th className="px-4 py-3">用户</th> : null}
                  <th className="px-4 py-3">作品</th>
                  <th className="px-4 py-3">会话数量</th>
                  <th className="px-4 py-3">最近活动</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProjects.map((project) => (
                  <tr key={project.id} className="align-middle transition hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => openProjectDetail(project)}>
                        <span className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100">
                          {project.cover_url ? (
                            <img src={project.cover_url} alt={project.name} className="h-full w-full object-cover" />
                          ) : (
                            <Images className="size-5 text-slate-300" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-semibold text-slate-950">{project.name}</span>
                            {project.is_default ? <Badge variant="secondary" className="shrink-0">默认</Badge> : null}
                          </span>
                          <span className="mt-1 line-clamp-1 text-xs text-slate-500">{project.description || "暂无项目说明"}</span>
                        </span>
                      </button>
                    </td>
                    {session.role === "admin" ? (
                      <td className="px-4 py-3 text-slate-600">{project.subject_name || project.subject_id || "未知"}</td>
                    ) : null}
                    <td className="px-4 py-3 font-semibold text-slate-950">{project.image_count || 0}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">{project.conversation_count || 0}</td>
                    <td className="px-4 py-3 text-slate-500">{formatTime(project.last_activity_at)}</td>
                    <td className="px-4 py-3">
                      {project.archived ? (
                        <Badge variant="warning">已归档</Badge>
                      ) : (
                        <Badge variant={project.image_count ? "success" : "outline"}>{project.image_count ? "有作品" : "待创作"}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" className="h-9 rounded-lg border-slate-200 bg-white" onClick={() => openProject(project, "image")}>
                          <Sparkles className="size-4" />
                          工作台
                        </Button>
                        <Button variant="outline" className="h-9 rounded-lg border-slate-200 bg-white" onClick={() => openProject(project, "library")}>
                          <ImageIcon className="size-4" />
                          作品
                        </Button>
                        <Button className="h-9 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => openProjectDetail(project)}>
                          详情
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  <Stat label="会话数" value={project.conversation_count || 0} compact />
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

      {!isLoading && hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="rounded-lg border-slate-200 bg-white"
            onClick={() => void loadProjects({ append: true, offset: projects.length })}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}
            加载更多项目
          </Button>
        </div>
      ) : null}
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
