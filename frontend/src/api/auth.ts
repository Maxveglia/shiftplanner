import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type {
  AuthResponse,
  LoginPayload,
  SignupPayload,
  UserOut,
} from '../types';
import { useAuth } from '../auth/useAuth';

export function useLogin() {
  const { setSession } = useAuth();
  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { data } = await api.post<AuthResponse>('/auth/login', payload);
      return data;
    },
    onSuccess: (data) => setSession(data),
  });
}

export function useSignup() {
  const { setSession } = useAuth();
  return useMutation({
    mutationFn: async (payload: SignupPayload) => {
      const { data } = await api.post<AuthResponse>('/auth/signup', payload);
      return data;
    },
    onSuccess: (data) => setSession(data),
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    enabled,
    queryFn: async () => {
      const { data } = await api.get<UserOut>('/auth/me');
      return data;
    },
  });
}
