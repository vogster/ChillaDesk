import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  changePassword,
  completeRegistration,
  fetchAuthOptions,
  fetchCurrentUser,
  login,
  logout,
  register,
  updateProfile,
} from '../api/auth'
import { currentUserKey } from '../queryClient'

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => queryClient.setQueryData(currentUserKey, user),
  })
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: register,
    // A sign-up that is finished by email signs nobody in yet.
    onSuccess: (user) => {
      if (user !== 'pending') queryClient.setQueryData(currentUserKey, user)
    },
  })
}

export function useCompleteRegistration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: completeRegistration,
    onSuccess: (user) => queryClient.setQueryData(currentUserKey, user),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(currentUserKey, null)
      // Drop everything cached for the previous user, keeping the query the app is watching.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== currentUserKey[0] })
    },
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (user) => queryClient.setQueryData(currentUserKey, user),
  })
}

export const useChangePassword = () => useMutation({ mutationFn: changePassword })

/** What the server offers; false for everything until it has answered. */
export function useAuthOptions() {
  const options = useQuery({
    queryKey: ['auth', 'options'],
    queryFn: fetchAuthOptions,
    staleTime: Infinity,
    retry: false,
  })
  return options.data ?? { registrationEnabled: false, emailEnabled: false }
}
