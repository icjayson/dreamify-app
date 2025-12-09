import { api } from './api';

export interface WaitlistStatusResponse {
  success: boolean;
  status: string;
  message: string;
  email: string;
  invitation_id?: string;
  waitlist_entry_id?: string;
  can_login: boolean;
  action_required?: string;
}

class WaitlistService {
  async checkStatus(email: string): Promise<WaitlistStatusResponse> {
    const encodedEmail = encodeURIComponent(email);
    const response = await api.get<WaitlistStatusResponse>(
      `/api/v1/waitlist/status?email=${encodedEmail}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to check waitlist status');
  }
}

export const waitlistService = new WaitlistService();

