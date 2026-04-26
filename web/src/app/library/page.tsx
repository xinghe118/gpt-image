"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Images, LoaderCircle, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";
import { listImageConversations, type ImageConversation } from "@/store/image-conversations";

type LibraryItem = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  turnId: string;
  prompt: string;
  model: string;
  mode: string;
  size: string;
  createdAt: string;
  src: string;
};

const ACTIVE_CONVERSATION_STORAGE_KEY = "gpt-image:image_active_conversation_id";
const LEGACY_STORAGE_PREFIX = "chatgpt" + "2api";
const LEGACY_ACTIVE_CONVERSATION_STORAGE_KEY = `${LEGACY_STORAGE_PREFIX}:image_active_conversation_id`;

function collectLibraryItems(conversations: ImageConversation[]): LibraryItem[] {
  return conversations.flatMap((conversation) =>
    conversation.turns.flatMap((turn) =>
      turn.images.flatMap((image, index) => {
        if (image.status !== "success" || !image.b64_json) {
          return [];
        }
        return [{
          id: `${conversation.id}-${turn.id}-${image.id}-${index}`,
          conversationId: conversation.id,
          conversationTitle: conversation.title || "未命名会话",
          turnId: turn.id,
          prompt: turn.prompt,
          model: turn.model,
          mode: turn.mode,
          size: turn.size,
          createdAt: turn.createdAt,
          src: `data:image/png;base64,${image.b64_json}`,
        }];
      }),
    ),
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

function downloadImage(item: LibraryItem) {
  const link = document.createElement("a");
  link.href = item.src;
  link.download = `image-${item.id}.png`;
  link.click();
}

function LibraryPageContent() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const loadItems = async () => {
    setIsLoading(true);
    try {
      setItems(collectLibraryItems(await listImageConversations()));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取作品库失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (mode && item.mode !== mode) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [item.prompt, item.conversationTitle, item.model, item.size]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [items, mode, query]);

  const lightboxImages = useMemo(
    () => filteredItems.map((item) => ({ id: item.id, src: item.src })),
    [filteredItems],
  );

  const openConversation = (conversationId: string) => {
    window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId);
    window.localStorage.removeItem(LEGACY_ACTIVE_CONVERSATION_STORAGE_KEY);
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[45vh] place-items-center">
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
              作品资产
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">作品库</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">从本地会话历史自动汇总成功生成的图片，方便回看、下载和回到原会话继续创作。</p>
          </div>
          <Button className="h-10 rounded-lg bg-slate-950 text-white hover:bg-slate-800" onClick={() => void loadItems()}>
            <Sparkles className="size-4" />
            重新扫描
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索提示词、会话、模型或比例"
              className="h-10 rounded-lg border-slate-200 pl-9"
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
                onClick={() => setMode(value)}
                className={cn(
                  "h-10 rounded-lg px-3 text-sm font-medium transition",
                  mode === value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
          <div className="max-w-sm px-6">
            <Images className="mx-auto size-10 text-slate-300" />
            <div className="mt-4 text-lg font-semibold text-slate-950">还没有作品</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">完成一次图片生成后，成功的结果会自动出现在这里。</p>
            <Button asChild className="mt-5 rounded-lg bg-slate-950 text-white hover:bg-slate-800">
              <Link href="/image">去工作台</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="columns-1 gap-4 space-y-4 sm:columns-2 xl:columns-3 2xl:columns-4">
          {filteredItems.map((item, index) => (
            <article key={item.id} className="break-inside-avoid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className="group block w-full cursor-zoom-in bg-slate-100"
                onClick={() => {
                  setLightboxIndex(index);
                  setLightboxOpen(true);
                }}
              >
                <img src={item.src} alt={item.prompt} className="h-auto w-full transition group-hover:brightness-95" />
              </button>
              <div className="space-y-3 p-4">
                <div className="line-clamp-2 text-sm font-medium leading-6 text-slate-900">{item.prompt}</div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-lg bg-slate-100 px-2 py-1">{item.mode === "edit" ? "图生图" : "文生图"}</span>
                  <span className="rounded-lg bg-slate-100 px-2 py-1">{item.model}</span>
                  {item.size ? <span className="rounded-lg bg-slate-100 px-2 py-1">{item.size}</span> : null}
                  <span className="rounded-lg bg-slate-100 px-2 py-1">{formatTime(item.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <Button variant="outline" className="h-9 rounded-lg border-slate-200 bg-white" onClick={() => downloadImage(item)}>
                    <Download className="size-4" />
                    下载
                  </Button>
                  <Button asChild className="h-9 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700" onClick={() => openConversation(item.conversationId)}>
                    <Link href="/image">打开会话</Link>
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
    </section>
  );
}

export default function LibraryPage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return <LibraryPageContent />;
}
