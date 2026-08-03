import Link from "next/link";
import type { ReactNode } from "react";

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-3" aria-label="Dreamify home">
            <img src="/logo-favicon.png" alt="" className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight">Dreamify</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm" aria-label="Primary navigation">
            <Link href="/blog" className="font-medium text-foreground">Blog</Link>
            <Link href="/pricing" className="text-muted-foreground transition-colors hover:text-foreground">Free preview</Link>
            <Link href="/login" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">Sign in</Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-border/60 px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
          <span>Dreamify private, non-commercial Hobby preview.</span>
          <div className="flex gap-5">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/security">Security</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
