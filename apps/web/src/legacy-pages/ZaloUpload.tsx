import { useEffect, useRef, useState } from "react";
import { useParams } from "@/lib/navigation";
import { CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface UploadInfo {
  valid: boolean;
  workspace_name?: string;
  expires_in?: number;
}

type UploadState = "idle" | "uploading" | "success" | "error";

const ACCEPT = ".csv,.xlsx,.xls,.json";
const MAX_BYTES = 10 * 1024 * 1024;

// The Vercel web and API projects have different origins, so connector upload
// callbacks must use the configured API base rather than a relative URL.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function ZaloUploadPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [uploadedName, setUploadedName] = useState<string>("");
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/chat/zalo/upload/${token}`);
        const data: UploadInfo = await res.json();
        if (!cancelled) {
          setInfo(data);
          if (data.expires_in) setSecondsLeft(data.expires_in);
        }
      } catch {
        if (!cancelled) setInfo({ valid: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const handleFile = async (file: File) => {
    setErrorMsg("");
    if (file.size > MAX_BYTES) {
      setErrorMsg(`File exceeds 5 MB limit (got ${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      setState("error");
      return;
    }

    setState("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch(`${API_BASE}/api/v1/chat/zalo/upload/${token}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Upload failed (HTTP ${res.status})`);
      }
      setUploadedName(file.name);
      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setState("error");
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!info?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="p-6 max-w-md w-full text-center space-y-3">
          <XCircle className="w-10 h-10 text-destructive mx-auto" />
          <h1 className="text-lg font-semibold text-foreground">Upload link expired or invalid</h1>
          <p className="text-sm text-muted-foreground">
            Send the file again in your Zalo chat with Dreamify and tap the new link.
          </p>
        </Card>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="p-6 max-w-md w-full text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h1 className="text-lg font-semibold text-foreground">File uploaded</h1>
          <p className="text-sm text-muted-foreground">
            <code className="bg-muted px-1.5 py-0.5 rounded">{uploadedName}</code> is queued.
            <br />
            Return to your Zalo chat and ask Dreamify what you'd like to know.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="p-6 max-w-md w-full space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">Upload to Dreamify (Zalo)</h1>
          <p className="text-xs text-muted-foreground">
            {info.workspace_name ? `For ${info.workspace_name} · ` : ""}
            Link expires in {formatTime(secondsLeft)}
          </p>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
        >
          {state === "uploading" ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Uploading…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <FileUp className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-foreground font-medium">
                Drop a file here or tap to choose
              </p>
              <p className="text-xs text-muted-foreground">
                CSV · XLSX · JSON · TXT · PDF — up to 5 MB
              </p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={onChange}
            disabled={state === "uploading"}
          />
        </div>

        {state === "error" && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => inputRef.current?.click()}
          disabled={state === "uploading"}
        >
          Choose file
        </Button>
      </Card>
    </div>
  );
}
