import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "图像中枢",
  description: "GPT Image workspace and account pool console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className="antialiased"
        style={{
          fontFamily:
            '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
        }}
      >
        <Toaster position="top-center" richColors />
        <main className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
          <div className="flex min-h-screen flex-col gap-5 pb-5">
            <TopNav />
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
