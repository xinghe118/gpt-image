"use client";

export function SettingsHeader() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-600">Settings</div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">系统设置</h1>
        <p className="text-sm leading-6 text-slate-500">网络、密钥、导入源和运行参数集中管理。</p>
      </div>
    </section>
  );
}
