import axios, { AxiosError } from 'axios';

// Separate storage keys from the tenant app on purpose. A platform admin and a
// manager account are two different people with two different tokens, and the
// operator usually has both open -- signing into a customer's workspace to
// reproduce a bug must not silently end the back-office session, and vice
// versa. Sharing one key would make each login evict the other.
export const ADMIN_TOKEN_STORAGE_KEY = 'shiftplanner.admin.token';
export const ADMIN_STORAGE_KEY = 'shiftplanner.admin.user';

const baseURL =
  (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000') + '/api/v1';

export const adminApi = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 drop only the *admin* session and bounce to the back-office login.
adminApi.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      localStorage.removeItem(ADMIN_STORAGE_KEY);
      if (window.location.pathname !== '/backoffice/login') {
        window.location.assign('/backoffice/login');
      }
    }
    return Promise.reject(error);
  },
);
