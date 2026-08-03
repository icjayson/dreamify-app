import { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/clerk';
import { getFilePreview } from '@/services/filePreviewService';
import CSVPreviewTable, { type CSVPreviewTableProps } from '@/components/CSVPreviewTable';

const CHUNK_SIZE = 5000;
const BASE_PAGE_SIZES = [50, 100, 200, 500, 1000, 2000, 5000];
const DEFAULT_PAGE_SIZE = 100;

interface CsvPreviewPanelProps {
  assetId: string;
  onMetaLoaded?: (meta: { totalRows: number; columns: string[] }) => void;
}

interface PanelState extends CSVPreviewTableProps {
  isLoadingMore: boolean;
}

export default function CsvPreviewPanel({ assetId, onMetaLoaded }: CsvPreviewPanelProps) {
  const { getToken } = useAuth();
  const onMetaLoadedRef = useRef(onMetaLoaded);
  const [rowsPerPage, setRowsPerPage] = useState<number>(DEFAULT_PAGE_SIZE);
  const [state, setState] = useState<PanelState>({
    columns: [],
    rows: [],
    filename: '',
    totalRows: 0,
    displayedRows: 0,
    isLoading: true,
    isLoadingMore: false,
    error: null,
  });

  useEffect(() => {
    onMetaLoadedRef.current = onMetaLoaded;
  }, [onMetaLoaded]);

  useEffect(() => {
    let cancelled = false;
    setState({
      columns: [],
      rows: [],
      filename: '',
      totalRows: 0,
      displayedRows: 0,
      isLoading: true,
      isLoadingMore: false,
      error: null,
    });
    setRowsPerPage(DEFAULT_PAGE_SIZE);

    (async () => {
      try {
        let token: string | null | undefined;
        try {
          token = await getToken();
        } catch {
          token = undefined;
        }

        // ── First chunk ──────────────────────────────────────────────
        const first = await getFilePreview(assetId, token ?? undefined, {
          limit: CHUNK_SIZE,
          offset: 0,
        });
        if (cancelled) return;

        const totalRows = first.total_rows;
        let allRows = first.rows;

        // Show first chunk immediately; keep isLoadingMore while more remain
        setState({
          columns: first.columns,
          rows: allRows,
          filename: first.filename,
          totalRows,
          displayedRows: allRows.length,
          sourceType: first.sourceType,
          isLoading: false,
          isLoadingMore: allRows.length < totalRows,
          error: null,
        });

        // Surface metadata to parent (filename already in csvPreview state; provide row/col counts)
        onMetaLoadedRef.current?.({ totalRows, columns: first.columns });

        // ── Remaining chunks ──────────────────────────────────────────
        let offset = CHUNK_SIZE;
        while (offset < totalRows && !cancelled) {
          const chunk = await getFilePreview(assetId, token ?? undefined, {
            limit: CHUNK_SIZE,
            offset,
          });
          if (cancelled) return;

          allRows = [...allRows, ...chunk.rows];
          offset += CHUNK_SIZE;

          setState((prev) => ({
            ...prev,
            rows: allRows,
            displayedRows: allRows.length,
            isLoadingMore: offset < totalRows,
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isLoadingMore: false,
            error: err instanceof Error ? err.message : 'Failed to load preview',
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetId, getToken]);

  // Compute page-size options from total loaded rows
  const pageSizeOptions = useMemo(() => {
    const n = state.rows.length;
    if (n === 0) return [DEFAULT_PAGE_SIZE];
    const filtered = BASE_PAGE_SIZES.filter((s) => s < n);
    return [...filtered, n];
  }, [state.rows.length]);

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
      <CSVPreviewTable
        {...state}
        pageSize={rowsPerPage}
        onPageSizeChange={setRowsPerPage}
        pageSizeOptions={pageSizeOptions}
        loadedRows={state.rows.length}
        compact
        hideHeader
      />
    </div>
  );
}
