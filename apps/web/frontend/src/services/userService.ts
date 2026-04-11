import { api } from './api';

export interface UserLookupResult {
  success: boolean;
  user_id?: string;
  email?: string;
  name?: string;
  image_url?: string;
}

class UserService {
  private baseUrl = '/api/v1';

  async lookupUserByEmail(email: string, signal?: AbortSignal): Promise<UserLookupResult> {
    const res = await api.get<UserLookupResult>(
      `${this.baseUrl}/user/lookup?email=${encodeURIComponent(email)}`,
      { signal }
    );
    if (res.success && res.data) {
      return res.data;
    }
    return { success: false };
  }
}

export const userService = new UserService();
