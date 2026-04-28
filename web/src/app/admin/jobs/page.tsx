"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Copy, Eye, ImageIcon, LoaderCircle, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchImageJobs, type ImageJob } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

function formatTime(value?: string) {
  if (!value) {
    return "--";
  }
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

function statusText(status: ImageJob["status"]) {
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return "排队中";
}

function statusIcon(status: ImageJob["status"]) {
  if (status === "succeeded") return CheckCircle2;
  if (status === "failed") return XCircle;
  if (status === "running") return LoaderCircle;
  return Clock3;
}

function resultCount(job: ImageJob) {
  const data = job.result?.data;
  return Array.isArray(data) ? data.length : Number(job.metadata?.n || 0);
}

function durationMs(job: ImageJob) {
  if (!job.started_at || !job.finished_at) {
    return "--";
  }
  const started = new Date(job.started_at).getTime();
  const finished = new Date(job.finished_at).getTime();
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
    return "--";
  }
  return `${finished - started}ms`;
}

export default function AdminJobsPage() {
  useAuthGuard(["admin"]);

  const [items, setItems] = useState<ImageJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ImageJob | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchImageJobs(150);
      setItems(response.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载任务失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const summary = useMemo(() => {
    const total = items.length;
    const running = items.filter((item) => item.status === "running" || item.status === "pending").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const succeeded = items.filter((item) => item.status === "succeeded").length;
    return { total, running, failed, succeeded };
  }, [items]);

  const copyJob = async (job: ImageJob) => {
    await navigator.clipboard.writeText(JSON.stringify(job, null, 2));
    toast.success("任务详情已复制");
  };

  return (
    <main className="page-shell space-y-6 pb-12">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
              <ImageIcon className="size-4" />
              IMAGE JOBS
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">生成任务</h1>
            <p className="mt-2 text-sm text-slate-500">查看后台生成队列、失败原因、耗时和任务结果，重启后也能追踪历史状态。</p>
          </div>
          <Button type="button" onClick={() => void loadItems()} disabled={loading} className="bg-slate-950 text-white hover:bg-slate-800">
            <RefreshCw className={cn("mr-2 size-4", loading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="最近任务" value={summary.total} tone="slate" />
        <Metric label="运行/排队" value={summary.running} tone="cyan" />
        <Metric label="成功" value={summary.succeeded} tone="green" />
        <Metric label="失败" value={summary.failed} tone="rose" />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_1fr_0.6fr] gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500">
          <div>任务</div>
          <div>状态</div>
          <div>图片</div>
          <div>耗时</div>
          <div>用户</div>
          <div className="text-right">详情</div>
        </div>
        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">{loading ? "正在加载任务..." : "暂无生成任务"}</div>
        ) : (
          items.map((job) => {
            const Icon = statusIcon(job.status);
            return (
              <div
                key={job.job_id}
                className="grid grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_1fr_0.6fr] items-center gap-4 border-b border-slate-100 px-5 py-4 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-950">{String(job.metadata?.prompt_preview || job.kind || "图片生成任务")}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatTime(job.created_at)} · {job.kind || "image"} · {String(job.metadata?.model || "--")}
                  </div>
                </div>
                <div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium",
                      job.status === "succeeded" && "bg-emerald-50 text-emerald-700",
                      job.status === "failed" && "bg-rose-50 text-rose-700",
                      (job.status === "running" || job.status === "pending") && "bg-cyan-50 text-cyan-700",
                    )}
                  >
                    <Icon className={cn("size-3.5", job.status === "running" && "animate-spin")} />
                    {statusText(job.status)}
                  </span>
                </div>
                <div className="text-slate-700">{resultCount(job) || "--"}</div>
                <div className="font-medium text-orange-600">{durationMs(job)}</div>
                <div className="min-w-0">
                  <div className="truncate text-slate-900">{job.subject_id || "--"}</div>
                  <div className="text-xs text-slate-400">{job.role || "--"}</div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="icon" onClick={() => setSelected(job)} aria-label="查看任务详情">
                    <Eye className="size-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => void copyJob(job)} aria-label="复制任务详情">
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </section>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>任务详情</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[65vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
            {selected ? JSON.stringify(selected, null, 2) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "slate" | "cyan" | "green" | "rose" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div
        className={cn(
          "mb-4 size-10 rounded-lg",
          tone === "slate" && "bg-slate-100",
          tone === "cyan" && "bg-cyan-50",
          tone === "green" && "bg-emerald-50",
          tone === "rose" && "bg-rose-50",
        )}
      />
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}
