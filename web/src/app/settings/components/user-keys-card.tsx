"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, Copy, Gauge, KeyRound, LoaderCircle, Plus, RotateCw, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createUserKey, deleteUserKey, fetchUserKeys, regenerateUserKey, updateUserKey, type UserKey, type UserPlan } from "@/lib/api";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseQuotaInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
}

function formatQuota(value: number | null | undefined) {
  return value === null || value === undefined ? "不限" : String(value);
}

const userPlanOptions: Array<{
  value: UserPlan;
  label: string;
  description: string;
}> = [
  { value: "trial", label: "免费体验", description: "单次 1 张，仅文生图，限制 GPT Image 2" },
  { value: "standard", label: "标准版", description: "单次 2 张，支持文生图和图生图" },
  { value: "pro", label: "高级版", description: "单次 4 张，开放全部图片模型" },
  { value: "internal", label: "内部账号", description: "内部测试和运营使用，开放全部图片能力" },
];

function planLabel(value?: string | null) {
  return userPlanOptions.find((item) => item.value === value)?.label || "标准版";
}

export function UserKeysCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<UserKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<UserKey | null>(null);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<UserPlan>("standard");
  const [quotaLimit, setQuotaLimit] = useState("");
  const [editPlan, setEditPlan] = useState<UserPlan>("standard");
  const [editQuotaLimit, setEditQuotaLimit] = useState("");
  const [editQuotaUsed, setEditQuotaUsed] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingQuota, setIsSavingQuota] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [revealedKey, setRevealedKey] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchUserKeys();
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户密钥失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void load();
  }, []);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const data = await createUserKey(name.trim(), parseQuotaInput(quotaLimit), plan);
      setItems(data.items);
      setRevealedKey(data.key);
      setName("");
      setPlan("standard");
      setQuotaLimit("");
      setIsDialogOpen(false);
      toast.success("用户密钥已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建用户密钥失败");
    } finally {
      setIsCreating(false);
    }
  };

  const openQuotaDialog = (item: UserKey) => {
    setEditingItem(item);
    setEditPlan(item.plan || "standard");
    setEditQuotaLimit(item.quota_limit === null ? "" : String(item.quota_limit));
    setEditQuotaUsed(String(item.quota_used || 0));
  };

  const handleSaveQuota = async () => {
    if (!editingItem) {
      return;
    }
    setIsSavingQuota(true);
    setItemPending(editingItem.id, true);
    try {
      const nextQuotaLimit = parseQuotaInput(editQuotaLimit);
      const nextQuotaUsed = parseQuotaInput(editQuotaUsed) ?? 0;
      const data = await updateUserKey(editingItem.id, {
        plan: editPlan,
        quota_limit: nextQuotaLimit,
        quota_used: nextQuotaUsed,
      });
      setItems(data.items);
      setEditingItem(null);
      toast.success("用户额度已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新用户额度失败");
    } finally {
      setItemPending(editingItem.id, false);
      setIsSavingQuota(false);
    }
  };

  const setItemPending = (id: string, isPending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (isPending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleToggle = async (item: UserKey) => {
    setItemPending(item.id, true);
    try {
      const data = await updateUserKey(item.id, { enabled: !item.enabled });
      setItems(data.items);
      toast.success(item.enabled ? "用户密钥已禁用" : "用户密钥已启用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新用户密钥失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleRegenerate = async (item: UserKey) => {
    if (!window.confirm(`重新生成「${item.name}」的密钥吗？旧密钥会立即失效。`)) {
      return;
    }
    setItemPending(item.id, true);
    try {
      const data = await regenerateUserKey(item.id);
      setItems(data.items);
      setRevealedKey(data.key);
      await handleCopy(data.key);
      toast.success("用户密钥已重新生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新生成用户密钥失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleDelete = async (item: UserKey) => {
    if (!window.confirm(`确认删除用户密钥「${item.name}」吗？`)) {
      return;
    }
    setItemPending(item.id, true);
    try {
      const data = await deleteUserKey(item.id);
      setItems(data.items);
      toast.success("用户密钥已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除用户密钥失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <KeyRound className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">用户密钥管理</h2>
                <p className="text-sm text-stone-500">为普通用户创建专用密钥，并设置可用图片额度；额度可随时调整。</p>
              </div>
            </div>
            <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={() => setIsDialogOpen(true)}>
              <Plus className="size-4" />
              创建用户密钥
            </Button>
          </div>

          {revealedKey ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
              <div className="font-medium">新密钥仅展示一次，请立即保存：</div>
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-white/80 p-3 md:flex-row md:items-center md:justify-between">
                <code className="break-all font-mono text-[13px]">{revealedKey}</code>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-emerald-200 bg-white px-4 text-emerald-700"
                  onClick={() => void handleCopy(revealedKey)}
                >
                  <Copy className="size-4" />
                  复制
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">
              暂无普通用户密钥。点击右上角按钮后即可创建并分发给其他人。
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const isPending = pendingIds.has(item.id);
                return (
                  <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-stone-800">{item.name}</div>
                        <Badge variant={item.enabled ? "success" : "secondary"} className="rounded-md">
                          {item.enabled ? "已启用" : "已禁用"}
                        </Badge>
                        <Badge variant="info" className="rounded-md">
                          {item.plan_label || planLabel(item.plan)}
                        </Badge>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-500 transition hover:bg-stone-200 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-stone-100 disabled:hover:text-stone-500"
                          onClick={() => item.key ? void handleCopy(item.key) : toast.info("旧密钥没有保存明文，请先重新生成")}
                          disabled={!item.key}
                          title={item.key ? "复制用户密钥" : "旧密钥没有保存明文，请先重新生成"}
                        >
                          <Copy className="size-3" />
                          复制密钥
                        </button>
                        {!item.key ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleRegenerate(item)}
                            disabled={isPending}
                            title="生成新的可复制密钥"
                          >
                            {isPending ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
                            重新生成
                          </button>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                        <span>创建时间 {formatDateTime(item.created_at)}</span>
                        <span>最近使用 {formatDateTime(item.last_used_at)}</span>
                      </div>
                      <div className="max-w-md space-y-2">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                          <span className="inline-flex items-center gap-1 text-stone-700">
                            <Gauge className="size-3.5" />
                            额度 {formatQuota(item.quota_limit)}
                          </span>
                          <span>单次 {item.max_images_per_request || 1} 张</span>
                          <span>{item.allow_image_edit ? "可图生图" : "仅文生图"}</span>
                          <span>已用 {item.quota_used || 0}</span>
                          <span>剩余 {formatQuota(item.quota_remaining)}</span>
                        </div>
                        {item.quota_limit === null ? (
                          <div className="h-2 rounded-full bg-emerald-100">
                            <div className="h-2 w-full rounded-full bg-emerald-400" />
                          </div>
                        ) : (
                          <div className="h-2 rounded-full bg-stone-100">
                            <div
                              className="h-2 rounded-full bg-cyan-500 transition-all"
                              style={{
                                width: `${Math.min(100, Math.round(((item.quota_used || 0) / Math.max(1, item.quota_limit)) * 100))}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-cyan-200 bg-white px-4 text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
                        onClick={() => openQuotaDialog(item)}
                        disabled={isPending}
                      >
                        <SlidersHorizontal className="size-4" />
                        调整额度
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                        onClick={() => void handleToggle(item)}
                        disabled={isPending}
                      >
                        {isPending ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : item.enabled ? (
                          <Ban className="size-4" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                        {item.enabled ? "禁用" : "启用"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-rose-200 bg-white px-4 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => void handleDelete(item)}
                        disabled={isPending}
                      >
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        删除
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>创建用户密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              可选填写一个备注名称，方便区分不同使用者；创建后会生成一条只能查看一次的原始密钥。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">名称（可选）</label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：设计同学 A、运营临时账号"
              className="h-11 rounded-xl border-stone-200 bg-white"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">初始额度（可选）</label>
            <Input
              type="number"
              min={0}
              value={quotaLimit}
              onChange={(event) => setQuotaLimit(event.target.value)}
              placeholder="留空表示不限制额度，例如 100"
              className="h-11 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">每成功生成 1 张图片扣除 1 点额度。</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">用户套餐</label>
            <select
              value={plan}
              onChange={(event) => setPlan(event.target.value as UserPlan)}
              className="h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none focus:border-cyan-300"
            >
              {userPlanOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <p className="text-xs text-stone-500">{userPlanOptions.find((item) => item.value === plan)?.description}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setIsDialogOpen(false)}
              disabled={isCreating}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleCreate()}
              disabled={isCreating}
            >
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>调整用户额度</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              修改「{editingItem?.name}」可使用的图片额度。总额度留空表示不限制；已用额度可手动校正。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">用户套餐</label>
            <select
              value={editPlan}
              onChange={(event) => setEditPlan(event.target.value as UserPlan)}
              className="h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none focus:border-cyan-300"
            >
              {userPlanOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <p className="text-xs text-stone-500">{userPlanOptions.find((item) => item.value === editPlan)?.description}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">总额度</label>
              <Input
                type="number"
                min={0}
                value={editQuotaLimit}
                onChange={(event) => setEditQuotaLimit(event.target.value)}
                placeholder="留空表示不限制"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">已用额度</label>
              <Input
                type="number"
                min={0}
                value={editQuotaUsed}
                onChange={(event) => setEditQuotaUsed(event.target.value)}
                placeholder="0"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
          </div>
          {editingItem ? (
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
              当前：总额度 {formatQuota(editingItem.quota_limit)}，已用 {editingItem.quota_used || 0}，剩余 {formatQuota(editingItem.quota_remaining)}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setEditingItem(null)}
              disabled={isSavingQuota}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleSaveQuota()}
              disabled={isSavingQuota}
            >
              {isSavingQuota ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存额度
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
