import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">404</p>
        <h1 className="mt-3 text-4xl font-semibold">Page not found</h1>
        <p className="mt-4 text-muted-foreground">The requested Dreamify page does not exist.</p>
        <Link href="/" className="button-gradient mt-8 inline-flex rounded-lg px-5 py-3 font-medium">Return home</Link>
      </div>
    </main>
  );
}
