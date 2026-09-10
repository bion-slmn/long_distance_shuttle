// src/api/axios.ts
import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL;

declare module "axios" {
  export interface AxiosRequestConfig {
    skipAuthRefresh?: boolean;
  }
}

// ─── Token storage ───────────────────────────────────────────────────────────
// access_token lives in memory only (never persisted — it's short-lived and
// re-fetched via refresh on reload). refresh_token lives in localStorage since
// there's no more httpOnly cookie holding it for us. Centralized here so every
// read/write goes through one place instead of `localStorage.getItem` calls
// scattered across the app.
const REFRESH_TOKEN_KEY = "refresh_token";

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getRefreshToken = (): string | null => {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
};

export const setRefreshToken = (token: string | null) => {
  if (token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
};

// Call this on logout, or when a refresh attempt fails, to wipe both tokens.
export const clearSession = () => {
  setAccessToken(null);
  setRefreshToken(null);
};

// ─── Instances ───────────────────────────────────────────────────────────────
// Main instance — has the interceptors
const api = axios.create({
  baseURL,
});

// Separate, interceptor-free instance used ONLY for the refresh call.
// This guarantees a failed refresh can never re-trigger the interceptor.
export const refreshApi = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest?.skipAuthRefresh) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const storedRefreshToken = getRefreshToken();
      if (!storedRefreshToken) {
        // Nothing to refresh with — don't even try, just bail out to the
        // catch path so route guards see a clean rejection.
        clearSession();
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((newToken: string) => {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;
      try {
        // uses refreshApi, NOT api — cannot recurse into this interceptor
        const { data } = await refreshApi.post("/auth/refresh", {
          refresh_token: storedRefreshToken,
        });
        setAccessToken(data.access_token);
        setRefreshToken(data.refresh_token);
        isRefreshing = false;
        onRefreshed(data.access_token);
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];
        clearSession();
        // don't redirect here — let AuthContext/route guards handle it
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;