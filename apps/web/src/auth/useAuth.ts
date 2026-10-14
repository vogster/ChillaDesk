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
import type { RegistrationMode } from '@chilladesk/shared'
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

/**
 * What the server offers. Until it has answered, sign-up is shown as open (the server has the
 * last word) and email as off.
 */
export function useAuthOptions() {
  const options = useQuery({
    queryKey: ['auth', 'options'],
    queryFn: fetchAuthOptions,
    staleTime: Infinity,
    retry: false,
  })
  const data = options.data ?? { registrationEnabled: true, emailEnabled: false }
  // Servers before invitation-only sign-up say only whether anyone may sign up.
  const registration: RegistrationMode =
    data.registration ?? (data.registrationEnabled ? 'open' : 'closed')
  return { ...data, registration }
}
