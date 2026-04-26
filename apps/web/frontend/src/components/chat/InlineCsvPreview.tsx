import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Loader2 } from 'lucide-react';
import { getFilePreview } from '@/services/filePreviewService';

const INLINE_ROW_LIMIT = 50;

interface InlineCsvPreviewProps {
  assetId: string;
}

interface PreviewState {
  columns: string[];
  rows: string[][];
  totalRows: number;
  isLoading: boolean;
  error: string | null;
}

export default function InlineCsvPreview({ assetId }: InlineCsvPreviewProps) {
  const { getToken } = useAuth();
  const [state, setState] = useState<PreviewState>({
    columns: [],
    rows: [],
    totalRows: 0,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ columns: [], rows: [], totalRows: 0, isLoading: true, error: null });

    (async () => {
      try {
        let token: string | null | undefined;
        try {
          token = await getToken();
        } catch {
          token = undefined;
        }
        const data = await getFilePreview(assetId, token ?? undefined, { limit: INLINE_ROW_LIMIT });
        if (!cancelled) {
          setState({
            columns: data.columns,
            rows: data.rows,
            totalRows: data.total_rows,
            isLoading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            columns: [],
            rows: [],
            totalRows: 0,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load preview',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetId, getToken]);

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center border-t border-border dark:border-white/10 py-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.error || state.columns.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border dark:border-white/10">
      {/* Scrollable table: max 5 rows (~168px) tall, scrollable horizontally */}
      <div className="overflow-auto max-h-[168px] max-w-full">
        <table className="min-w-full divide-y divide-border text-xs">
          <thead className="bg-muted dark:bg-white sticky top-0 z-10">
            <tr>
              {state.columns.map((col, i) => (
                <th
                  key={i}
                  className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap border-r border-border dark:border-white/10 last:border-r-0"
                >
                  {col || `Col ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-background dark:bg-transparent divide-y divide-border">
            {state.rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-muted/30 dark:hover:bg-white/5">
                {state.columns.map((_, colIdx) => (
                  <td
                    key={colIdx}
                    className="px-3 py-1.5 whitespace-nowrap text-foreground dark:text-white/80 border-r border-border dark:border-white/10 last:border-r-0"
                  >
                    {row[colIdx] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.totalRows > INLINE_ROW_LIMIT && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground border-t border-border dark:border-white/10 bg-muted/30 dark:bg-white/[0.03]">
          Showing {INLINE_ROW_LIMIT} of {state.totalRows.toLocaleString()} rows
        </div>
      )}
    </div>
  );
}
