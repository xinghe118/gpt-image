"use client";

import { useCallback } from "react";

import {
  createImageEditJob,
  createImageGenerationJob,
  fetchImageJob,
  type GeneratedImageData,
  type ImageJob,
  type ImageModel,
} from "@/lib/api";
import { toFriendlyErrorMessage } from "@/lib/friendly-error";
import type { ImageConversationMode } from "@/store/image-conversations";

type ImageJobProgressHandler = (job: ImageJob) => void;

type RunImageJobOptions = {
  mode: ImageConversationMode;
  referenceFiles: File[];
  prompt: string;
  model: ImageModel;
  size: string;
  projectId: string;
  onProgress?: ImageJobProgressHandler;
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useImageJobRunner() {
  const waitForImageJob = useCallback(async (jobId: string, onProgress?: ImageJobProgressHandler) => {
    const startedAt = Date.now();
    let interval = 1500;
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      const { job } = await fetchImageJob(jobId);
      onProgress?.(job);
      if (job.status === "succeeded") {
        return job.result;
      }
      if (job.status === "failed") {
        const retryHint = job.retryable ? "，可以重试" : "";
        throw new Error(toFriendlyErrorMessage(job.error || `生成失败${retryHint}`));
      }
      await delay(interval);
      interval = Math.min(5000, interval + 500);
    }
    throw new Error("图片生成仍在处理中，请稍后到作品库查看");
  }, []);

  const runImageJob = useCallback(
    async ({
      mode,
      referenceFiles,
      prompt,
      model,
      size,
      projectId,
      onProgress,
    }: RunImageJobOptions): Promise<GeneratedImageData> => {
      const { job } =
        mode === "edit"
          ? await createImageEditJob(referenceFiles, prompt, model, size, projectId)
          : await createImageGenerationJob(prompt, model, size, projectId);
      onProgress?.(job);
      const result = await waitForImageJob(job.job_id, onProgress);
      const first = result?.data?.[0];
      if (!first?.b64_json && !first?.url) {
        throw new Error("上游已结束请求，但没有返回可下载的图片。请换一个提示词或重试。");
      }
      return first;
    },
    [waitForImageJob],
  );

  return { runImageJob };
}
