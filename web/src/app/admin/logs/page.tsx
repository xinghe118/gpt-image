"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Eye,
  FileText,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
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

function statusLabel(status: string) {
  if (status === "ok") {
    return "成功";
  }
  if (status === "accepted") {
    return "处理中";
  }
  if (status === "error") {
    return "失败";
  }
  return status || "--";
}

function errorCategory(item: ActivityLog) {
  const text = `${item.error || ""} ${item.prompt_preview || ""} ${statusCode(item)}`.toLowerCase();
  if (item.status !== "error" && !item.error) {
    return "正常";
  }
  if (text.includes("524") || text.includes("timeout") || text.includes("timed out")) {
    return "上游超时";
  }
  if (text.includes("401") || text.includes("unauthorized") || text.includes("invalid") || text.includes("auth")) {
    return "账号认证";
  }
  if (text.includes("quota") || text.includes("rate limit") || text.includes("429") || text.includes("额度")) {
    return "额度/限流";
  }
  if (text.includes("image") && (text.includes("download") || text.includes("fetch") || text.includes("url"))) {
    return "图片链路";
  }
  if (text.includes("proxy") || text.includes("connect") || text.includes("network")) {
    return "网络代理";
  }
  if (text.includes("400") || text.includes("parameter") || text.includes("required")) {
    return "参数错误";
  }
  if (text.includes("500") || text.includes("502") || text.includes("503") || text.includes("522")) {
    return "服务异常";
  }
  return "未知错误";
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
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
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0);
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = 100;

  const loadLogs = useCallback(async ({
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
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载日志失败");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [eventFilter, items.length, modelFilter, query, roleFilter, slowOnly, status]);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!autoRefreshSeconds) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadLogs({ silent: true });
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshSeconds, loadLogs]);

  const eventOptions = useMemo(() => Object.entries(summary?.by_event || {}).slice(0, 6), [summary]);

  const failureCategories = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      if (item.status === "error" || item.error) {
        const category = errorCategory(item);
        counts.set(category, (counts.get(category) || 0) + 1);
      }
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [items]);

  const slowRequests = useMemo(
    () => items.filter((item) => (item.duration_ms || 0) >= 30000).sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0)).slice(0, 6),
    [items],
  );

  const copyLogDetail = async (item: ActivityLog) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
      toast.success("日志详情已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const exportVisibleLogs = () => {
    const headers = ["time", "event", "status", "category", "subject", "role", "model", "route", "status_code", "duration_ms", "image_count", "summary", "error"];
    const rows = items.map((item) => [
      item.created_at,
      item.event,
      item.status,
      errorCategory(item),
      item.subject_id,
      item.role,
      item.model,
      item.route,
      statusCode(item),
      item.duration_ms ?? "",
      imageCount(item),
      item.prompt_preview,
      item.error,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gpt-image-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[45vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <section className="page-shell-wide space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
              <FileText className="size-4" />
              活动日志
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">日志中心</h1>
              <p className="text-sm leading-6 text-slate-500">查看 API 调用、失败原因、耗时和用户访问痕迹。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={autoRefreshSeconds}
              onChange={(event) => setAutoRefreshSeconds(Number(event.target.value))}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-cyan-300"
            >
              <option value={0}>自动刷新：关闭</option>
              <option value={10}>自动刷新：10s</option>
              <option value={30}>自动刷新：30s</option>
              <option value={60}>自动刷新：60s</option>
            </select>
            <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" onClick={exportVisibleLogs}>
              <Download className="size-4" />
              导出
            </Button>
            <Button className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => void loadLogs({ silent: true })}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="size-4 text-emerald-500" />
          日志详情已默认摘要化，密钥、token 和敏感参数不在列表中展示。
          {lastRefreshAt ? <span>最后刷新：{formatTime(lastRefreshAt)}</span> : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="最近日志" value={summary?.total ?? 0} icon={FileText} tone="slate" />
        <Metric label="失败数" value={summary?.failures ?? 0} icon={AlertTriangle} tone="rose" />
        <Metric label="成功率" value={summary?.success_rate == null ? "--" : `${summary.success_rate}%`} icon={CheckCircle2} tone="emerald" />
        <Metric label="平均耗时" value={summary?.avg_duration_ms == null ? "--" : `${summary.avg_duration_ms}ms`} icon={Clock3} tone="cyan" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">失败原因归类</h2>
              <p className="mt-1 text-xs text-slate-500">按当前列表自动识别常见故障类型。</p>
            </div>
            <AlertTriangle className="size-5 text-rose-500" />
          </div>
          <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-1">
            {failureCategories.length ? (
              failureCategories.map(([category, count]) => (
                <button
                  key={category}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left transition hover:border-rose-200 hover:bg-rose-50"
                  onClick={() => {
                    setStatus("error");
                    void loadLogs({ silent: true, statusOverride: "error" });
                  }}
                >
                  <span className="text-sm font-medium text-slate-800">{category}</span>
                  <Badge variant="danger">{count}</Badge>
                </button>
              ))
            ) : (
              <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">当前列表暂无失败日志。</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">慢请求 Top</h2>
              <p className="mt-1 text-xs text-slate-500">展示当前列表中超过 30 秒的请求。</p>
            </div>
            <TimerReset className="size-5 text-amber-500" />
          </div>
          <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
            {slowRequests.length ? (
              slowRequests.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 text-left transition hover:border-amber-200 hover:bg-amber-50"
                  onClick={() => setSelectedLog(item)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{item.event}</span>
                    <span className="block truncate text-xs text-slate-500">{item.model || "--"} · {item.route || "--"}</span>
                  </span>
                  <span className="font-semibold text-amber-600">{item.duration_ms}ms</span>
                </button>
              ))
            ) : (
              <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">当前列表没有超过 30 秒的请求。</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索提示词、错误、用户或模型"
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

        <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-600">
            更多筛选
          </summary>
          {eventOptions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setEventFilter("");
                  void loadLogs({ silent: true, eventOverride: "" });
                }}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium transition",
                  eventFilter === "" ? "bg-slate-950 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
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
                    eventFilter === event ? "bg-slate-950 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {event} · {count}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 lg:grid-cols-[180px_160px_160px_minmax(180px,1fr)]">
            <Input
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
              placeholder="模型过滤"
              className="h-10 rounded-lg border-slate-200 bg-white"
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
                slowOnly ? "bg-amber-500 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
              )}
            >
              只看慢请求 &gt; 30s
            </button>
            <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" onClick={() => void loadLogs({ silent: true })}>
              <Filter className="size-4" />
              应用高级筛选
            </Button>
          </div>
        </details>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="hidden grid-cols-[132px_118px_150px_120px_64px_minmax(0,1fr)_100px_44px] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 lg:grid">
            <div>时间</div>
            <div>结果</div>
            <div>用户</div>
            <div>模型</div>
            <div>图片</div>
            <div>摘要 / 错误</div>
            <div>耗时</div>
            <div>操作</div>
          </div>
          <div className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">暂无日志</div>
            ) : (
              items.map((item) => {
                const category = errorCategory(item);
                return (
                  <div key={item.id} className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[132px_118px_150px_120px_64px_minmax(0,1fr)_100px_44px] lg:items-center lg:gap-4">
                    <div className="text-slate-500">{formatTime(item.created_at)}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={item.status === "ok" ? "success" : item.status === "accepted" ? "info" : "danger"}>
                        {statusLabel(item.status)}
                      </Badge>
                      {category !== "正常" ? <Badge variant="warning">{category}</Badge> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-700">{item.subject_id || "--"}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.role || "unknown"}</div>
                    </div>
                    <div className="truncate text-slate-500">{item.model || "--"}</div>
                    <div className="text-slate-500">{imageCount(item)}</div>
                    <div className="min-w-0">
                      <div className="truncate text-slate-800">{item.error || item.prompt_preview || item.event || "--"}</div>
                    </div>
                    <div className={cn("text-slate-500", (item.duration_ms || 0) >= 30000 ? "font-semibold text-amber-600" : "")}>
                      {item.duration_ms == null ? "--" : `${item.duration_ms}ms`}
                    </div>
                    <div className="flex items-center">
                      <button
                        type="button"
                        className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700"
                        onClick={() => setSelectedLog(item)}
                        title="查看详情"
                      >
                        <Eye className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })
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
        <DialogContent className="!left-auto !right-0 !top-0 h-dvh max-h-dvh w-[min(92vw,720px)] !translate-x-0 !translate-y-0 overflow-y-auto rounded-none border-y-0 border-r-0 border-slate-200 bg-white p-6 sm:rounded-l-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5" />
              日志详情抽屉
            </DialogTitle>
          </DialogHeader>
          {selectedLog ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={selectedLog.status === "ok" ? "success" : selectedLog.status === "accepted" ? "info" : "danger"}>
                    {selectedLog.status}
                  </Badge>
                  <Badge variant={errorCategory(selectedLog) === "正常" ? "outline" : "warning"}>{errorCategory(selectedLog)}</Badge>
                  <span className="text-xs text-slate-500">ID：{selectedLog.id}</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="时间" value={formatTime(selectedLog.created_at)} />
                <Info label="事件" value={selectedLog.event} />
                <Info label="状态" value={selectedLog.status} />
                <Info label="失败归类" value={errorCategory(selectedLog)} />
                <Info label="路由" value={selectedLog.route || "--"} />
                <Info label="模型" value={selectedLog.model || "--"} />
                <Info label="耗时" value={selectedLog.duration_ms == null ? "--" : `${selectedLog.duration_ms}ms`} />
                <Info label="用户" value={selectedLog.subject_id || "--"} />
                <Info label="角色" value={selectedLog.role || "--"} />
                <Info label="状态码" value={statusCode(selectedLog)} />
                <Info label="项目" value={metadataValue(selectedLog, "project_id")} />
                <Info label="会话" value={metadataValue(selectedLog, "conversation_id")} />
                <Info label="图片数" value={imageCount(selectedLog)} />
                <Info label="流式" value={metadataValue(selectedLog, "stream")} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-400">提示词 / 摘要</div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{selectedLog.prompt_preview || "--"}</p>
              </div>
              {selectedLog.error ? (
                <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase text-rose-500">错误信息</div>
                    <Button
                      variant="outline"
                      className="h-8 rounded-lg border-rose-200 bg-white text-xs text-rose-600"
                      onClick={() => {
                        void navigator.clipboard.writeText(selectedLog.error || "");
                        toast.success("错误信息已复制");
                      }}
                    >
                      <Copy className="size-3.5" />
                      复制错误
                    </Button>
                  </div>
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
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-none text-slate-950">{value}</div>
        <div className="mt-1 text-sm text-slate-500">{label}</div>
      </div>
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
