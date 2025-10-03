import React, { useMemo, useState } from "react";
import { useUser, useSession, useSessionList } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Monitor, Smartphone, Tablet } from "lucide-react";

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border-t border-border pt-6 mb-6">
    <h3 className="text-white text-lg font-semibold mb-4">{title}</h3>
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
      // Note: Supabase mirror will refresh via useUserSync effect listening on Clerk user changes
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
        <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Manage account</h2>

      <Section title="Profile">
        {/* Avatar uploader */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
            ) : (
              <img src={user?.imageUrl || ""} alt="Avatar" className="w-full h-full object-cover" />
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="px-3 py-2 text-sm rounded-md text-white button-outline cursor-pointer">
              Change avatar
              <input type="file" accept="image/*" className="hidden" onChange={onSelectAvatar} />
            </label>
            <Button onClick={uploadAvatar} disabled={!avatarFile || isUploadingAvatar} className="button-gradient px-3 py-2 text-sm">
              {isUploadingAvatar ? "Uploading..." : "Update avatar"}
            </Button>
            {avatarPreview && (
              <button
                onClick={() => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); setAvatarPreview(null); setAvatarFile(null); }}
                className="px-3 py-2 text-sm bg-white/10 rounded-md border border-white/20 text-white/80 hover:text-white"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-white/80 mb-1">First name</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-black/60 border border-border text-white placeholder-white/30 focus:outline-none"
              placeholder="First name"
            />
          </div>
          <div>
            <label className="block text-sm text-white/80 mb-1">Last name</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-black/60 border border-border text-white placeholder-white/30 focus:outline-none"
              placeholder="Last name"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-white/80 mb-1">Email</label>
            <input value={primaryEmail} disabled className="w-full px-3 py-2 rounded-md bg-black/40 border border-border text-white/80" />
            <p className="text-xs text-white/50 mt-1">Primary email is managed by Clerk</p>
            {/* Additional emails */}
            <div className="mt-3 space-y-2">
              {(user?.emailAddresses || []).map((ea) => (
                <div key={ea.id} className="flex items-center justify-between text-sm bg-black/30 border border-white/10 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white/90">{ea.emailAddress}</span>
                    {ea.id === user?.primaryEmailAddressId && (
                      <span className="text-xs text-white/70 bg-white/10 rounded px-1.5 py-0.5">Primary</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ea.id !== user?.primaryEmailAddressId && (
                      <button onClick={() => setPrimaryEmail(ea.id)} className="text-xs text-white/80 hover:text-white underline">Set primary</button>
                    )}
                    {ea.id !== user?.primaryEmailAddressId && (
                      <button onClick={() => removeEmail(ea.id)} className="text-xs text-red-400 hover:text-red-300 underline">Remove</button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Add email address"
                  className="flex-1 px-3 py-2 rounded-md bg-black/60 border border-border text-white placeholder-white/30 focus:outline-none"
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

      <Section title="Security">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-white/80 mb-1">Password</label>
            <div className="text-sm text-white/80 mb-2">Set password</div>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-black/60 border border-border text-white placeholder-white/30 focus:outline-none"
              placeholder="Enter a new password"
            />
            <div className="mt-3">
              <Button onClick={updatePassword} disabled={isSavingPassword || !newPassword} className="button-gradient px-4 py-2">
                {isSavingPassword ? "Updating..." : "Update password"}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-white/80 mb-2">Active devices</label>
            <div className="space-y-3">
              {/* Current device (rich info) */}
              <div className="rounded-md border border-white/10 bg-black/30 p-3">
                <div className="text-base text-white font-medium flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded">
                    {getDeviceType() === 'mobile' ? <Smartphone className="w-5 h-5 text-white/80" /> : getDeviceType() === 'tablet' ? <Tablet className="w-5 h-5 text-white/80" /> : <DeviceThumbnail />}
                  </span>
                  <span className="text-white text-lg font-semibold">{getDeviceName()}</span>
                  <span className="text-xs text-white/80 bg-white/10 border border-white/20 rounded-md px-2 py-0.5">This device</span>
                </div>
                <div className="text-sm text-white/80 mt-1">{getBrowserLabel()}</div>
                <div className="text-sm text-white/80 mt-1">
                  {ipInfo?.ip ? `${ipInfo.ip} ${ipInfo.city ? `(${ipInfo.city}, ${ipInfo.country || ""})` : ""}` : "IP unknown"}
                </div>
                <div className="text-sm text-white/80 mt-1">{new Date().toLocaleString()}</div>
              </div>

              {/* Other sessions */}
              {(() => {
                const others = (sessionsLoaded ? sessions || [] : []).filter((s) => s.id !== currentSession?.id);
                const limit = 3;
                const list = showAllDevices ? others : others.slice(0, limit);
                return list.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-black/30 p-3">
                  <div>
                    <div className="text-sm text-white/90 flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-white/10 rounded text-white">
                        <Monitor className="w-4 h-4" />
                      </span>
                      <span>Device</span>
                    </div>
                    {s.lastActiveAt && (
                      <div className="text-xs text-white/60 mt-1">{new Date(s.lastActiveAt).toLocaleString()}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => endSession(s.id)} className="text-xs text-white/80 hover:text-white underline">Sign out</button>
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
                        className="text-xs text-white/80 hover:text-white underline"
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
                  }} className="text-xs text-white/80 hover:text-white underline">
                    Sign out all other devices
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-center">
            <button onClick={handleDeleteAccount} className="text-sm text-red-400 hover:text-red-300 underline justify-self-start md:justify-self-start">Delete account</button>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default AccountSettings;


