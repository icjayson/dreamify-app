import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { X, Check, Copy, Mail, Globe, Shield, Loader2, Download, SquareArrowOutUpRight, UserPlus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { exportDashboardAsPdf, exportDashboardAsPng, downloadBlob } from '@/utils/exportUtils';
import { useChatStore } from '@/chat/useChatStore';
import { projectService, type AllowedUser } from '@/services/projectService';
import { userService, type UserLookupResult } from '@/services/userService';
import { useDashboard } from '@/hooks/useDashboard';
import DashboardPreview from './DashboardPreview';

interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  processedData?: any;
  isDarkMode?: boolean;
}

const BASE_DOMAIN = 'dreamify.dev';

const isValidSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(s);

export default function PublishModal({ open, onOpenChange, projectId, processedData, isDarkMode }: PublishModalProps) {
  const [activeTab, setActiveTab] = useState<'share' | 'export'>('share');
  const [slug, setSlug] = useState('dashboard-' + Math.random().toString(16).slice(2, 8));
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invited, setInvited] = useState<string[]>([]);

  // State to track if the dashboard split into two columns for export
  const [exportDidSplit, setExportDidSplit] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isPreviewPublic, setIsPreviewPublic] = useState(false);
  const [isUpdatingPublic, setIsUpdatingPublic] = useState(false);
  const [copied, setCopied] = useState(false);

  // Private sharing state
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupResult, setLookupResult] = useState<UserLookupResult | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [showLookupPopup, setShowLookupPopup] = useState(false);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUser[]>([]);
  const [isUpdatingAllowed, setIsUpdatingAllowed] = useState(false);
  const lookupContainerRef = useRef<HTMLDivElement>(null);
  const allowedUsersRef = useRef<AllowedUser[]>([]);

  const originalFileBlob = useChatStore(s => s.originalFileBlob);
  const originalFileName = useChatStore(s => s.originalFileName);
  const uploadedFiles = useChatStore(s => s.uploadedFiles);

  // Fetch active project dashboard config locally for export mounting
  const { dashboardState } = useDashboard(projectId);

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

  // Load current is_preview_public value and allowed users when modal opens
  useEffect(() => {
    if (!open || !projectId) return;

    const loadProjectSettings = async () => {
      try {
        const response = await projectService.getProject(projectId);
        if (response.success && response.project) {
          setIsPreviewPublic(response.project.is_preview_public || false);
          // Backend now returns full AllowedUser objects directly
          const allowedList = response.project.allowed || [];
          setAllowedUsers(allowedList);
        }
      } catch (error) {
        console.error('Failed to load project settings:', error);
      }
    };

    loadProjectSettings();
  }, [open, projectId]);

  // Close lookup popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (lookupContainerRef.current && !lookupContainerRef.current.contains(e.target as Node)) {
        setShowLookupPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Email validation helper — requires TLD of at least 2 chars to avoid
  // premature API calls for incomplete emails like "user@domain.e"
  const isValidEmail = useCallback((email: string) => {
    return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email);
  }, []);

  // Keep a ref of allowedUsers in sync so the lookup effect can read
  // the latest list without having it as a dependency (which would
  // restart the debounce timer every time the list changes).
  useEffect(() => {
    allowedUsersRef.current = allowedUsers;
  }, [allowedUsers]);

  // Debounced user lookup — only depends on lookupEmail so changing
  // the allowed list doesn't restart the debounce timer.
  useEffect(() => {
    const abortController = new AbortController();

    setLookupError(null);

    if (!lookupEmail) {
      setShowLookupPopup(false);
      setLookupResult(null);
      setIsLookingUp(false);
      return;
    }

    // Wait 600ms after user stops typing before doing anything
    const timeoutId = setTimeout(async () => {
      // 1. Validate email format (strict — needs ≥2 char TLD)
      if (!isValidEmail(lookupEmail)) {
        setShowLookupPopup(false);
        return;
      }

      // 2. Read the latest allowed list via ref (no stale closure)
      const currentAllowed = allowedUsersRef.current;
      const alreadyAdded = currentAllowed.some(u => u.email === lookupEmail);
      if (alreadyAdded) {
        setLookupError('This user already has access');
        setShowLookupPopup(true);
        setLookupResult(null);
        return;
      }

      // 3. All client-side checks passed — call the API
      setIsLookingUp(true);
      setShowLookupPopup(true);
      setLookupResult(null);

      try {
        const result = await userService.lookupUserByEmail(lookupEmail, abortController.signal);

        if (abortController.signal.aborted) return;

        if (result.success && result.user_id) {
          const alreadyInList = currentAllowed.some(u => u.user_id === result.user_id);
          if (alreadyInList) {
            setLookupError('This user already has access');
            setLookupResult(null);
          } else {
            setLookupResult(result);
          }
        } else {
          setLookupError('User not found');
          setLookupResult(null);
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        setLookupError('User not found');
        setLookupResult(null);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLookingUp(false);
        }
      }
    }, 600);

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [lookupEmail]);

  // Add user to allowed list
  const handleAddAllowedUser = async (user: UserLookupResult) => {
    if (!projectId || !user.user_id || isUpdatingAllowed) return;

    setIsUpdatingAllowed(true);
    try {
      const newAllowedUser: AllowedUser = {
        user_id: user.user_id,
        name: user.name || undefined,
        email: user.email || undefined,
        image_url: user.image_url || undefined,
      };

      const updatedAllowed = [...allowedUsers, newAllowedUser];

      const response = await projectService.updateProject(projectId, undefined, undefined, undefined, updatedAllowed);
      if (response.success) {
        setAllowedUsers(updatedAllowed);
        setLookupEmail('');
        setShowLookupPopup(false);
        setLookupResult(null);
      } else {
        console.error('Failed to update allowed users:', response.error);
      }
    } catch (error) {
      console.error('Failed to update allowed users:', error);
    } finally {
      setIsUpdatingAllowed(false);
    }
  };

  // Remove user from allowed list
  const handleRemoveAllowedUser = async (userId: string) => {
    if (!projectId || isUpdatingAllowed) return;

    setIsUpdatingAllowed(true);
    try {
      const updatedAllowed = allowedUsers.filter(u => u.user_id !== userId);

      const response = await projectService.updateProject(projectId, undefined, undefined, undefined, updatedAllowed);
      if (response.success) {
        setAllowedUsers(updatedAllowed);
      } else {
        console.error('Failed to remove allowed user:', response.error);
      }
    } catch (error) {
      console.error('Failed to remove allowed user:', error);
    } finally {
      setIsUpdatingAllowed(false);
    }
  };

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

  const close = () => onOpenChange(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_e) { }
  };

  const handleInvite = () => {
    const emailOk = /.+@.+\..+/.test(inviteEmail);
    if (!emailOk) return;
    setInvited((prev) => Array.from(new Set([...prev, inviteEmail])));
    setInviteEmail('');
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);

    // Wait for React to mount the hidden export container to the DOM
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      await exportDashboardAsPdf();
    } catch (error) {
      console.error('PDF export failed:', error);
      // You could add a toast notification here
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportPng = async () => {
    setIsExportingPng(true);

    // Wait for React to mount the hidden export container to the DOM
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      await exportDashboardAsPng();
    } catch (error) {
      console.error('PNG export failed:', error);
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleOpenPublishedDashboard = () => {
    try {
      const processedFile = uploadedFiles.find(f => f.processedData);
      if (processedFile?.processedData) {
        sessionStorage.setItem('project_preview_data', JSON.stringify(processedFile.processedData));
      }
      const dashboardIdToSave = dashboardState.configuration?.id || projectId;
      if (dashboardIdToSave) {
        sessionStorage.setItem('project_preview_dashboard_id', dashboardIdToSave);
      }
    } catch (_e) {
      // ignore errors
    }
    const previewUrl = projectId
      ? `/workspace/project/preview?projectId=${projectId}`
      : '/workspace/project/preview';
    window.open(previewUrl, '_blank');
  };


  const handleTogglePublic = async () => {
    if (!projectId || isUpdatingPublic) return;

    const newValue = !isPreviewPublic;
    setIsUpdatingPublic(true);

    try {
      const response = await projectService.updateProject(projectId, undefined, undefined, newValue);
      if (response.success) {
        setIsPreviewPublic(newValue);
      } else {
        console.error('Failed to update preview visibility:', response.error);
      }
    } catch (error) {
      console.error('Failed to update preview visibility:', error);
    } finally {
      setIsUpdatingPublic(false);
    }
  };

  const InnerContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">Publish Dashboard</span>
        </div>
        <button onClick={close} className="p-2 hover:bg-white/5 rounded-md"><X className="w-4 h-4" /></button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        {activeTab === 'share' && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Share Link</div>
              <div className="flex items-stretch sm:items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-black group hover:bg-black/80 transition-all duration-200 min-w-0">
                  <Globe className="w-4 h-4 flex-shrink-0" />
                  <button
                    onClick={handleOpenPublishedDashboard}
                    className="text-sm text-white group-hover:underline cursor-pointer flex items-center transition-all duration-200 flex-1 text-left truncate min-w-0"
                  >
                    {previewUrl}
                  </button>
                  <button
                    onClick={handleOpenPublishedDashboard}
                    className="text-muted-foreground hover:text-white transition-colors duration-200 flex-shrink-0"
                  >
                    <SquareArrowOutUpRight className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={handleCopy}
                  className="button-outline h-9 px-3 flex items-center justify-center gap-2 text-sm flex-shrink-0"
                >
                  {copied ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 sm:mt-2">
                <div className="h-5 text-xs">
                  {!slug || !isValidSlug(slug) ? (
                    <span className="text-red-400">Slug must be 3–50 chars, lowercase letters, numbers, hyphens</span>
                  ) : checking ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Checking availability…</span>
                  ) : available === false ? (
                    <span className="text-red-400">This slug is taken</span>
                  ) : available === true ? (
                    <span className="inline-flex items-center gap-1 text-green-400"><Check className="w-3 h-3" />Available</span>
                  ) : null}
                </div>
              </div>
            </div>

            {projectId && (
              <div className="space-y-3 pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isPreviewPublic ? (
                      <Globe className="w-4 h-4 text-green-400" />
                    ) : (
                      <Shield className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="text-sm font-medium">Preview Visibility</div>
                      <div className="text-xs text-muted-foreground">
                        {isPreviewPublic ? 'Public - Anyone with the link can view' : 'Private - Only you and allowed users can view'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleTogglePublic}
                    disabled={isUpdatingPublic}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${isPreviewPublic ? 'bg-green-500' : 'bg-gray-600'
                      } ${isUpdatingPublic ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${isPreviewPublic ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                  </button>
                </div>

                {/* Private sharing - email lookup */}
                {!isPreviewPublic && (
                  <div className="space-y-3 pt-2">
                    <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5" />
                      Share with specific people
                    </div>

                    {/* Email input with lookup popup */}
                    <div className="relative" ref={lookupContainerRef}>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 border border-white/10 focus-within:border-white/20 transition-colors duration-200">
                        <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <input
                          type="email"
                          value={lookupEmail}
                          onChange={(e) => setLookupEmail(e.target.value.trim())}
                          placeholder="Enter email to invite..."
                          className="flex-1 bg-transparent text-sm text-white placeholder:text-muted-foreground outline-none"
                        />
                        {isLookingUp && (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                        )}
                      </div>

                      {/* Lookup result popup */}
                      {showLookupPopup && (lookupResult || lookupError || isLookingUp) && (
                        <div className="absolute z-50 left-0 right-0 mt-1.5 rounded-lg bg-[#1a1a2e] border border-white/10 shadow-xl shadow-black/40 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                          {isLookingUp ? (
                            <div className="flex items-center gap-3 px-3 py-3">
                              <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse flex-shrink-0" />
                              <div className="flex-1 space-y-1.5">
                                <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
                                <div className="h-2.5 w-36 rounded bg-white/5 animate-pulse" />
                              </div>
                            </div>
                          ) : lookupError ? (
                            <div className="flex items-center gap-3 px-3 py-3">
                              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                                <X className="w-4 h-4 text-red-400" />
                              </div>
                              <span className="text-sm text-red-400">{lookupError}</span>
                            </div>
                          ) : lookupResult ? (
                            <button
                              onClick={() => handleAddAllowedUser(lookupResult)}
                              disabled={isUpdatingAllowed}
                              className="w-full flex items-center gap-3 px-3 py-3 hover:bg-white/5 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-left"
                            >
                              {lookupResult.image_url ? (
                                <img
                                  src={lookupResult.image_url}
                                  alt={lookupResult.name || 'User'}
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold">
                                  {(lookupResult.name || lookupResult.email || '?').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-white truncate">
                                  {lookupResult.name || 'Unknown'}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {lookupResult.email}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                                {isUpdatingAllowed ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <UserPlus className="w-3.5 h-3.5" />
                                    Add
                                  </>
                                )}
                              </div>
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* Allowed users list */}
                    {allowedUsers.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs text-muted-foreground">
                          {allowedUsers.length} {allowedUsers.length === 1 ? 'person' : 'people'} with access
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {allowedUsers.map((user) => (
                            <div
                              key={user.user_id}
                              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md bg-white/5 group hover:bg-white/8 transition-colors duration-150"
                            >
                              {user.image_url ? (
                                <img
                                  src={user.image_url}
                                  alt={user.name || 'User'}
                                  className="w-6 h-6 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white text-[10px] font-semibold">
                                  {(user.name || user.email || user.user_id || '?').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-white truncate">
                                  {user.name || user.email || user.user_id}
                                </div>
                                {user.name && user.email && (
                                  <div className="text-[10px] text-muted-foreground truncate">
                                    {user.email}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => handleRemoveAllowedUser(user.user_id)}
                                disabled={isUpdatingAllowed}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all duration-150 disabled:opacity-50 cursor-pointer"
                                title="Remove access"
                              >
                                <Trash2 className="w-3 h-3 text-red-400" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 pt-4 border-t border-white/10">
              <div className="text-sm font-medium">Export Options</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleExportPdf}
                  disabled={isExportingPdf}
                  aria-busy={isExportingPdf}
                  className="p-3 glass-panel rounded-xl text-sm font-medium hover:bg-black transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isExportingPdf ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {isExportingPdf ? 'Exporting...' : 'Export PDF'}
                </button>
                <button
                  onClick={handleExportPng}
                  disabled={isExportingPng}
                  aria-busy={isExportingPng}
                  className="p-3 glass-panel rounded-xl text-sm font-medium hover:bg-black transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isExportingPng ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {isExportingPng ? 'Exporting...' : 'Export PNG'}
                </button>
              </div>
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
            <VisuallyHidden>
              <SheetTitle>Publish Dashboard</SheetTitle>
              <SheetDescription>Publish and share your dashboard.</SheetDescription>
            </VisuallyHidden>
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
      {open && isDesktop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60" onClick={close} />
          <div className="relative w-full max-w-lg mx-4 md:mx-0 bg-muted rounded-2xl border border-white/10 shadow-xl overflow-hidden">
            {InnerContent}
          </div>
        </div>
      )}

      {/* Hidden dashboard specifically for exporting a reflowed horizontal layout */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: typeof window !== 'undefined' ? Math.max(window.innerWidth + 50, 1250) + 'px' : '1500px',
          minHeight: '800px',
          backgroundColor: '#000000ff', // Ensures no transparent/black background
          zIndex: -9999,
          opacity: 0.01, // Keep this at 0.01 to hide it from the user yet allow drawing
          pointerEvents: 'none'
        }}
        aria-hidden="true"
      >
        {(isExportingPdf || isExportingPng) && (
          <div id="dashboard-export-root" style={{ width: typeof window !== 'undefined' ? Math.max(window.innerWidth + 50, 1250) + 'px' : '1500px', minHeight: '800px', backgroundColor: '#000000ff' }}>
            <DashboardPreview
              dashboardId={undefined} // Prevent internal fetching
              staticConfig={processedData || dashboardState.configuration} // Prefer directly passed data over fetches
              processedData={processedData || uploadedFiles.find(f => f.processedData)?.processedData}
              isExporting={true}
              onExportLayoutChange={setExportDidSplit}
              isDarkMode={isDarkMode}
            />
          </div>
        )}
      </div>
    </>
  );
}
