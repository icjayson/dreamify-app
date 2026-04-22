import React, { useMemo, useState } from "react";
import { useUser, useSession, useSessionList } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Monitor, Smartphone, Tablet } from "lucide-react";

// ── Provider helpers (module-level, not recreated on each render) ──────────

// Clerk may return provider as "oauth_google" OR bare "google" — handle both
const normalizeProvider = (provider: string) =>
  provider.startsWith('oauth_') ? provider.slice('oauth_'.length) : provider;

const PROVIDER_META: Record<string, { label: string; bg: string; icon: React.ReactNode }> = {
  google: {
    label: 'Google',
    bg: 'bg-white',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
  },
  facebook: {
    label: 'Facebook',
    bg: 'bg-[#1877F2]',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.874v2.278h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
      </svg>
    ),
  },
  github: {
    label: 'GitHub',
    bg: 'bg-[#24292e]',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
      </svg>
    ),
  },
  microsoft: {
    label: 'Microsoft',
    bg: 'bg-[#2F2F2F]',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
        <path fill="#F25022" d="M1 1h10v10H1z"/>
        <path fill="#00A4EF" d="M13 1h10v10H13z"/>
        <path fill="#7FBA00" d="M1 13h10v10H1z"/>
        <path fill="#FFB900" d="M13 13h10v10H13z"/>
      </svg>
    ),
  },
};

const getProviderMeta = (rawProvider: string) => {
  const key = normalizeProvider(rawProvider);
  return PROVIDER_META[key] ?? {
    label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
    bg: 'bg-white/10',
    icon: (
      <span className="text-xs font-bold text-white">
        {key.charAt(0).toUpperCase()}
      </span>
    ),
  };
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border-t border-border pt-6 mb-6">
    <h3 className="text-foreground dark:text-white text-lg font-semibold mb-4">{title}</h3>
    {children}
  </div>
);

const AccountSettings: React.FC = () => {
  const { user, isLoaded } = useUser();
  const { session: currentSession } = useSession();
  const { sessions, isLoaded: sessionsLoaded } = useSessionList();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const primaryEmail = useMemo(() => user?.primaryEmailAddress?.emailAddress || "", [user]);
  const [newPassword, setNewPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [ipInfo, setIpInfo] = useState<{ ip?: string; city?: string; country?: string } | null>(null);
  const [showAllDevices, setShowAllDevices] = useState(false);

  React.useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
    }
  }, [user]);

  React.useEffect(() => {
    // Robust IP/location fetch with timeouts and fallbacks
    const fetchIpInfo = async () => {
      const controllers: AbortController[] = [];
      const withTimeout = (url: string, ms = 4000) => {
        const c = new AbortController();
        controllers.push(c);
        const t = setTimeout(() => c.abort(), ms);
        return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
      };
      try {
        // Try ipify to get IP
        let ip = "";
        try {
          const r = await withTimeout("https://api.ipify.org?format=json", 3000);
          if (r.ok) ip = (await r.json()).ip;
        } catch {}
        if (ip) {
          try {
            const r2 = await withTimeout(`https://ipapi.co/${ip}/json/`, 4000);
            if (r2.ok) {
              const d = await r2.json();
              setIpInfo({ ip, city: d.city, country: d.country_name });
              return;
            }
          } catch {}
        }
        // Fallback single endpoint
        try {
          const r3 = await withTimeout("https://ipwho.is/", 4000);
          if (r3.ok) {
            const d = await r3.json();
            setIpInfo({ ip: d.ip, city: d.city, country: d.country });
            return;
          }
        } catch {}
      } finally {
        controllers.forEach(c => c.abort());
      }
    };
    void fetchIpInfo();
  }, []);

  const getBrowserLabel = () => {
    const ua = navigator.userAgent;
    const m = ua.match(/(Chrome)\/([0-9.]+)/) || ua.match(/(Firefox)\/([0-9.]+)/) || ua.match(/(Safari)\/([0-9.]+)/) || ua.match(/(Edg)\/([0-9.]+)/);
    if (m) {
      const name = m[1] === 'Edg' ? 'Edge' : m[1];
      return `${name} ${m[2]}`;
    }
    return ua;
  };

  const getDeviceType = () => {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /iphone|android.+mobile/.test(ua);
    const isTablet = /ipad|android(?!.*mobile)/.test(ua);
    if (isMobile) return "mobile";
    if (isTablet) return "tablet";
    // Heuristic: desktop/laptop
    // If on Mac/Win/Linux + has touch? still desktop
    return "laptop";
  };

  const getDeviceName = () => {
    const p = (navigator.platform || navigator.userAgent).toLowerCase();
    if (p.includes('mac')) return 'Macintosh';
    if (p.includes('win')) return 'Windows';
    if (p.includes('iphone')) return 'iPhone';
    if (p.includes('ipad')) return 'iPad';
    if (p.includes('android')) return 'Android';
    if (p.includes('linux')) return 'Linux';
    return 'Device';
  };

  const DeviceThumbnail: React.FC = () => (
    <svg width="28" height="18" viewBox="0 0 28 18" className="text-white/80" aria-hidden="true">
      <rect x="1" y="2" width="26" height="13" rx="2" fill="#0A0A0A" stroke="#5C5C5C" strokeWidth="1" />
      <rect x="3" y="4" width="22" height="9" rx="1" fill="#0E0E0E" />
      <rect x="9" y="16" width="10" height="1" rx="0.5" fill="#595959" />
    </svg>
  );

  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const disconnectExternalAccount = async (provider: string, id: string, destroy: () => Promise<void>) => {
    const { label } = getProviderMeta(provider);
    const confirmed = window.confirm(`Disconnect ${label} account?`);
    if (!confirmed) return;
    setDisconnectingId(id);
    try {
      await destroy();
      await user?.reload();
    } catch (_e) {
      // no-op
    } finally {
      setDisconnectingId(null);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    try {
      setIsSavingProfile(true);
      const updated = await user.update({ firstName, lastName });
      // Ensure Clerk context refreshes and local UI reflects changes
      if ((user as any).reload) {
        await (user as any).reload();
      } else if ((window as any).Clerk?.user?.reload) {
        await (window as any).Clerk.user.reload();
      }
      // Sync local inputs with latest values
      setFirstName(updated.firstName || "");
      setLastName(updated.lastName || "");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const onSelectAvatar: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0] || null;
    setAvatarFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setAvatarPreview(url);
    } else {
      setAvatarPreview(null);
    }
  };

  const uploadAvatar = async () => {
    if (!user || !avatarFile) return;
    try {
      setIsUploadingAvatar(true);
      await user.setProfileImage({ file: avatarFile });
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const addEmailAddress = async () => {
    if (!user || !newEmail) return;
    try {
      setIsAddingEmail(true);
      const created = await user.createEmailAddress({ email: newEmail });
      // Optionally start verification flow here
      setNewEmail("");
    } finally {
      setIsAddingEmail(false);
    }
  };

  const setPrimaryEmail = async (emailId: string) => {
    if (!user) return;
    try {
      await user.update({ primaryEmailAddressId: emailId });
    } catch (_e) {}
  };

  const removeEmail = async (emailId: string) => {
    if (!user) return;
    const confirmed = window.confirm("Remove this email address?");
    if (!confirmed) return;
    try {
      const target = user.emailAddresses.find((e) => e.id === emailId);
      await target?.destroy();
    } catch (_e) {}
  };

  const updatePassword = async () => {
    if (!user || !newPassword) return;
    try {
      setIsSavingPassword(true);
      // Clerk password update via create/update password
      // If user has no password yet, use setPassword; otherwise, update
      await user.updatePassword({ newPassword });
      setNewPassword("");
    } finally {
      setIsSavingPassword(false);
    }
  };

  const endSession = async (sessionId: string) => {
    try {
      const target = sessions?.find((s) => s.id === sessionId);
      // Prefer instance method if available
      if (target && (target as any).end) {
        await (target as any).end();
      } else if ((window as any).Clerk?.client?.sessions?.revoke) {
        await (window as any).Clerk.client.sessions.revoke(sessionId);
      }
    } catch (_e) {
      // no-op
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    const confirmed = window.confirm("This will permanently delete your account. Continue?");
    if (!confirmed) return;
    try {
      await user.delete();
    } catch (_e) {
      // no-op
    }
  };

  if (!isLoaded) return null;

  return (
    <div className="px-3 md:px-4 pt-8">
        <h2 className="text-2xl md:text-3xl font-semibold text-foreground dark:text-white mb-4">Manage account</h2>

      <Section title="Profile">
        {/* Avatar uploader */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-foreground/10 dark:bg-white/10 flex items-center justify-center">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
            ) : (
              <img src={user?.imageUrl || ""} alt="Avatar" className="w-full h-full object-cover" />
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="px-3 py-2 text-sm rounded-md text-foreground dark:text-white button-outline cursor-pointer">
              Change avatar
              <input type="file" accept="image/*" className="hidden" onChange={onSelectAvatar} />
            </label>
            <Button onClick={uploadAvatar} disabled={!avatarFile || isUploadingAvatar} className="button-gradient px-3 py-2 text-sm">
              {isUploadingAvatar ? "Uploading..." : "Update avatar"}
            </Button>
            {avatarPreview && (
              <button
                onClick={() => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); setAvatarPreview(null); setAvatarFile(null); }}
                className="px-3 py-2 text-sm bg-foreground/10 dark:bg-white/10 rounded-md border border-border dark:border-white/20 text-muted-foreground dark:text-white/80 hover:text-foreground dark:hover:text-white"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-muted-foreground dark:text-white/80 mb-1">First name</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background dark:bg-black/60 border border-border text-foreground dark:text-white placeholder:text-muted-foreground dark:placeholder:text-white/30 focus:outline-none"
              placeholder="First name"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground dark:text-white/80 mb-1">Last name</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background dark:bg-black/60 border border-border text-foreground dark:text-white placeholder:text-muted-foreground dark:placeholder:text-white/30 focus:outline-none"
              placeholder="Last name"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-muted-foreground dark:text-white/80 mb-1">Email</label>
            <input value={primaryEmail} disabled className="w-full px-3 py-2 rounded-md bg-muted dark:bg-black/40 border border-border text-muted-foreground dark:text-white/80" />
            <p className="text-xs text-muted-foreground dark:text-white/50 mt-1">Primary email is managed by Clerk</p>
            {/* Additional emails */}
            <div className="mt-3 space-y-2">
              {(user?.emailAddresses || []).map((ea) => (
                <div key={ea.id} className="flex items-center justify-between text-sm bg-muted/50 dark:bg-black/30 border border-border dark:border-white/10 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground dark:text-white/90">{ea.emailAddress}</span>
                    {ea.id === user?.primaryEmailAddressId && (
                      <span className="text-xs text-foreground/70 dark:text-white/70 bg-foreground/10 dark:bg-white/10 rounded px-1.5 py-0.5">Primary</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ea.id !== user?.primaryEmailAddressId && (
                      <button onClick={() => setPrimaryEmail(ea.id)} className="text-xs text-muted-foreground dark:text-white/80 hover:text-foreground dark:hover:text-white underline">Set primary</button>
                    )}
                    {ea.id !== user?.primaryEmailAddressId && (
                      <button onClick={() => removeEmail(ea.id)} className="text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 underline">Remove</button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Add email address"
                  className="flex-1 px-3 py-2 rounded-md bg-background dark:bg-black/60 border border-border text-foreground dark:text-white placeholder:text-muted-foreground dark:placeholder:text-white/30 focus:outline-none"
                />
                <Button onClick={addEmailAddress} disabled={!newEmail || isAddingEmail} className="button-gradient px-3 py-2 text-sm">
                  {isAddingEmail ? "Adding..." : "Add"}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={saveProfile} disabled={isSavingProfile} className="button-gradient px-4 py-2">
            {isSavingProfile ? "Saving..." : "Update profile"}
          </Button>
        </div>
      </Section>

      <Section title="Connected accounts">
        {(user?.externalAccounts ?? []).length === 0 ? (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-dashed border-border dark:border-white/10 bg-muted/50 dark:bg-white/[0.02]">
            <p className="text-sm text-muted-foreground dark:text-white/40">No connected accounts.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(user?.externalAccounts ?? []).map((account) => {
              const rawProvider = account.provider as string;
              const { label, bg, icon } = getProviderMeta(rawProvider);
              const email = account.emailAddress || '';
              const isDisconnecting = disconnectingId === account.id;
              return (
                <div
                  key={account.id}
                  className="group flex items-center justify-between px-4 py-3 rounded-xl border border-border/50 dark:border-white/8 bg-muted/30 dark:bg-white/[0.03] hover:bg-muted/70 dark:hover:bg-white/[0.06] hover:border-border dark:hover:border-white/15 transition-all duration-200"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Brand icon */}
                    <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center shrink-0 shadow-sm`}>
                      {icon}
                    </div>
                    {/* Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground dark:text-white leading-tight">{label}</p>
                        <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400 inline-block" />
                          Connected
                        </span>
                      </div>
                      {email && (
                        <p className="text-xs text-muted-foreground dark:text-white/45 truncate mt-0.5">{email}</p>
                      )}
                    </div>
                  </div>
                  {/* Disconnect */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isDisconnecting}
                    onClick={() => disconnectExternalAccount(rawProvider, account.id, account.destroy.bind(account))}
                    className="h-7 text-xs text-muted-foreground dark:text-white/40 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 px-2.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  >
                    {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Security">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-muted-foreground dark:text-white/80 mb-1">Password</label>
            <div className="text-sm text-muted-foreground dark:text-white/80 mb-2">Set password</div>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background dark:bg-black/60 border border-border text-foreground dark:text-white placeholder:text-muted-foreground dark:placeholder:text-white/30 focus:outline-none"
              placeholder="Enter a new password"
            />
            <div className="mt-3">
              <Button onClick={updatePassword} disabled={isSavingPassword || !newPassword} className="button-gradient px-4 py-2">
                {isSavingPassword ? "Updating..." : "Update password"}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground dark:text-white/80 mb-2">Active devices</label>
            <div className="space-y-3">
              {/* Current device (rich info) */}
              <div className="rounded-md border border-border dark:border-white/10 bg-muted/50 dark:bg-black/30 p-3">
                <div className="text-base text-foreground dark:text-white font-medium flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded">
                    {getDeviceType() === 'mobile' ? <Smartphone className="w-5 h-5 text-muted-foreground dark:text-white/80" /> : getDeviceType() === 'tablet' ? <Tablet className="w-5 h-5 text-muted-foreground dark:text-white/80" /> : <DeviceThumbnail />}
                  </span>
                  <span className="text-foreground dark:text-white text-lg font-semibold">{getDeviceName()}</span>
                  <span className="text-xs text-muted-foreground dark:text-white/80 bg-foreground/10 dark:bg-white/10 border border-border dark:border-white/20 rounded-md px-2 py-0.5">This device</span>
                </div>
                <div className="text-sm text-muted-foreground dark:text-white/80 mt-1">{getBrowserLabel()}</div>
                <div className="text-sm text-muted-foreground dark:text-white/80 mt-1">
                  {ipInfo?.ip ? `${ipInfo.ip} ${ipInfo.city ? `(${ipInfo.city}, ${ipInfo.country || ""})` : ""}` : "IP unknown"}
                </div>
                <div className="text-sm text-muted-foreground dark:text-white/80 mt-1">{new Date().toLocaleString()}</div>
              </div>

              {/* Other sessions */}
              {(() => {
                const others = (sessionsLoaded ? sessions || [] : []).filter((s) => s.id !== currentSession?.id);
                const limit = 3;
                const list = showAllDevices ? others : others.slice(0, limit);
                return list.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 rounded-md border border-border dark:border-border/60 bg-muted/50 dark:bg-black/30 p-3">
                  <div>
                    <div className="text-sm text-foreground/90 dark:text-white/90 flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-foreground/10 dark:bg-white/10 rounded text-foreground dark:text-white">
                        <Monitor className="w-4 h-4" />
                      </span>
                      <span className="text-foreground dark:text-white">Device</span>
                    </div>
                    {s.lastActiveAt && (
                      <div className="text-xs text-muted-foreground dark:text-white/60 mt-1">{new Date(s.lastActiveAt).toLocaleString()}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => endSession(s.id)} className="text-xs text-muted-foreground dark:text-white/80 hover:text-foreground dark:hover:text-white underline">Sign out</button>
                  </div>
                </div>
                ));
              })()}
              {(() => {
                const othersCount = (sessionsLoaded ? sessions || [] : []).filter((s) => s.id !== currentSession?.id).length;
                const limit = 3;
                if (othersCount > limit) {
                  return (
                    <div className="pt-1">
                      <button
                        onClick={() => setShowAllDevices((v) => !v)}
                        className="text-xs text-muted-foreground dark:text-white/80 hover:text-foreground dark:hover:text-white underline"
                      >
                        {showAllDevices ? "Show less devices" : `Show all devices (${othersCount})`}
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
              {(sessionsLoaded ? sessions || [] : []).some(s => s.id !== currentSession?.id) && (
                <div className="pt-1">
                  <button onClick={async () => {
                    const others = (sessions || []).filter(s => s.id !== currentSession?.id);
                    for (const s of others) { await endSession(s.id); }
                  }} className="text-xs text-muted-foreground dark:text-white/80 hover:text-foreground dark:hover:text-white underline">
                    Sign out all other devices
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-center">
            <button onClick={handleDeleteAccount} className="text-sm text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 underline justify-self-start md:justify-self-start">Delete account</button>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default AccountSettings;


