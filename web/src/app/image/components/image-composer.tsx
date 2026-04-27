"use client";
import { ArrowUp, ImagePlus, LoaderCircle, X } from "lucide-react";
import { useMemo, useState, type ClipboardEvent, type RefObject } from "react";

import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ImageConversationMode, ImageReferenceStrength } from "@/store/image-conversations";

type ImageComposerProps = {
  mode: ImageConversationMode;
  prompt: string;
  availableQuota: string;
  activeTaskCount: number;
  referenceStrength: ImageReferenceStrength;
  referenceImages: Array<{ name: string; dataUrl: string }>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPromptChange: (value: string) => void;
  onReferenceStrengthChange: (value: ImageReferenceStrength) => void;
  onSubmit: () => void | Promise<void>;
  onPickReferenceImage: () => void;
  onReferenceImageChange: (files: File[]) => void | Promise<void>;
  onRemoveReferenceImage: (index: number) => void;
};

export function ImageComposer({
  mode,
  prompt,
  availableQuota,
  activeTaskCount,
  referenceStrength,
  referenceImages,
  textareaRef,
  fileInputRef,
  onPromptChange,
  onReferenceStrengthChange,
  onSubmit,
  onPickReferenceImage,
  onReferenceImageChange,
  onRemoveReferenceImage,
}: ImageComposerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const lightboxImages = useMemo(
    () => referenceImages.map((image, index) => ({ id: `${image.name}-${index}`, src: image.dataUrl })),
    [referenceImages],
  );

  const handleTextareaPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void onReferenceImageChange(imageFiles);
  };

  return (
    <div className="flex shrink-0 justify-center">
      <div style={{ width: "min(980px, 100%)" }}>
        {mode === "edit" && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void onReferenceImageChange(Array.from(event.target.files || []));
            }}
          />
        )}

        {mode === "edit" && referenceImages.length > 0 ? (
          <div className="mb-3 space-y-3 px-1">
            <div className="flex flex-wrap gap-2">
              {referenceImages.map((image, index) => (
                <div key={`${image.name}-${index}`} className="relative size-16">
                  <button
                    type="button"
                    onClick={() => {
                      setLightboxIndex(index);
                      setLightboxOpen(true);
                    }}
                    className="group size-16 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition hover:border-slate-300"
                    aria-label={`预览参考图 ${image.name || index + 1}`}
                  >
                    <img
                      src={image.dataUrl}
                      alt={image.name || `参考图 ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveReferenceImage(index);
                    }}
                    className="absolute -right-1 -top-1 inline-flex size-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
                    aria-label={`移除参考图 ${image.name || index + 1}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-100 bg-cyan-50/70 px-3 py-2">
              <span className="text-xs font-medium text-cyan-900">参考强度</span>
              <div className="grid grid-cols-3 gap-1">
                {[
                  ["low", "低"],
                  ["medium", "中"],
                  ["high", "高"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`h-7 rounded-lg px-3 text-xs font-medium transition ${
                      referenceStrength === value ? "bg-cyan-700 text-white" : "bg-white text-cyan-700"
                    }`}
                    onClick={() => onReferenceStrengthChange(value as ImageReferenceStrength)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            className="relative cursor-text"
            onClick={() => {
              textareaRef.current?.focus();
            }}
          >
            <ImageLightbox
              images={lightboxImages}
              currentIndex={lightboxIndex}
              open={lightboxOpen}
              onOpenChange={setLightboxOpen}
              onIndexChange={setLightboxIndex}
            />
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onPaste={handleTextareaPaste}
              placeholder={
                mode === "edit" ? "描述你希望如何修改这张参考图，可直接粘贴图片" : "输入你想要生成的画面，也可直接粘贴图片"
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
              className="min-h-[132px] resize-none rounded-2xl border-0 bg-transparent px-5 pb-16 pt-5 text-[15px] leading-7 text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0"
            />

            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-4 pt-6 sm:px-5">
              <div className="flex items-end justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-none hover:bg-slate-50 sm:h-10 sm:px-4 sm:text-sm"
                    onClick={onPickReferenceImage}
                  >
                    <ImagePlus className="size-3.5 sm:size-4" />
                    <span className="hidden sm:inline">{referenceImages.length > 0 ? "继续添加参考图" : "上传参考图"}</span>
                    <span className="sm:hidden">{referenceImages.length > 0 ? "继续" : "上传"}</span>
                  </Button>
                  <div className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 sm:px-3 sm:py-2 sm:text-xs">
                    <span className="hidden xs:inline">剩余额度 </span>{availableQuota}
                  </div>
                  {activeTaskCount > 0 && (
                    <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs">
                      <LoaderCircle className="size-3 animate-spin" />
                      {activeTaskCount}<span className="hidden sm:inline"> 个任务处理中</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void onSubmit()}
                  disabled={!prompt.trim() || (mode === "edit" && referenceImages.length === 0)}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:size-11"
                  aria-label={mode === "edit" ? "编辑图片" : "生成图片"}
                >
                  <ArrowUp className="size-3.5 sm:size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
