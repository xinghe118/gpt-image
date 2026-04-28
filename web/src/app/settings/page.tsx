"use client";

import { useEffect, useRef } from "react";
import { Database, KeyRound, LoaderCircle, PlugZap, RefreshCw, ServerCog } from "lucide-react";

import { useAuthGuard } from "@/lib/use-auth-guard";

import { ConfigCard } from "./components/config-card";
import { CPAPoolDialog } from "./components/cpa-pool-dialog";
import { CPAPoolsCard } from "./components/cpa-pools-card";
import { HealthCard } from "./components/health-card";
import { ImportBrowserDialog } from "./components/import-browser-dialog";
import { SettingsHeader } from "./components/settings-header";
import { StorageCard } from "./components/storage-card";
import { Sub2APIConnections } from "./components/sub2api-connections";
import { useSettingsStore } from "./store";

function SettingsDataController() {
  const didLoadRef = useRef(false);
  const initialize = useSettingsStore((state) => state.initialize);
  const loadPools = useSettingsStore((state) => state.loadPools);
  const pools = useSettingsStore((state) => state.pools);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const hasRunningJobs = pools.some((pool) => {
      const status = pool.import_job?.status;
      return status === "pending" || status === "running";
    });
    if (!hasRunningJobs) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadPools(true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loadPools, pools]);

  return null;
}

function SettingsPageContent() {
  const config = useSettingsStore((state) => state.config);
  const pools = useSettingsStore((state) => state.pools);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);

  return (
    <>
      <SettingsDataController />
      <section className="page-shell-wide grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <SettingsHeader />
          <HealthCard />
          <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">System Core</div>
                <div className="mt-2 text-xl font-semibold">运行中枢</div>
              </div>
              <ServerCog className="size-6 text-cyan-300" />
            </div>
            <div className="space-y-3">
              <ControlSignal
                icon={RefreshCw}
                label="刷新周期"
                value={isLoadingConfig ? "读取中" : `${config?.refresh_account_interval_minute || "--"} 分钟`}
              />
              <ControlSignal
                icon={PlugZap}
                label="网络出口"
                value={String(config?.proxy || "").trim() ? "代理模式" : "直连模式"}
              />
              <ControlSignal
                icon={Database}
                label="导入连接"
                value={`${pools.length} 个 CPA`}
              />
              <ControlSignal
                icon={KeyRound}
                label="访问控制"
                value="管理员隔离"
              />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 text-sm font-semibold text-slate-950">配置分区</div>
            <div className="space-y-2 text-sm">
              <AnchorPill label="基础配置" />
              <AnchorPill label="持久化存储" />
              <AnchorPill label="CPA 导入" />
              <AnchorPill label="sub2api 导入" />
            </div>
          </div>
        </aside>

        <div className="space-y-5">
          <ConfigCard />
          <StorageCard />
          <CPAPoolsCard />
          <Sub2APIConnections />
        </div>
      </section>
      <CPAPoolDialog />
      <ImportBrowserDialog />
    </>
  );
}

export default function SettingsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <SettingsPageContent />;
}

function ControlSignal({ icon: Icon, label, value }: { icon: typeof RefreshCw; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="grid size-9 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="truncate text-sm font-semibold text-white">{value}</div>
      </div>
    </div>
  );
}

function AnchorPill({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-slate-600">
      <span>{label}</span>
      <span className="size-1.5 rounded-full bg-cyan-500" />
    </div>
  );
}
