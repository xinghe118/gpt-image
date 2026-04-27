"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileText, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function LogsPageContent() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<ActivityLog[]>([]);
  const [summary, setSummary] = useState<ActivityLogSummary | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = 100;

  const loadLogs = async ({ silent = false, append = false, statusOverride }: { silent?: boolean; append?: boolean; statusOverride?: string } = {}) => {
    if (append) {
      setIsLoadingMore(true);
    } else if (!silent) {
      setIsLoading(true);
    }
    try {
      const [logsData, summaryData] = await Promise.all([
        fetchActivityLogs({ limit: pageSize, offset: append ? items.length : 0, status: statusOverride ?? status, q: query.trim() }),
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
            {eventOptions.map(([event, count]) => (
              <span key={event} className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {event} · {count}
              </span>
            ))}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="hidden grid-cols-[150px_170px_90px_90px_minmax(0,1fr)_100px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 lg:grid">
            <div>时间</div>
            <div>事件</div>
            <div>状态</div>
            <div>模型</div>
            <div>摘要 / 错误</div>
            <div>耗时</div>
          </div>
          <div className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">暂无日志</div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="grid gap-2 px-4 py-4 text-sm lg:grid-cols-[150px_170px_90px_90px_minmax(0,1fr)_100px] lg:items-center lg:gap-3">
                  <div className="text-slate-500">{formatTime(item.created_at)}</div>
                  <div className="font-medium text-slate-900">{item.event}</div>
                  <div>
                    <Badge variant={item.status === "ok" ? "success" : item.status === "accepted" ? "info" : "danger"}>
                      {item.status}
                    </Badge>
                  </div>
                  <div className="text-slate-500">{item.model || "--"}</div>
                  <div className="min-w-0">
                    <div className="truncate text-slate-700">{item.error || item.prompt_preview || item.route || "--"}</div>
                    <div className="mt-1 truncate text-xs text-slate-400">{item.route} · {item.role || "unknown"}</div>
                  </div>
                  <div className="text-slate-500">{item.duration_ms == null ? "--" : `${item.duration_ms}ms`}</div>
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
    </section>
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
