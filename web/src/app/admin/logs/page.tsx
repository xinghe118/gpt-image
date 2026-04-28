"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Copy, Eye, FileText, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchActivityLogSummary, fetchActivityLogs, type ActivityLog, type ActivityLogSummary } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function metadataValue(item: ActivityLog, key: string) {
  const value = item.metadata?.[key];
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  return String(value);
}

function imageCount(item: ActivityLog) {
  return metadataValue(item, "result_count") !== "--"
    ? metadataValue(item, "result_count")
    : metadataValue(item, "image_count") !== "--"
      ? metadataValue(item, "image_count")
      : metadataValue(item, "n");
}

function statusCode(item: ActivityLog) {
  return metadataValue(item, "status_code") !== "--" ? metadataValue(item, "status_code") : metadataValue(item, "http_status");
}

function LogsPageContent() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<ActivityLog[]>([]);
  const [summary, setSummary] = useState<ActivityLogSummary | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [slowOnly, setSlowOnly] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = 100;

  const loadLogs = async ({
    silent = false,
    append = false,
    statusOverride,
    eventOverride,
  }: { silent?: boolean; append?: boolean; statusOverride?: string; eventOverride?: string } = {}) => {
    if (append) {
      setIsLoadingMore(true);
    } else if (!silent) {
      setIsLoading(true);
    }
    try {
      const [logsData, summaryData] = await Promise.all([
        fetchActivityLogs({
          limit: pageSize,
          offset: append ? items.length : 0,
          status: statusOverride ?? status,
          event: eventOverride ?? eventFilter,
          model: modelFilter.trim(),
          role: roleFilter,
          min_duration_ms: slowOnly ? 30000 : undefined,
          q: query.trim(),
        }),
        fetchActivityLogSummary(),
      ]);
      setItems((current) => (append ? [...current, ...logsData.items] : logsData.items));
      setHasMore(logsData.has_more);
      setSummary(summaryData.summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载日志失败");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadLogs();
  }, []);

  const eventOptions = useMemo(() => Object.entries(summary?.by_event || {}).slice(0, 6), [summary]);

  const copyLogDetail = async (item: ActivityLog) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
      toast.success("日志详情已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[45vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <section className="page-shell-wide space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
              <FileText className="size-4" />
              活动日志
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">日志中心</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">查看 API 调用、失败原因、耗时和用户访问痕迹，敏感内容已摘要化。</p>
          </div>
          <Button className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => void loadLogs({ silent: true })}>
            <RefreshCw className="size-4" />
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="最近日志" value={summary?.total ?? 0} icon={FileText} tone="slate" />
        <Metric label="失败数" value={summary?.failures ?? 0} icon={AlertTriangle} tone="rose" />
        <Metric label="成功率" value={summary?.success_rate == null ? "--" : `${summary.success_rate}%`} icon={CheckCircle2} tone="emerald" />
        <Metric label="平均耗时" value={summary?.avg_duration_ms == null ? "--" : `${summary.avg_duration_ms}ms`} icon={Clock3} tone="cyan" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索事件、路由、模型、错误"
              className="h-10 rounded-lg border-slate-200 pl-9"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void loadLogs({ silent: true });
                }
              }}
            />
          </div>
          <div className="flex gap-2">
            {[
              ["", "全部"],
              ["ok", "成功"],
              ["error", "失败"],
              ["accepted", "流式"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setStatus(value);
                  void loadLogs({ silent: true, statusOverride: value });
                }}
                className={cn(
                  "h-10 rounded-lg px-3 text-sm font-medium transition",
                  status === value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" onClick={() => void loadLogs({ silent: true })}>
            应用筛选
          </Button>
        </div>

        {eventOptions.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setEventFilter("");
                void loadLogs({ silent: true, eventOverride: "" });
              }}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition",
                eventFilter === "" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              全部事件
            </button>
            {eventOptions.map(([event, count]) => (
              <button
                key={event}
                type="button"
                onClick={() => {
                  setEventFilter(event);
                  void loadLogs({ silent: true, eventOverride: event });
                }}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium transition",
                  eventFilter === event ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {event} · {count}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mb-4 grid gap-3 lg:grid-cols-[180px_160px_160px_auto]">
          <Input
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
            placeholder="模型过滤"
            className="h-10 rounded-lg border-slate-200"
          />
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-cyan-300"
          >
            <option value="">全部角色</option>
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
          <button
            type="button"
            onClick={() => setSlowOnly((value) => !value)}
            className={cn(
              "h-10 rounded-lg px-3 text-sm font-medium transition",
              slowOnly ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            只看慢请求 &gt; 30s
          </button>
          <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" onClick={() => void loadLogs({ silent: true })}>
            应用高级筛选
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="hidden grid-cols-[150px_150px_80px_120px_130px_90px_minmax(0,1fr)_90px_80px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 lg:grid">
            <div>时间</div>
            <div>事件</div>
            <div>状态</div>
            <div>用户 / 角色</div>
            <div>模型</div>
            <div>图片</div>
            <div>摘要 / 错误</div>
            <div>耗时</div>
            <div>详情</div>
          </div>
          <div className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">暂无日志</div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="grid gap-2 px-4 py-4 text-sm lg:grid-cols-[150px_150px_80px_120px_130px_90px_minmax(0,1fr)_90px_80px] lg:items-center lg:gap-3">
                  <div className="text-slate-500">{formatTime(item.created_at)}</div>
                  <div className="font-medium text-slate-900">{item.event}</div>
                  <div>
                    <Badge variant={item.status === "ok" ? "success" : item.status === "accepted" ? "info" : "danger"}>
                      {item.status}
                    </Badge>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-700">{item.subject_id || "--"}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.role || "unknown"}</div>
                  </div>
                  <div className="text-slate-500">{item.model || "--"}</div>
                  <div className="text-slate-500">{imageCount(item)}</div>
                  <div className="min-w-0">
                    <div className="truncate text-slate-700">{item.error || item.prompt_preview || item.route || "--"}</div>
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {item.route || "--"} · HTTP {statusCode(item)}
                    </div>
                  </div>
                  <div className={cn("text-slate-500", (item.duration_ms || 0) >= 30000 ? "font-semibold text-amber-600" : "")}>
                    {item.duration_ms == null ? "--" : `${item.duration_ms}ms`}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700"
                      onClick={() => setSelectedLog(item)}
                      title="查看详情"
                    >
                      <Eye className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700"
                      onClick={() => void copyLogDetail(item)}
                      title="复制详情"
                    >
                      <Copy className="size-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        {hasMore ? (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" disabled={isLoadingMore} onClick={() => void loadLogs({ append: true, silent: true })}>
              {isLoadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}
              加载更多
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-h-[86vh] w-[92vw] max-w-3xl overflow-y-auto rounded-2xl border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5" />
              日志详情
            </DialogTitle>
          </DialogHeader>
          {selectedLog ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Info label="时间" value={formatTime(selectedLog.created_at)} />
                <Info label="事件" value={selectedLog.event} />
                <Info label="状态" value={selectedLog.status} />
                <Info label="路由" value={selectedLog.route || "--"} />
                <Info label="模型" value={selectedLog.model || "--"} />
                <Info label="耗时" value={selectedLog.duration_ms == null ? "--" : `${selectedLog.duration_ms}ms`} />
                <Info label="用户" value={selectedLog.subject_id || "--"} />
                <Info label="角色" value={selectedLog.role || "--"} />
                <Info label="状态码" value={statusCode(selectedLog)} />
                <Info label="项目" value={metadataValue(selectedLog, "project_id")} />
                <Info label="图片数" value={imageCount(selectedLog)} />
                <Info label="流式" value={metadataValue(selectedLog, "stream")} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-400">提示词 / 摘要</div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{selectedLog.prompt_preview || "--"}</p>
              </div>
              {selectedLog.error ? (
                <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
                  <div className="text-xs font-semibold uppercase text-rose-500">错误信息</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-rose-700">{selectedLog.error}</p>
                </div>
              ) : null}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">Metadata JSON</div>
                  <Button variant="outline" className="h-8 rounded-lg border-slate-200 bg-white text-xs" onClick={() => void copyLogDetail(selectedLog)}>
                    <Copy className="size-3.5" />
                    复制
                  </Button>
                </div>
                <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                  {JSON.stringify(selectedLog.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: typeof FileText; tone: "slate" | "rose" | "emerald" | "cyan" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-700",
    rose: "bg-rose-50 text-rose-700",
    emerald: "bg-emerald-50 text-emerald-700",
    cyan: "bg-cyan-50 text-cyan-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={cn("mb-4 inline-flex size-10 items-center justify-center rounded-lg", tones[tone])}>
        <Icon className="size-5" />
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

export default function AdminLogsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return <LogsPageContent />;
}
