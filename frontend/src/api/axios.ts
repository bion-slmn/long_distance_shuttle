// src/api/axios.ts
import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL;

// Main instance — has the interceptors
const api = axios.create({
  baseURL,
  withCredentials: true,
});

// Separate, interceptor-free instance used ONLY for the refresh call.
// This guarantees a failed refresh can never re-trigger the interceptor.
export const refreshApi = axios.create({
  baseURL,
  withCredentials: true,
});

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

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

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

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
        const { data } = await refreshApi.post("/auth/refresh");
        setAccessToken(data.access_token);
        isRefreshing = false;
        onRefreshed(data.access_token);
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];
        setAccessToken(null);
        // don't redirect here — let AuthContext/route guards handle it
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;