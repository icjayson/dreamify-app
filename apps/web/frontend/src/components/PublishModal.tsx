import { useEffect, useMemo, useState } from 'react';
import { X, Check, Copy, Mail, Globe, Shield, Loader2, Download } from 'lucide-react';
import { captureDashboardAsPdf, downloadBlob } from '@/utils/exportUtils';
import { useChatStore } from '@/stores/useChatStore';

interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BASE_DOMAIN = 'dreamify.dev';

const isValidSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(s);

export default function PublishModal({ open, onOpenChange }: PublishModalProps) {
  const [activeTab, setActiveTab] = useState<'share' | 'export'>('share');
  const [slug, setSlug] = useState('dashboard-' + Math.random().toString(16).slice(2, 8));
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invited, setInvited] = useState<string[]>([]);
  const originalFileBlob = useChatStore(s => s.originalFileBlob);
  const originalFileName = useChatStore(s => s.originalFileName);

  useEffect(() => {
    if (!open) return;
    setActiveTab('share');
  }, [open]);

  // Mock slug availability check
  useEffect(() => {
    setAvailable(null);
    if (!slug || !isValidSlug(slug)) return;
    setChecking(true);
    const id = setTimeout(() => {
      setAvailable(slug !== 'taken-demo');
      setChecking(false);
    }, 400);
    return () => clearTimeout(id);
  }, [slug]);

  const fullUrl = useMemo(() => `https://${slug}.${BASE_DOMAIN}`, [slug]);

  if (!open) return null;

  const close = () => onOpenChange(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(fullUrl); } catch (_e) {}
  };

  const handleInvite = () => {
    const emailOk = /.+@.+\..+/.test(inviteEmail);
    if (!emailOk) return;
    setInvited((prev) => Array.from(new Set([...prev, inviteEmail])));
    setInviteEmail('');
  };

  const handleExportPdf = async () => {
    const el = document.getElementById('dashboard-preview-root');
    if (!el) return;
    await captureDashboardAsPdf(el, { filename: `dashboard-${new Date().toISOString().slice(0,10)}.pdf` });
  };

  const handleExportCsv = () => {
    if (!originalFileBlob || !originalFileName) return;
    downloadBlob(originalFileBlob, originalFileName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={close} />
      <div className="relative w-full max-w-lg mx-4 md:mx-0 bg-background rounded-2xl border border-white/10 shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">Publish Dashboard</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-600/20 text-green-400">Live</span>
          </div>
          <button onClick={close} className="p-2 hover:bg-white/5 rounded-md"><X className="w-4 h-4"/></button>
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3">
          <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
            <button onClick={() => setActiveTab('share')} className={`px-3 py-1.5 text-sm ${activeTab==='share' ? 'bg-white/10' : ''}`}>Share Settings</button>
            <button onClick={() => setActiveTab('export')} className={`px-3 py-1.5 text-sm ${activeTab==='export' ? 'bg-white/10' : ''}`}>Export Options</button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {activeTab === 'share' && (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-2">Website Address</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-background/60">
                    <Globe className="w-4 h-4"/>
                    <input
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-/,'').replace(/-$/,''))}
                      placeholder="your-dashboard"
                      className="bg-transparent outline-none text-sm flex-1"
                    />
                    <span className="text-sm text-muted-foreground">.{BASE_DOMAIN}</span>
                  </div>
                  <button onClick={handleCopy} className="button-outline h-9 px-3 flex items-center gap-2 text-sm"><Copy className="w-4 h-4"/>Copy</button>
                </div>
                <div className="h-5 mt-1 text-xs">
                  {!slug || !isValidSlug(slug) ? (
                    <span className="text-red-400">Slug must be 3–50 chars, lowercase letters, numbers, hyphens</span>
                  ) : checking ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin"/>Checking availability…</span>
                  ) : available === false ? (
                    <span className="text-red-400">This slug is taken</span>
                  ) : available === true ? (
                    <span className="inline-flex items-center gap-1 text-green-400"><Check className="w-3 h-3"/>Available</span>
                  ) : null}
                </div>
              </div>

              <div className="py-2 border-t border-white/10">
                <button className="w-full flex items-center justify-between py-2 text-sm text-left text-muted-foreground">
                  <span className="opacity-70">+ Custom Domain</span>
                  <span className="text-xs">(coming soon)</span>
                </button>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Share</div>
                <div className="flex gap-2">
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Invite by email"
                    className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-background/60 text-sm"
                  />
                  <button onClick={handleInvite} className="button-gradient h-9 px-3 text-sm flex items-center gap-2"><Mail className="w-4 h-4"/>Invite</button>
                </div>
                {!!invited.length && (
                  <div className="text-xs text-muted-foreground">Invited: {invited.join(', ')}</div>
                )}
                <div className="flex items-center justify-between text-sm text-muted-foreground rounded-lg border border-white/10 px-3 py-2">
                  <span>Everyone can view</span>
                  <span>Public</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button className="button-outline h-9 px-3 flex items-center gap-2 text-sm"><Shield className="w-4 h-4"/>Review Security</button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400">Updated</span>
              </div>
            </div>
          )}

          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={handleExportPdf} className="p-3 glass-panel rounded-xl text-sm font-medium hover:bg-primary/10 transition-all duration-200 flex items-center justify-center gap-2"><Download className="w-4 h-4"/>Export PDF</button>
                <button onClick={handleExportCsv} disabled={!originalFileBlob} className="p-3 glass-panel rounded-xl text-sm font-medium hover:bg-primary/10 transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"><Download className="w-4 h-4"/>Export CSV</button>
              </div>
              {!originalFileBlob && (
                <div className="text-xs text-muted-foreground">CSV export is available when the original uploaded file is a CSV.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile full-screen styles */}
      <style>{`
        @media (max-width: 640px) {
          .max-w-lg { max-width: 100%; height: 100vh; border-radius: 0; }
        }
      `}</style>
    </div>
  );
}


