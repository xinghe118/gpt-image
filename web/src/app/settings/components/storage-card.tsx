"use client";

import { useEffect, useState } from "react";
import { Database, HardDriveUpload, LoaderCircle, Save, ShieldCheck, UploadCloud, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchStorageInfo, migrateStorageToDatabase, testObjectStorage } from "@/lib/api";

import { useSettingsStore } from "../store";

function text(value: unknown, fallback = "--") {
  const output = String(value ?? "").trim();
  return output || fallback;
}

export function StorageCard() {
  const config = useSettingsStore((state) => state.config);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const saveConfig = useSettingsStore((state) => state.saveConfig);
  const setConfigValue = useSettingsStore((state) => state.setConfigValue);
  const [storageInfo, setStorageInfo] = useState<Record<string, unknown> | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(true);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isTestingObjectStorage, setIsTestingObjectStorage] = useState(false);

  const loadStorageInfo = async () => {
    setIsLoadingInfo(true);
    try {
      setStorageInfo(await fetchStorageInfo());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取存储状态失败");
    } finally {
      setIsLoadingInfo(false);
    }
  };

  useEffect(() => {
    void loadStorageInfo();
  }, []);

  const handleMigrate = async () => {
    setIsMigrating(true);
    try {
      const data = await migrateStorageToDatabase();
      toast.success(`迁移完成：${JSON.stringify(data.result)}`);
      await loadStorageInfo();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "迁移失败");
    } finally {
      setIsMigrating(false);
    }
  };

  const handleTestObjectStorage = async () => {
    setIsTestingObjectStorage(true);
    try {
      const data = await testObjectStorage();
      toast.success(`上传测试成功：${text(data.result.url)}`);
      await loadStorageInfo();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "对象存储测试失败");
    } finally {
      setIsTestingObjectStorage(false);
    }
  };

  const appData = (storageInfo?.app_data || {}) as Record<string, unknown>;
  const backend = (storageInfo?.backend || {}) as Record<string, unknown>;
  const objectStorage = (storageInfo?.object_storage || {}) as Record<string, unknown>;

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-base font-semibold text-slate-950">持久化与对象存储</div>
              <div className="mt-1 text-sm text-slate-500">数据库化作品、日志和导入源配置；图片 URL 可切换到 S3/R2/OSS。</div>
            </div>
            <Button
              className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
              onClick={() => void loadStorageInfo()}
              disabled={isLoadingInfo}
            >
              {isLoadingInfo ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              刷新状态
            </Button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <StatusBox icon={Database} label="账号存储" value={text(backend.type)} detail={text(backend.description)} />
            <StatusBox icon={HardDriveUpload} label="应用数据" value={text(appData.backend)} detail={text(appData.status)} />
            <StatusBox icon={UploadCloud} label="对象存储" value={text(objectStorage.status)} detail={text(objectStorage.bucket)} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-950">一键迁移到数据库</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  将本地 `library.json`、`activity_logs.jsonl`、CPA 和 Sub2API 配置迁移到当前数据库。需要先用 PostgreSQL/SQLite 启动。
                </p>
              </div>
              <Button
                className="h-10 rounded-xl bg-cyan-600 text-white hover:bg-cyan-700"
                onClick={() => void handleMigrate()}
                disabled={isMigrating}
              >
                {isMigrating ? <LoaderCircle className="size-4 animate-spin" /> : <Database className="size-4" />}
                开始迁移
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">图片对象存储</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">兼容 S3 API，适合 Cloudflare R2、AWS S3、阿里 OSS S3 endpoint。</p>
              </div>
              <button
                type="button"
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  config?.object_storage_enabled ? "bg-cyan-600" : "bg-slate-300"
                }`}
                aria-pressed={config?.object_storage_enabled === true}
                onClick={() => setConfigValue("object_storage_enabled", !config?.object_storage_enabled)}
              >
                <span
                  className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition ${
                    config?.object_storage_enabled ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Endpoint" value={config?.object_storage_endpoint} onChange={(value) => setConfigValue("object_storage_endpoint", value)} placeholder="https://<account>.r2.cloudflarestorage.com" />
              <Field label="Bucket" value={config?.object_storage_bucket} onChange={(value) => setConfigValue("object_storage_bucket", value)} placeholder="gpt-image" />
              <Field label="Region" value={config?.object_storage_region} onChange={(value) => setConfigValue("object_storage_region", value)} placeholder="auto" />
              <Field label="Access Key ID" value={config?.object_storage_access_key_id} onChange={(value) => setConfigValue("object_storage_access_key_id", value)} placeholder="AKIA..." />
              <Field label="Secret Access Key" value={config?.object_storage_secret_access_key} onChange={(value) => setConfigValue("object_storage_secret_access_key", value)} placeholder="留空则不覆盖已保存密钥" type="password" />
              <Field label="Public Base URL" value={config?.object_storage_public_base_url} onChange={(value) => setConfigValue("object_storage_public_base_url", value)} placeholder="https://cdn.example.com" />
              <Field label="Prefix" value={config?.object_storage_prefix} onChange={(value) => setConfigValue("object_storage_prefix", value)} placeholder="images" />
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                onClick={() => void handleTestObjectStorage()}
                disabled={isTestingObjectStorage}
              >
                {isTestingObjectStorage ? <LoaderCircle className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                测试上传
              </Button>
              <Button
                className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => void saveConfig()}
                disabled={isSavingConfig}
              >
                {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存存储配置
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBox({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-white text-cyan-700 shadow-sm">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="truncate text-sm font-semibold text-slate-950">{value}</div>
        </div>
      </div>
      <div className="mt-3 truncate text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <Input
        type={type}
        value={String(value || "")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border-slate-200 bg-white"
      />
    </label>
  );
}
