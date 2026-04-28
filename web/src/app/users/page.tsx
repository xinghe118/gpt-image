"use client";

import { KeyRound, LoaderCircle } from "lucide-react";

import { UserKeysCard } from "@/app/settings/components/user-keys-card";
import { useAuthGuard } from "@/lib/use-auth-guard";

export default function UsersPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <section className="page-shell-wide space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
              <KeyRound className="size-4" />
              Access Keys
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">用户密钥</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              统一管理普通用户访问密钥、套餐能力、可用额度和启停状态。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs md:min-w-52">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-slate-400">用途</div>
              <div className="mt-1 font-semibold text-slate-900">分发访问</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-slate-400">控制</div>
              <div className="mt-1 font-semibold text-slate-900">额度 / 套餐</div>
            </div>
          </div>
        </div>
      </div>

      <UserKeysCard />
    </section>
  );
}
