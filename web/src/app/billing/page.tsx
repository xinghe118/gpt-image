"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Download, Gauge, LoaderCircle, RefreshCw, Search, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchBillingLedger, fetchBillingSummary, type BillingSummary, type QuotaLedgerEntry } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";

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
  }).format(date);
}

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function BillingPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<QuotaLedgerEntry[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = 100;

  const load = useCallback(async ({ append = false, silent = false }: { append?: boolean; silent?: boolean } = {}) => {
    if (append) {
      setIsLoadingMore(true);
    } else if (!silent) {
      setIsLoading(true);
    }
    try {
      const [ledgerData, summaryData] = await Promise.all([
        fetchBillingLedger({ limit: pageSize, offset: append ? items.length : 0, q: query.trim() }),
        fetchBillingSummary(),
      ]);
      setItems((current) => (append ? [...current, ...ledgerData.items] : ledgerData.items));
      setHasMore(ledgerData.has_more);
      setSummary(summaryData.summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载额度账单失败");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [items.length, query]);

  useEffect(() => {
    if (isCheckingAuth || !session || didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void load();
  }, [isCheckingAuth, load, session]);

  const modelItems = useMemo(() => Object.entries(summary?.by_model || {}).slice(0, 6), [summary]);

  const exportCsv = () => {
    const rows = items.map((item) => [
      item.created_at,
      item.subject_name || item.subject_id,
      item.plan_label,
      item.event,
      item.mode,
      item.model,
      item.amount,
      item.status,
      item.project_id,
      item.prompt_preview,
    ]);
    const csv = [
      ["time", "user", "plan", "event", "mode", "model", "amount", "status", "project_id", "prompt"],
      ...rows,
    ].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gpt-image-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isCheckingAuth || !session || isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
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
              <CreditCard className="size-4" />
              BILLING
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">额度账单</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              查看每次成功生成的额度消耗、模型、项目和使用者，失败请求不会计入已扣额度。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" onClick={exportCsv}>
              <Download className="size-4" />
              导出
            </Button>
            <Button className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => void load({ silent: true })}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Metric icon={Gauge} label="总消耗" value={summary?.total_amount ?? 0} />
        <Metric icon={CreditCard} label="账单记录" value={summary?.total_entries ?? 0} />
        <Metric icon={UserRound} label="统计范围" value={summary?.scope === "all" ? "全站" : "当前用户"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">用户消耗排行</h2>
          <div className="mt-4 space-y-2">
            {summary?.by_subject.length ? summary.by_subject.slice(0, 8).map((item) => (
              <div key={item.subject_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{item.subject_name || item.subject_id}</div>
                  <div className="text-xs text-slate-400">{item.count} 次记录</div>
                </div>
                <Badge variant="info">{item.amount}</Badge>
              </div>
            )) : <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">暂无排行数据</div>}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">模型消耗分布</h2>
          <div className="mt-4 space-y-2">
            {modelItems.length ? modelItems.map(([model, amount]) => (
              <div key={model} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="truncate text-sm font-medium text-slate-900">{model}</span>
                <Badge variant="outline">{amount}</Badge>
              </div>
            )) : <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">暂无模型消耗数据</div>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void load({ silent: true });
                }
              }}
              placeholder="搜索用户、模型、项目或提示词"
              className="h-10 rounded-lg border-slate-200 pl-9"
            />
          </div>
          <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" onClick={() => void load({ silent: true })}>
            应用筛选
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="hidden grid-cols-[140px_140px_100px_130px_90px_90px_minmax(0,1fr)] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 lg:grid">
            <div>时间</div>
            <div>用户</div>
            <div>套餐</div>
            <div>事件</div>
            <div>模型</div>
            <div>消耗</div>
            <div>提示词 / 项目</div>
          </div>
          <div className="divide-y divide-slate-100">
            {items.length ? items.map((item) => (
              <div key={item.id} className="grid gap-2 px-4 py-4 text-sm lg:grid-cols-[140px_140px_100px_130px_90px_90px_minmax(0,1fr)] lg:items-center lg:gap-3">
                <div className="text-slate-500">{formatTime(item.created_at)}</div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{item.subject_name || item.subject_id}</div>
                  <div className="truncate text-xs text-slate-400">{item.subject_id}</div>
                </div>
                <div><Badge variant="info">{item.plan_label || item.plan || "--"}</Badge></div>
                <div className="text-slate-600">{item.event}</div>
                <div className="text-slate-600">{item.model || "--"}</div>
                <div className="font-semibold text-slate-950">-{item.amount}</div>
                <div className="min-w-0">
                  <div className="truncate text-slate-700">{item.prompt_preview || "--"}</div>
                  <div className="truncate text-xs text-slate-400">{item.project_id || "默认项目"} · {item.status}</div>
                </div>
              </div>
            )) : <div className="p-8 text-center text-sm text-slate-500">暂无额度流水</div>}
          </div>
        </div>
        {hasMore ? (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" className="rounded-lg border-slate-200 bg-white" disabled={isLoadingMore} onClick={() => void load({ append: true, silent: true })}>
              {isLoadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}
              加载更多
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
        <Icon className="size-5" />
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}
