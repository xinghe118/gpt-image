"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleOff,
  Database,
  Gauge,
  ImageIcon,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchAccounts,
  fetchCPAPools,
  fetchSettingsConfig,
  fetchStorageInfo,
  fetchSub2APIServers,
  fetchUserKeys,
  type Account,
  type CPAPool,
  type SettingsConfig,
  type StorageInfo,
  type Sub2APIServer,
  type UserKey,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

type AdminOverviewData = {
  accounts: Account[];
  config: SettingsConfig | null;
  cpaPools: CPAPool[];
  sub2apiServers: Sub2APIServer[];
  userKeys: UserKey[];
  storage: StorageInfo | null;
};

const emptyData: AdminOverviewData = {
  accounts: [],
  config: null,
  cpaPools: [],
  sub2apiServers: [],
  userKeys: [],
  storage: null,
};

function formatCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

function isUnlimitedImageQuotaAccount(account: Account) {
  return account.type === "Pro" || account.type === "ProLite";
}

function formatStorageType(storage: StorageInfo | null) {
  const type = String(storage?.backend?.type || storage?.health?.backend || "unknown");
  return type === "database" ? String(storage?.backend?.db_type || "database") : type;
}

function formatHealth(storage: StorageInfo | null) {
  const status = String(storage?.health?.status || "unknown");
  if (status === "healthy") {
    return { label: "健康", variant: "success" as const };
  }
  if (status === "unhealthy") {
    return { label: "异常", variant: "danger" as const };
  }
  return { label: "未知", variant: "secondary" as const };
}

function AdminOverviewContent() {
  const didLoadRef = useRef(false);
  const [data, setData] = useState<AdminOverviewData>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const metrics = useMemo(() => {
    const accounts = data.accounts;
    const normal = accounts.filter((account) => account.status === "正常");
    const limited = accounts.filter((account) => account.status === "限流");
    const abnormal = accounts.filter((account) => account.status === "异常");
    const disabled = accounts.filter((account) => account.status === "禁用");
    const success = accounts.reduce((sum, account) => sum + Number(account.success || 0), 0);
    const fail = accounts.reduce((sum, account) => sum + Number(account.fail || 0), 0);
    const quota = normal.some(isUnlimitedImageQuotaAccount)
      ? "∞"
      : normal.some((account) => account.imageQuotaUnknown)
        ? "未知"
        : formatCompact(normal.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
    const successRate = success + fail === 0 ? "--" : `${Math.round((success / (success + fail)) * 100)}%`;
    return { total: accounts.length, normal: normal.length, limited: limited.length, abnormal: abnormal.length, disabled: disabled.length, quota, success, fail, successRate };
  }, [data.accounts]);

  const limitedAccounts = useMemo(
    () =>
      data.accounts
        .filter((account) => account.status === "限流" || account.status === "异常")
        .slice(0, 6),
    [data.accounts],
  );

  const loadOverview = async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const [accounts, settings, pools, sub2api, keys, storage] = await Promise.allSettled([
        fetchAccounts(),
        fetchSettingsConfig(),
        fetchCPAPools(),
        fetchSub2APIServers(),
        fetchUserKeys(),
        fetchStorageInfo(),
      ]);

      setData({
        accounts: accounts.status === "fulfilled" ? accounts.value.items : [],
        config: settings.status === "fulfilled" ? settings.value.config : null,
        cpaPools: pools.status === "fulfilled" ? pools.value.pools : [],
        sub2apiServers: sub2api.status === "fulfilled" ? sub2api.value.servers : [],
        userKeys: keys.status === "fulfilled" ? keys.value.items : [],
        storage: storage.status === "fulfilled" ? storage.value : null,
      });

      const failedCount = [accounts, settings, pools, sub2api, keys, storage].filter((item) => item.status === "rejected").length;
      if (failedCount > 0) {
        toast.warning(`概览中有 ${failedCount} 项数据暂时不可用`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载概览失败");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadOverview();
  }, []);

  if (isLoading) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <LoaderCircle className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const health = formatHealth(data.storage);
  const proxyValue = String(data.config?.proxy || "").trim();
  const baseUrlValue = String(data.config?.base_url || "").trim();

  return (
    <section className="page-shell-wide grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:p-7">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                <ShieldCheck className="size-4" />
                运营概览
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">管理员控制台</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  账号池、导入源、存储和代理的实时状态集中在这里，异常项优先露出。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2 lg:justify-end">
              <Button asChild variant="outline" className="h-10 rounded-lg border-slate-200 bg-white text-slate-700">
                <Link href="/image">
                  <ImageIcon className="size-4" />
                  打开工作台
                </Link>
              </Button>
              <Button
                className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => void loadOverview(true)}
                disabled={isRefreshing}
              >
                {isRefreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新
              </Button>
            </div>
          </div>
          <div className="grid border-t border-slate-200 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="账号总数" value={metrics.total} icon={UsersRound} tone="slate" />
            <Metric label="正常账号" value={metrics.normal} icon={CheckCircle2} tone="emerald" />
            <Metric label="剩余额度" value={metrics.quota} icon={Gauge} tone="cyan" />
            <Metric label="成功率" value={metrics.successRate} icon={ShieldCheck} tone="blue" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatusTile label="限流账号" value={metrics.limited} icon={AlertTriangle} color="amber" />
          <StatusTile label="异常账号" value={metrics.abnormal} icon={CircleOff} color="rose" />
          <StatusTile label="禁用账号" value={metrics.disabled} icon={CircleOff} color="slate" />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel title="需要关注" actionHref="/accounts" actionLabel="查看账号池">
            {limitedAccounts.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                当前没有限流或异常账号
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {limitedAccounts.map((account) => (
                  <div key={account.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{account.email || account.user_id || account.id}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>{account.type}</span>
                        <span>额度 {account.imageQuotaUnknown ? "未知" : account.quota}</span>
                        {account.restoreAt ? <span>恢复 {account.restoreAt}</span> : null}
                      </div>
                    </div>
                    <Badge variant={account.status === "限流" ? "warning" : "danger"}>{account.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="系统状态" actionHref="/settings" actionLabel="进入系统">
            <div className="space-y-3">
              <SystemRow icon={Database} label="存储后端" value={formatStorageType(data.storage)} badge={<Badge variant={health.variant}>{health.label}</Badge>} />
              <SystemRow icon={PlugZap} label="全局代理" value={proxyValue || "未启用"} badge={<Badge variant={proxyValue ? "info" : "secondary"}>{proxyValue ? "已配置" : "直连"}</Badge>} />
              <SystemRow icon={ServerCog} label="图片地址" value={baseUrlValue || "跟随当前域名"} badge={<Badge variant={baseUrlValue ? "success" : "secondary"}>{baseUrlValue ? "固定" : "自动"}</Badge>} />
              <SystemRow icon={KeyRound} label="普通密钥" value={`${data.userKeys.length} 个`} badge={<Badge variant="outline">用户访问</Badge>} />
            </div>
          </Panel>
        </div>
      </div>

      <aside className="space-y-5">
        <Panel title="导入通道" actionHref="/settings" actionLabel="管理">
          <div className="grid gap-3">
            <ImportChannel name="CPA 连接" count={data.cpaPools.length} active={data.cpaPools.some((pool) => pool.import_job?.status === "running" || pool.import_job?.status === "pending")} />
            <ImportChannel name="sub2api 服务器" count={data.sub2apiServers.length} active={data.sub2apiServers.some((server) => server.import_job?.status === "running" || server.import_job?.status === "pending")} />
          </div>
        </Panel>

        <Panel title="快速操作">
          <div className="grid gap-2">
            <QuickLink href="/accounts" icon={UsersRound} label="刷新账号池" detail="检查额度、状态和恢复时间" />
            <QuickLink href="/admin/logs" icon={ServerCog} label="查看日志中心" detail="定位失败请求和上游异常" />
            <QuickLink href="/settings" icon={KeyRound} label="创建用户密钥" detail="给普通用户分配工作台访问" />
            <QuickLink href="/settings" icon={PlugZap} label="测试代理" detail="验证当前网络出口是否可用" />
            <QuickLink href="/image" icon={ImageIcon} label="验证生图链路" detail="用工作台发起一次真实请求" />
          </div>
        </Panel>
      </aside>
    </section>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: typeof UsersRound; tone: "slate" | "emerald" | "cyan" | "blue" }) {
  const tones = {
    slate: "text-slate-700 bg-slate-50",
    emerald: "text-emerald-700 bg-emerald-50",
    cyan: "text-cyan-700 bg-cyan-50",
    blue: "text-blue-700 bg-blue-50",
  };
  return (
    <div className="border-t border-slate-200 p-5 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0 xl:first:border-l-0">
      <div className={cn("mb-4 inline-flex size-10 items-center justify-center rounded-lg", tones[tone])}>
        <Icon className="size-5" />
      </div>
      <div className="text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function StatusTile({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof AlertTriangle; color: "amber" | "rose" | "slate" }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    slate: "border-slate-200 bg-white text-slate-600",
  };
  return (
    <div className={cn("flex items-center justify-between rounded-2xl border p-4", tones[color])}>
      <div>
        <div className="text-sm font-medium opacity-80">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </div>
      <Icon className="size-6 opacity-70" />
    </div>
  );
}

function Panel({ title, children, actionHref, actionLabel }: { title: string; children: ReactNode; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {actionHref ? (
          <Link href={actionHref} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-950">
            {actionLabel || "查看"}
            <ArrowRight className="size-4" />
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SystemRow({ icon: Icon, label, value, badge }: { icon: typeof Database; label: string; value: string; badge: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Icon className="size-4 text-slate-400" />
          {label}
        </div>
        {badge}
      </div>
      <div className="truncate text-sm text-slate-500">{value}</div>
    </div>
  );
}

function ImportChannel({ name, count, active }: { name: string; count: number; active: boolean }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{name}</div>
          <div className="mt-1 text-sm text-slate-500">{count} 个连接</div>
        </div>
        <Badge variant={active ? "warning" : count > 0 ? "success" : "secondary"}>{active ? "导入中" : count > 0 ? "可用" : "未配置"}</Badge>
      </div>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label, detail }: { href: string; icon: typeof UsersRound; label: string; detail: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-slate-200 hover:bg-white">
      <span className="grid size-9 place-items-center rounded-lg bg-white text-slate-500 shadow-sm group-hover:text-slate-950">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block truncate text-xs text-slate-500">{detail}</span>
      </span>
      <ArrowRight className="size-4 text-slate-300 group-hover:text-slate-500" />
    </Link>
  );
}

export default function AdminOverviewPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return <AdminOverviewContent />;
}
