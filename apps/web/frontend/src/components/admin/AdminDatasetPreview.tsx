import { useEffect, useState } from 'react';
import { adminService } from '@/services/adminService';
import CSVPreviewTable, { CSVPreviewTableProps } from '@/components/CSVPreviewTable';
import { Loader2, AlertCircle } from 'lucide-react';

interface AdminDatasetPreviewProps {
    conversationId: string;
    projectId: string;
    assetId: string;
}

export function AdminDatasetPreview({ conversationId, projectId, assetId }: AdminDatasetPreviewProps) {
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
        let isMounted = true;
        const loadPreview = async () => {
            try {
                setPreviewData((prev) => ({ ...prev, isLoading: true, error: null }));

                const adminUser = localStorage.getItem('adminUsername') || 'admin';
                const adminPass = localStorage.getItem('adminPassword') || 'admin123';

                const data = await adminService.getFilePreview(adminUser, adminPass, conversationId, projectId, assetId);

                if (isMounted) {
                    setPreviewData({
                        columns: data.columns,
                        rows: data.rows,
                        filename: data.filename,
                        totalRows: data.total_rows,
                        displayedRows: data.displayed_rows,
                        isLoading: false,
                        error: null,
                    });
                }
            } catch (error) {
                if (isMounted) {
                    setPreviewData((prev) => ({
                        ...prev,
                        isLoading: false,
                        error: error instanceof Error ? error.message : 'Failed to load preview',
                    }));
                }
            }
        };

        if (assetId && conversationId && projectId) {
            loadPreview();
        }

        return () => {
            isMounted = false;
        }
    }, [assetId, conversationId, projectId]);

    if (previewData.isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center p-12 flex-col gap-4 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p>Loading Dataset from S3 Storage...</p>
            </div>
        );
    }

    if (previewData.error) {
        return (
            <div className="flex h-full w-full items-center justify-center p-12 flex-col gap-4 text-red-500">
                <AlertCircle className="h-8 w-8" />
                <p className="text-center font-medium max-w-md">{previewData.error}</p>
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-hidden flex flex-col">
            <CSVPreviewTable {...previewData} />
        </div>
    );
}
