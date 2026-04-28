"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText, FolderKanban, Images, ImageIcon, LayoutDashboard, ListChecks, LogOut, Settings, UsersRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import webConfig from "@/constants/common-env";
import { clearStoredAuthSession, getStoredAuthSession, type StoredAuthSession } from "@/store/auth";
import { cn } from "@/lib/utils";

const adminNavItems = [
  { href: "/image", label: "工作台", icon: ImageIcon },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/library", label: "作品库", icon: Images },
  { href: "/admin", label: "概览", icon: LayoutDashboard },
  { href: "/admin/logs", label: "日志", icon: FileText },
  { href: "/admin/jobs", label: "任务", icon: ListChecks },
  { href: "/users", label: "用户", icon: UsersRound },
  { href: "/accounts", label: "账号池", icon: UsersRound },
  { href: "/settings", label: "系统", icon: Settings },
];

const userNavItems = [
  { href: "/image", label: "工作台", icon: ImageIcon },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/library", label: "作品库", icon: Images },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<StoredAuthSession | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (pathname === "/login") {
        if (!active) {
          return;
        }
        setSession(null);
        return;
      }

      const storedSession = await getStoredAuthSession();
      if (!active) {
        return;
      }
      setSession(storedSession);
    };

    void load();
    return () => {
      active = false;
    };
  }, [pathname]);

  const handleLogout = async () => {
    await clearStoredAuthSession();
    router.replace("/login");
  };

  if (pathname === "/login" || session === undefined || !session) {
    return null;
  }

  const navItems = session.role === "admin" ? adminNavItems : userNavItems;
  const roleLabel = session.role === "admin" ? "管理员" : "普通用户";

  return (
    <header className="sticky top-0 z-40 rounded-b-2xl border-b border-slate-200/80 bg-white/85 shadow-sm shadow-slate-200/50 backdrop-blur-xl">
      <div className="app-shell flex min-h-14 items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/image"
            className="flex items-center gap-2 py-1 text-[14px] font-bold tracking-tight text-slate-950 transition hover:text-slate-700 sm:text-[15px]"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-slate-950 text-white">
              <ImageIcon className="size-4" />
            </span>
            图像中枢
          </Link>
        </div>
        <div className="hide-scrollbar flex flex-1 justify-center gap-1 overflow-x-auto sm:gap-2">
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/image" && item.href !== "/admin" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition sm:px-3 sm:text-sm",
                  active ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 sm:gap-3">
          <span className="hidden rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 sm:inline-block sm:text-[11px]">
            {roleLabel}
          </span>
          <span className="hidden rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 lg:inline-block">
            v{webConfig.appVersion}
          </span>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={() => void handleLogout()}
            aria-label="退出登录"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
