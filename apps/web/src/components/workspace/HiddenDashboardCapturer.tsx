/**
 * HiddenDashboardCapturer
 *
 * When the Dashboards tab is opened in the workspace, if there are any
 * dashboard projects that don't yet have a PNG preview, this component:
 *   1. Loads the dashboard JSON from the backend (via conversationService)
 *   2. Renders a hidden DashboardPreview off-screen (using its built-in
 *      id="dashboard-preview-root" element for html2canvas targeting)
 *   3. Waits for charts to settle (4 s)
 *   4. Captures the DOM with html2canvas → Blob
 *   5. Uploads the Blob to S3 via the backend API
 *   6. Calls onPreviewGenerated so the parent can update the visible URL
 *
 * Dashboards are processed ONE AT A TIME (serial queue) to avoid perf issues.
 */

import { useEffect, useRef, useState } from 'react';
import DashboardPreview from '@/components/project-section/DashboardPreview';
import type { ProjectRecord } from '@/services/projectService';

// DashboardPreview always renders with id="dashboard-preview-root"
const CAPTURE_ELEMENT_ID = 'dashboard-preview-root';
const SETTLE_DELAY_MS = 4000; // ms to wait for charts to finish rendering

interface CaptureTask {
  project: ProjectRecord;
  conversationId: string;
  dashboardId: string;
}

interface Props {
  /** Projects that have a dashboard but no preview key yet */
  projectsNeedingPreview: ProjectRecord[];
  onPreviewGenerated: (projectId: string, previewUrl: string) => void;
}

export default function HiddenDashboardCapturer({
  projectsNeedingPreview,
  onPreviewGenerated,
}: Props) {
  const [queue, setQueue] = useState<CaptureTask[]>([]);
  const [currentTask, setCurrentTask] = useState<CaptureTask | null>(null);
  const [dashboardData, setDashboardData] = useState<any | null>(null);
  const isProcessing = useRef(false);
  const didBuildQueue = useRef(false);
  const currentTaskRef = useRef<CaptureTask | null>(null);

  // ── Build queue once per mount (i.e. once per tab open) ─────────────────────
  useEffect(() => {
    if (didBuildQueue.current || projectsNeedingPreview.length === 0) return;
    didBuildQueue.current = true;

    const tasks: CaptureTask[] = projectsNeedingPreview
      .filter((p) => p.latest_conversation_id && p.latest_dashboard_id)
      .map((p) => ({
        project: p,
        conversationId: p.latest_conversation_id!,
        dashboardId: p.latest_dashboard_id!,
      }));

    setQueue(tasks);
  }, [projectsNeedingPreview]);

  // ── Process next item when queue changes ─────────────────────────────────────
  useEffect(() => {
    if (isProcessing.current || queue.length === 0) return;
    isProcessing.current = true;

    const [next, ...rest] = queue;
    setQueue(rest);
    processTask(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  async function processTask(task: CaptureTask) {
    try {
      // 1. Load dashboard data
      const { conversationService } = await import('@/services/conversationService');
      const response = await conversationService.getDashboardData(
        task.conversationId,
        task.project.id,
        task.dashboardId,
      );

      if (!response?.dashboard_data) {
        console.warn(`[Capturer] no dashboard data for project ${task.project.id}`);
        finishTask();
        return;
      }

      // Setting these will trigger the useEffect below to schedule capture
      currentTaskRef.current = task;
      setDashboardData(response.dashboard_data);
      setCurrentTask(task);
    } catch (e) {
      console.warn('[Capturer] failed to load dashboard data:', e);
      finishTask();
    }
  }

  // ── Once dashboardData is set + DashboardPreview has mounted, start capture ──
  useEffect(() => {
    if (!currentTask || !dashboardData) return;

    // Give DashboardPreview time to render + charts to settle
    const timerId = setTimeout(() => {
      if (currentTaskRef.current) capture(currentTaskRef.current);
    }, SETTLE_DELAY_MS);
    return () => clearTimeout(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTask, dashboardData]);

  async function capture(task: CaptureTask) {
    try {
      const { captureDashboardAsWebpBlob } = await import('@/utils/exportUtils');
      const blob = await captureDashboardAsWebpBlob(CAPTURE_ELEMENT_ID);

      if (!blob) {
        console.warn(`[Capturer] blank capture for project ${task.project.id}`);
        finishTask();
        return;
      }

      const { projectService } = await import('@/services/projectService');
      const upload = await projectService.uploadDashboardPreview(
        task.project.id,
        task.dashboardId,
        blob,
      );
      if (!upload.success) {
        return;
      }

      // Fetch fresh presigned URL and surface it to the parent
      const urlResult = await projectService.getDashboardPreviewUrl(task.project.id);
      if (urlResult.url) {
        onPreviewGenerated(task.project.id, urlResult.url);
      }

      console.log(`[Capturer] preview generated for project ${task.project.id}`);
    } catch (e) {
      console.warn('[Capturer] capture/upload failed:', e);
    } finally {
      finishTask();
    }
  }

  function finishTask() {
    currentTaskRef.current = null;
    setCurrentTask(null);
    setDashboardData(null);
    isProcessing.current = false;
    // Nudge the queue effect; use functional setter so we get the latest state
    setQueue((q) => (q.length > 0 ? [...q] : q));
  }

  if (!currentTask || !dashboardData) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: '-9999px',
        left: '-9999px',
        width: '1400px',   // wide enough for the full dashboard grid
        height: '900px',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: -1,
        // opacity:0 keeps the element painted (html2canvas needs it)
        // visibility:hidden would prevent painting, so we use opacity instead
        opacity: 0,
      }}
    >
      <DashboardPreview
        dashboardId={currentTask.dashboardId}
        processedData={dashboardData}
        showCardActionsMenu={false}
        disablePersistence
      />
    </div>
  );
}
