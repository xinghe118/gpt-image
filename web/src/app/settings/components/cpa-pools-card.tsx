"use client";

import { ChevronDown, Import, LoaderCircle, Pencil, Plus, ServerCog, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { useSettingsStore } from "../store";

export function CPAPoolsCard() {
  const [showHelp, setShowHelp] = useState(false);
  const pools = useSettingsStore((state) => state.pools);
  const isLoadingPools = useSettingsStore((state) => state.isLoadingPools);
  const deletingId = useSettingsStore((state) => state.deletingId);
  const loadingFilesId = useSettingsStore((state) => state.loadingFilesId);
  const openAddDialog = useSettingsStore((state) => state.openAddDialog);
  const openEditDialog = useSettingsStore((state) => state.openEditDialog);
  const deletePool = useSettingsStore((state) => state.deletePool);
  const browseFiles = useSettingsStore((state) => state.browseFiles);

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
              <ServerCog className="size-5 text-stone-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">CPA 连接管理</h2>
              <p className="text-sm text-stone-500">先配置连接，再按需查询远程账号并选择导入到本地号池。</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pools.length > 0 ? <Badge className="rounded-md px-2.5 py-1">{pools.length} 个连接</Badge> : null}
            <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={openAddDialog}>
              <Plus className="size-4" />
              添加连接
            </Button>
          </div>
        </div>

        {isLoadingPools ? (
          <div className="flex items-center justify-center py-10">
            <LoaderCircle className="size-5 animate-spin text-stone-400" />
          </div>
        ) : pools.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-stone-50 px-6 py-10 text-center">
            <ServerCog className="size-8 text-stone-300" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-stone-600">暂无 CPA 连接</p>
              <p className="text-sm text-stone-400">点击「添加连接」保存你的 CLIProxyAPI 信息。</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {pools.map((pool) => {
              const isBusy = deletingId === pool.id || loadingFilesId === pool.id;
              const importJob = pool.import_job ?? null;
              const progress = importJob?.total
                ? Math.round((importJob.completed / importJob.total) * 100)
                : 0;

              return (
                <div key={pool.id} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-stone-800">{pool.name || pool.base_url}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs text-stone-400">{pool.base_url}</span>
                        <Badge variant={pool.has_secret_key ? "success" : "danger"} className="rounded-md px-1.5 py-0 text-[10px]">
                          {pool.has_secret_key ? "密钥已保存" : "缺少密钥"}
                        </Badge>
                      </div>
                      {importJob ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                          <Badge
                            variant={
                              importJob.status === "completed"
                                ? "success"
                                : importJob.status === "failed"
                                  ? "danger"
                                  : "info"
                            }
                            className="rounded-md px-1.5 py-0 text-[10px]"
                          >
                            {progress}%
                          </Badge>
                          <span>{importJob.status}</span>
                          <span>已处理 {importJob.completed}/{importJob.total}</span>
                          <span>新增 {importJob.added}</span>
                          {importJob.failed ? <span className="text-rose-500">失败 {importJob.failed}</span> : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        className="h-8 rounded-lg border-stone-200 bg-white px-3 text-xs text-stone-600"
                        onClick={() => void browseFiles(pool)}
                        disabled={isBusy}
                      >
                        {loadingFilesId === pool.id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Import className="size-3.5" />
                        )}
                        同步
                      </Button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                        onClick={() => openEditDialog(pool)}
                        disabled={isBusy}
                        title="编辑"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-stone-400 transition hover:bg-rose-50 hover:text-rose-500"
                        onClick={() => void deletePool(pool)}
                        disabled={isBusy}
                        title="删除"
                      >
                        {deletingId === pool.id ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          className="flex w-full items-center justify-between rounded-xl bg-stone-50 px-4 py-3 text-left text-sm text-stone-500 transition hover:bg-stone-100"
          onClick={() => setShowHelp((value) => !value)}
        >
          <span className="font-medium text-stone-600">使用说明</span>
          <ChevronDown className={`size-4 transition ${showHelp ? "rotate-180" : ""}`} />
        </button>
        {showHelp ? (
          <div className="rounded-xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-500">
            <ul className="list-inside list-disc space-y-0.5">
              <li>点击连接的「同步」后，会先读取远程账号列表并展示给前端选择。</li>
              <li>确认选择后，后端后台下载对应 access_token 并导入本地号池。</li>
              <li>前端只轮询导入进度，不直接参与 download。</li>
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
