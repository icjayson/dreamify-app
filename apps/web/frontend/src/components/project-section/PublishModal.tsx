import { useEffect, useMemo, useState } from 'react';
import { X, Check, Copy, Mail, Globe, Shield, Loader2, Download, SquareArrowOutUpRight, Edit3 } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { exportDashboardAsPdf, downloadBlob } from '@/utils/exportUtils';
import { useChatStore } from '@/chat/useChatStore';

interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
}

const BASE_DOMAIN = 'dreamify.dev';

const isValidSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(s);

export default function PublishModal({ open, onOpenChange, projectId }: PublishModalProps) {
  const [activeTab, setActiveTab] = useState<'share' | 'export'>('share');
  const [slug, setSlug] = useState('dashboard-' + Math.random().toString(16).slice(2, 8));
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invited, setInvited] = useState<string[]>([]);
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const originalFileBlob = useChatStore(s => s.originalFileBlob);
  const originalFileName = useChatStore(s => s.originalFileName);
  const uploadedFile = useChatStore(s => s.uploadedFile);

  // Detect desktop screens so we only mount one container: Sheet (mobile) or Dialog (desktop)
  const [isDesktop, setIsDesktop] = useState<boolean>(false);
  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 640px)') : null;
    const update = () => setIsDesktop(!!mq && mq.matches);
    update();
    if (mq) {
      try {
        mq.addEventListener('change', update);
      } catch {
        // Safari fallback
        // @ts-ignore
        mq.addListener(update);
      }
    }
    return () => {
      if (mq) {
        try {
          mq.removeEventListener('change', update);
        } catch {
          // @ts-ignore
          mq.removeListener(update);
        }
      }
    };
  }, []);

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
  const previewUrl = useMemo(() => {
    const baseUrl = window.location.origin;
    return projectId 
      ? `${baseUrl}/workspace/project/preview?projectId=${projectId}`
      : `${baseUrl}/workspace/project/preview`;
  }, [projectId]);

  if (!open) return null;

  const close = () => onOpenChange(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(previewUrl); } catch (_e) {}
  };

  const handleInvite = () => {
    const emailOk = /.+@.+\..+/.test(inviteEmail);
    if (!emailOk) return;
    setInvited((prev) => Array.from(new Set([...prev, inviteEmail])));
    setInviteEmail('');
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    
    try {
      await exportDashboardAsPdf();
    } catch (error) {
      console.error('PDF export failed:', error);
      // You could add a toast notification here
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportCsv = () => {
    if (!originalFileBlob || !originalFileName) return;
    downloadBlob(originalFileBlob, originalFileName);
  };

  const handleOpenPublishedDashboard = () => {
    try {
      if (uploadedFile?.processedData) {
        sessionStorage.setItem('project_preview_data', JSON.stringify(uploadedFile.processedData));
      }
    } catch (_e) {
      // ignore errors
    }
    const previewUrl = projectId 
      ? `/workspace/project/preview?projectId=${projectId}`
      : '/workspace/project/preview';
    window.open(previewUrl, '_blank');
  };

  const handleEditSlug = () => {
    setIsEditingSlug(true);
  };

  const handleSaveSlug = () => {
    setIsEditingSlug(false);
  };

  const InnerContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">Publish Dashboard</span>
        </div>
        <button onClick={close} className="p-2 hover:bg-white/5 rounded-md"><X className="w-4 h-4"/></button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        {activeTab === 'share' && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Share Link</div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-black group hover:bg-black/80 transition-all duration-200 min-w-0">
                  <Globe className="w-4 h-4 flex-shrink-0"/>
                  {isEditingSlug ? (
                    <input
                      value={previewUrl}
                      readOnly
                      className="bg-transparent outline-none text-sm flex-1 text-white/70 truncate min-w-0"
                      autoFocus
                    />
                  ) : (
                    <button 
                      onClick={handleOpenPublishedDashboard}
                      className="text-sm text-white group-hover:underline cursor-pointer flex items-center transition-all duration-200 flex-1 text-left truncate min-w-0"
                    >
                      {previewUrl}
                    </button>
                  )}
                  {!isEditingSlug && (
                    <button 
                      onClick={handleOpenPublishedDashboard}
                      className="text-muted-foreground hover:text-white transition-colors duration-200 flex-shrink-0"
                    >
                      <SquareArrowOutUpRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="hidden sm:flex py-2 items-center gap-2 flex-shrink-0">
                  <button 
                    onClick={isEditingSlug ? handleSaveSlug : handleEditSlug} 
                    className="button-outline h-9 px-3 flex items-center gap-2 text-sm"
                  >
                    {isEditingSlug ? (
                      <>
                        <Check className="w-4 h-4"/>
                        Done
                      </>
                    ) : (
                      <>
                        <Edit3 className="w-4 h-4"/>
                        Edit
                      </>
                    )}
                  </button>
                  <button onClick={handleCopy} className="button-outline h-9 px-3 flex items-center gap-2 text-sm"><Copy className="w-4 h-4"/></button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 sm:mt-2">
                <div className="h-5 text-xs">
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
                <div className="flex sm:hidden items-center gap-2">
                  <button 
                    onClick={isEditingSlug ? handleSaveSlug : handleEditSlug} 
                    className="button-outline h-9 px-3 flex items-center gap-2 text-sm"
                  >
                    {isEditingSlug ? (
                      <>
                        <Check className="w-4 h-4"/>
                        Done
                      </>
                    ) : (
                      <>
                        <Edit3 className="w-4 h-4"/>
                        Edit
                      </>
                    )}
                  </button>
                  <button onClick={handleCopy} className="button-outline h-9 px-3 flex items-center gap-2 text-sm"><Copy className="w-4 h-4"/></button>
                </div>
              </div>
            </div>

            <div className="py-0">
              <button className="w-full flex items-center justify-between py-0 text-sm text-left text-muted-foreground">
                <span className="opacity-70">+ Custom Domain</span>
                <span className="text-xs">(coming soon)</span>
              </button>
            </div>

            <div className="space-y-3 pt-4 border-t border-white/10">
              <div className="text-sm font-medium">Export Options</div>
              <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={handleExportPdf} 
                disabled={isExportingPdf}
                className="p-3 glass-panel rounded-xl text-sm font-medium hover:bg-black transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isExportingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin"/>
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4"/>
                    Export PDF
                  </>
                )}
              </button>
              <button onClick={handleExportCsv} disabled={!originalFileBlob} className="p-3 glass-panel rounded-xl text-sm font-medium hover:bg-black transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"><Download className="w-4 h-4"/>Export CSV</button>
            </div>
            {!originalFileBlob && (
              <div className="text-xs text-muted-foreground font-inter italic">CSV export is available when the original uploaded file is a CSV.</div>
            )}
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile: bottom sheet - ONLY mounted on screens < sm */}
      {open && !isDesktop && (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[80vh] w-full bg-muted border-t border-white/10 rounded-t-2xl overflow-hidden p-0">
            {/* Drag handle */}
            <div className="w-full flex justify-center pt-2 pb-1 select-none">
              <div className="h-1.5 w-12 rounded-full bg-white/20" />
            </div>
            {/* Panel content */}
            <div className="relative z-10 w-full h-[calc(80vh-20px)] overflow-hidden">
              <div className="relative w-full h-full bg-muted overflow-hidden">
                {InnerContent}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop/Tablet: centered dialog - ONLY mounted on screens >= sm */}
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60" onClick={close} />
          <div className="relative w-full max-w-lg mx-4 md:mx-0 bg-muted rounded-2xl border border-white/10 shadow-xl overflow-hidden">
            {InnerContent}
          </div>
        </div>
    </>
  );
}


