"use client";

import { Globe2, LoaderCircle, PlugZap, Radar, RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { testProxy, type ProxyTestResult } from "@/lib/api";

import { useSettingsStore } from "../store";

export function ConfigCard() {
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);
  const config = useSettingsStore((state) => state.config);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const setRefreshAccountIntervalMinute = useSettingsStore((state) => state.setRefreshAccountIntervalMinute);
  const setProxy = useSettingsStore((state) => state.setProxy);
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl);
  const saveConfig = useSettingsStore((state) => state.saveConfig);

  const handleTestProxy = async () => {
    const candidate = String(config?.proxy || "").trim();
    if (!candidate) {
      toast.error("请先填写代理地址");
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const data = await testProxy(candidate);
      setProxyTestResult(data.result);
      if (data.result.ok) {
        toast.success(`代理可用（${data.result.latency_ms} ms，HTTP ${data.result.status}）`);
      } else {
        toast.error(`代理不可用：${data.result.error ?? "未知错误"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试代理失败");
    } finally {
      setIsTestingProxy(false);
    }
  };

  if (isLoadingConfig) {
    return (
      <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
        <CardContent className="flex items-center justify-center p-10">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-950">基础运行参数</div>
              <div className="mt-1 text-sm text-slate-500">影响账号刷新、图片链接和上游网络出口。</div>
            </div>
            <div className="grid size-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
              <Radar className="size-5" />
            </div>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-800">
            管理员登录密钥从部署配置读取；给其他人使用请创建普通用户密钥。
          </div>
          <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <RefreshCw className="size-4 text-slate-400" />
              账号刷新间隔
            </label>
            <Input
              value={String(config?.refresh_account_interval_minute || "")}
              onChange={(event) => setRefreshAccountIntervalMinute(event.target.value)}
              placeholder="分钟"
              className="h-10 rounded-lg border-slate-200 bg-white"
            />
            <p className="text-xs text-slate-500">单位分钟，控制账号自动刷新频率。</p>
          </div>
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <PlugZap className="size-4 text-slate-400" />
              全局代理
            </label>
            <Input
              value={String(config?.proxy || "")}
              onChange={(event) => {
                setProxy(event.target.value);
                setProxyTestResult(null);
              }}
              placeholder="http://127.0.0.1:7890"
              className="h-10 rounded-lg border-slate-200 bg-white"
            />
            <p className="text-xs text-slate-500">留空表示不使用代理。</p>
            {proxyTestResult ? (
              <div
                className={`rounded-xl border px-3 py-2 text-xs leading-6 ${
                  proxyTestResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                {proxyTestResult.ok
                  ? `代理可用：HTTP ${proxyTestResult.status}，用时 ${proxyTestResult.latency_ms} ms`
                  : `代理不可用：${proxyTestResult.error ?? "未知错误"}（用时 ${proxyTestResult.latency_ms} ms）`}
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-slate-200 bg-white px-4 text-slate-700"
                onClick={() => void handleTestProxy()}
                disabled={isTestingProxy}
              >
                {isTestingProxy ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                测试代理
              </Button>
            </div>
          </div>
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 md:col-span-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Globe2 className="size-4 text-slate-400" />
              图片访问地址
            </label>
            <Input
              value={String(config?.base_url || "")}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://example.com"
              className="h-10 rounded-lg border-slate-200 bg-white"
            />
            <p className="text-xs text-slate-500">用于生成图片结果的访问前缀地址。</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            className="h-10 rounded-lg bg-slate-950 px-5 text-white hover:bg-slate-800"
            onClick={() => void saveConfig()}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
