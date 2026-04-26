"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { getDefaultRouteForRole, getStoredAuthSession } from "@/store/auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const redirect = async () => {
      let session = null;
      try {
        session = await getStoredAuthSession();
      } catch {
        session = null;
      }
      if (!active) {
        return;
      }
      router.replace(session ? getDefaultRouteForRole(session.role) : "/login");
    };

    void redirect();
    const fallback = window.setTimeout(() => {
      if (active) {
        router.replace("/login");
      }
    }, 1200);
    return () => {
      active = false;
      window.clearTimeout(fallback);
    };
  }, [router]);

  return (
    <div className="auth-shell">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <LoaderCircle className="size-4 animate-spin" />
        正在进入图像中枢
      </div>
    </div>
  );
}
