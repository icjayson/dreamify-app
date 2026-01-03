import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import CSVPreviewTable, { CSVPreviewTableProps } from '@/components/CSVPreviewTable';
import { getFilePreview } from '@/services/filePreviewService';

export default function FilePreviewPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const [searchParams] = useSearchParams();
  const { getToken } = useAuth();
  const urlToken = searchParams.get('token');

  const [previewData, setPreviewData] = useState<CSVPreviewTableProps>({
    columns: [],
    rows: [],
    filename: '',
    totalRows: 0,
    displayedRows: 0,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!assetId) {
      setPreviewData((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Asset ID is required',
      }));
      return;
    }

    const loadPreview = async () => {
      try {
        setPreviewData((prev) => ({ ...prev, isLoading: true, error: null }));
        
        // Try to get token from URL first, then from Clerk as fallback
        let token = urlToken || undefined;
        if (!token) {
          try {
            token = await getToken();
          } catch (err) {
            // If we can't get token from Clerk, proceed without it
            console.warn('Could not get token from Clerk:', err);
          }
        }
        
        const data = await getFilePreview(assetId, token);
        setPreviewData({
          columns: data.columns,
          rows: data.rows,
          filename: data.filename,
          totalRows: data.total_rows,
          displayedRows: data.displayed_rows,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        setPreviewData((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load preview',
        }));
      }
    };

    loadPreview();
  }, [assetId, urlToken, getToken]);

  return (
    <div className="min-h-screen bg-background w-full overflow-hidden">
      <div className="h-screen flex flex-col max-w-full">
        <CSVPreviewTable {...previewData} />
      </div>
    </div>
  );
}

