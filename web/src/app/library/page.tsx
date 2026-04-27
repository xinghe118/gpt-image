"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Images, LoaderCircle, Pencil, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchLibraryItems, type LibraryImageItem } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

const PENDING_REFERENCE_IMAGE_STORAGE_KEY = "gpt-image:pending_reference_image";

function imageSrc(item: LibraryImageItem) {
  if (item.image_url) {
    return item.image_url;
  }
  return `data:image/png;base64,${item.b64_json}`;
}

function previewSrc(item: LibraryImageItem) {
  return item.thumb_url || imageSrc(item);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function LibraryPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<LibraryImageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("");
  const [selectedItem, setSelectedItem] = useState<LibraryImageItem | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = 48;

  const loadItems = async ({ append = false, modeOverride }: { append?: boolean; modeOverride?: string } = {}) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    try {
      const data = await fetchLibraryItems({
        limit: pageSize,
        offset: append ? items.length : 0,
        q: query.trim(),
        mode: modeOverride ?? mode,
      });
      setItems((current) => (append ? [...current, ...data.items] : data.items));
      setHasMore(data.has_more);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取作品库失败");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (isCheckingAuth || !session || didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadItems();
  }, [isCheckingAuth, session]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      return !mode || item.mode === mode;
    });
  }, [items, mode]);

  const downloadImage = (item: LibraryImageItem) => {
    const link = document.createElement("a");
    link.href = imageSrc(item);
    link.download = `image-${item.id}.png`;
    link.click();
  };

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const continueEdit = (item: LibraryImageItem) => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        PENDING_REFERENCE_IMAGE_STORAGE_KEY,
        JSON.stringify({
          id: item.id,
          url: imageSrc(item),
          prompt: item.prompt,
          model: item.model,
          mode: item.mode,
          size: item.size,
          name: `library-${item.id}.png`,
        }),
      );
      window.location.href = "/image/";
    } catch {
      toast.error("无法加入工作台，请下载后手动上传参考图");
    }
  };

  if (isCheckingAuth || !session) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <section className="page-shell space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
              <Images className="size-4" />
              {session.role === "admin" ? "全站作品资产" : "我的作品资产"}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">作品库</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {session.role === "admin" ? "管理员可查看所有用户生成的作品。" : "这里只展示当前用户密钥生成的作品。"}
            </p>
          </div>
          <Button className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => void loadItems()}>
            <Sparkles className="size-4" />
            重新扫描
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索提示词、用户、模型或比例"
              className="h-10 rounded-lg border-slate-200 pl-9"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void loadItems();
                }
              }}
            />
          </div>
          <div className="flex gap-2">
            {[
              ["", "全部"],
              ["generate", "文生图"],
              ["edit", "图生图"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  void loadItems({ modeOverride: value });
                }}
                className={cn(
                  "h-10 rounded-lg px-3 text-sm font-medium transition",
                  mode === value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" onClick={() => void loadItems()}>
            应用筛选
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid min-h-[360px] place-items-center rounded-2xl border border-slate-200 bg-white">
          <LoaderCircle className="size-5 animate-spin text-slate-400" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
          <div className="max-w-sm px-6">
            <Images className="mx-auto size-10 text-slate-300" />
            <div className="mt-4 text-lg font-semibold text-slate-950">还没有作品</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">完成一次图片生成后，成功的结果会自动出现在这里。</p>
          </div>
        </div>
      ) : (
        <div className="columns-1 gap-4 space-y-4 sm:columns-2 xl:columns-3 2xl:columns-4">
          {filteredItems.map((item) => (
            <article key={item.id} className="break-inside-avoid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button type="button" className="group block w-full cursor-zoom-in bg-slate-100" onClick={() => setSelectedItem(item)}>
                <img src={previewSrc(item)} alt={item.prompt} loading="lazy" className="h-auto w-full transition group-hover:brightness-95" />
              </button>
              <div className="space-y-3 p-4">
                <div className="line-clamp-2 text-sm font-medium leading-6 text-slate-900">{item.prompt}</div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-lg bg-slate-100 px-2 py-1">{item.mode === "edit" ? "图生图" : "文生图"}</span>
                  <span className="rounded-lg bg-slate-100 px-2 py-1">{item.model}</span>
                  {item.size ? <span className="rounded-lg bg-slate-100 px-2 py-1">{item.size}</span> : null}
                  <span className="rounded-lg bg-slate-100 px-2 py-1">{formatTime(item.created_at)}</span>
                  {session.role === "admin" ? <span className="rounded-lg bg-cyan-50 px-2 py-1 text-cyan-700">{item.subject_name}</span> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {!isLoading && hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" className="h-10 rounded-lg border-slate-200 bg-white" disabled={isLoadingMore} onClick={() => void loadItems({ append: true })}>
            {isLoadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}
            加载更多
          </Button>
        </div>
      ) : null}

      {selectedItem ? (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
          <aside
            className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <div className="text-sm font-semibold text-slate-950">作品详情</div>
                <div className="text-xs text-slate-500">{formatTime(selectedItem.created_at)}</div>
              </div>
              <button className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-500" onClick={() => setSelectedItem(null)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <img src={imageSrc(selectedItem)} alt={selectedItem.prompt} className="w-full rounded-xl bg-slate-100" />
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Prompt</div>
                  <p className="mt-2 text-sm leading-6 text-slate-800">{selectedItem.prompt}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Info label="模型" value={selectedItem.model} />
                  <Info label="模式" value={selectedItem.mode === "edit" ? "图生图" : "文生图"} />
                  <Info label="比例" value={selectedItem.size || "未指定"} />
                  <Info label="用户" value={selectedItem.subject_name || selectedItem.subject_id} />
                </div>
              </div>
            </div>
            <div className="flex gap-2 border-t border-slate-200 p-4">
              <Button variant="outline" className="h-10 flex-1 rounded-lg border-slate-200 bg-white" onClick={() => continueEdit(selectedItem)}>
                <Pencil className="size-4" />
                继续编辑
              </Button>
              <Button className="h-10 flex-1 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => downloadImage(selectedItem)}>
                <Download className="size-4" />
                下载
              </Button>
              <Button variant="outline" className="h-10 flex-1 rounded-lg border-slate-200 bg-white" onClick={() => void copyPrompt(selectedItem.prompt)}>
                <Copy className="size-4" />
                复制提示词
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 truncate font-medium text-slate-800">{value}</div>
    </div>
  );
}
