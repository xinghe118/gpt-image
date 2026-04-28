"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Database, LoaderCircle, RefreshCw, ServerCog, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { fetchSystemHealth, type SystemHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

function formatUptime(seconds: number) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }
  return `${minutes} 分钟`;
}

function text(value: unknown, fallback = "--") {
  const output = String(value ?? "").trim();
  return output || fallback;
}

export function HealthCard() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = async () => {
    setLoading(true);
    try {
      setHealth(await fetchSystemHealth());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取健康状态失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHealth();
  }, []);

  const healthy = health?.status === "healthy";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">部署健康</div>
          <div className="mt-1 text-xs text-slate-500">版本、存储、账号池和并发状态。</div>
        </div>
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
          onClick={() => void loadHealth()}
          aria-label="刷新健康状态"
        >
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>
      </div>
      <div
        className={cn(
          "mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
          healthy ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
        )}
      >
        <CheckCircle2 className="size-4" />
        {health ? (healthy ? "运行正常" : "需要检查") : "正在读取"}
      </div>
      <div className="space-y-3">
        <HealthLine icon={ServerCog} label="版本" value={health ? `v${health.version}` : "--"} />
        <HealthLine icon={Clock3} label="运行时长" value={health ? formatUptime(health.uptime_seconds) : "--"} />
        <HealthLine icon={UsersRound} label="可用账号" value={health ? `${health.accounts.available}/${health.accounts.total}` : "--"} />
        <HealthLine
          icon={Database}
          label="数据存储"
          value={health ? `${text(health.storage_backend.type)} · ${text(health.app_data.backend)}` : "--"}
        />
        <HealthLine
          icon={RefreshCw}
          label="并发"
          value={health ? `${health.concurrency.running ?? 0}/${health.concurrency.limit ?? "--"} 运行` : "--"}
        />
      </div>
    </div>
  );
}

function HealthLine({ icon: Icon, label, value }: { icon: typeof ServerCog; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
      <div className="grid size-8 place-items-center rounded-lg bg-white text-cyan-700 shadow-sm">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="truncate text-sm font-semibold text-slate-900">{value}</div>
      </div>
    </div>
  );
}
