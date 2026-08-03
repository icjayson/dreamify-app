import { api } from './api';

export interface FeedbackPayload {
  category: string;
  message: string;
}

export interface OverallFeedbackPayload {
  full_name: string;
  email: string;
  overall_rating: number;
  visual_appeal_rating: number;
  metrics_insights_rating: number;
  layout_editing_rating: number;
  share_link_rating: number;
  requested_connectors: string;
  dashboard_improvements: string;
  export_improvements: string;
  website?: string;
}

class FeedbackService {
  async submit(payload: FeedbackPayload): Promise<{ success: boolean }> {
    const res = await api.post<{ success: boolean }>('/api/v1/feedback', payload);
    if (!res.success) throw new Error(res.error || 'Failed to submit feedback');
    return res.data!;
  }

  async submitOverall(payload: OverallFeedbackPayload): Promise<{ success: boolean }> {
    const res = await api.post<{ success: boolean }>('/api/v1/feedback/overall', payload);
    if (!res.success) throw new Error(res.error || 'Failed to submit overall feedback');
    return res.data!;
  }
}

export const feedbackService = new FeedbackService();
