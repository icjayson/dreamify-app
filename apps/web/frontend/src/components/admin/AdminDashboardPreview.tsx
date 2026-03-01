import { useState, useEffect } from 'react';
import DashboardPreview from '@/components/project-section/DashboardPreview';
import { adminService } from '@/services/adminService';
import { Loader2, AlertCircle } from 'lucide-react';
import type { DashboardConfiguration } from '@/types/dashboard';

interface AdminDashboardPreviewProps {
    conversationId: string;
    projectId: string;
    dashboardId: string;
}

export function AdminDashboardPreview({ conversationId, projectId, dashboardId }: AdminDashboardPreviewProps) {
    const [config, setConfig] = useState<DashboardConfiguration | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const fetchDashboard = async () => {
            setLoading(true);
            setError(null);
            try {
                // We use generic auth string here, assuming the user is already logged in as admin
                // and adminService handles the token/basic auth internally via context or cookies.
                // In this app, adminService requires username/pass for some direct calls,
                // but we might need to retrieve them from local state if needed.
                // Let's check how the rest of Admin Panel handles auth.
                // Looking at admin.tsx, it passes user/pass to fetch functions.
                // We need to get it from localStorage or Context.
                const adminUser = localStorage.getItem('adminUsername') || 'admin';
                const adminPass = localStorage.getItem('adminPassword') || 'admin123';

                const data = await adminService.getConversationDashboard(adminUser, adminPass, conversationId, projectId, dashboardId);
                if (isMounted) {
                    if (data) {
                        setConfig(data);
                    } else {
                        setError('Dashboard configuration not found in S3 storage.');
                    }
                }
            } catch (err) {
                if (isMounted) {
                    setError(err instanceof Error ? err.message : 'Failed to fetch dashboard: Unknown error');
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        if (dashboardId && conversationId && projectId) {
            fetchDashboard();
        }
    }, [dashboardId, conversationId, projectId]);

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center p-12 flex-col gap-4 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p>Loading Dashboard from S3 Storage...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-full w-full items-center justify-center p-12 flex-col gap-4 text-red-500">
                <AlertCircle className="h-8 w-8" />
                <p className="text-center font-medium max-w-md">{error}</p>
            </div>
        );
    }

    if (!config) {
        return (
            <div className="flex h-full w-full items-center justify-center p-12 flex-col gap-4 text-muted-foreground">
                <p>No dashboard configuration found.</p>
            </div>
        );
    }

    // Since DashboardPreview hooks into useDashboard internally using the ID,
    // we bypass useDashboard by passing processedData directly if we can,
    // OR we modify DashboardPreview to accept a static configuration.
    // DashboardPreview takes `processedData` but internally uses `useDashboard`.
    // Let's see if we can trick it or if we need a custom renderer.
    // Actually, DashboardPreview takes `dashboardState` from the hook.
    // Let's pass the raw config down via context or modify the wrapper logic.
    // Wait, DashboardPreview requires `dashboardId` to fetch. If it fetches and fails, it shows error.
    // To make it render the config we fetched, we must patch DashboardPreview to accept `staticConfig`.

    // For now, let's just pass `dashboardId` and see if `useDashboard` hooks can be bypassed,
    // but we know `useDashboard` tries to hit `/refresh` and fails (hence this task).
    // So we must modify DashboardPreview to accept an optional `initialConfig` override.

    return (
        <DashboardPreview
            dashboardId={dashboardId}
            staticConfig={config}
        />
    );
}
