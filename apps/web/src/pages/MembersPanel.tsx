import {
  addMemberRequestSchema,
  projectRoleSchema,
  type Project,
  type ProjectMember,
  type ProjectRole,
  type User,
} from '@chillawiki/shared'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, Card, selectClass, Spinner, TextField } from '../components/ui'
import { useMemberMutations, useMembers } from './projectQueries'

const ROLES = projectRoleSchema.options

function RoleOptions() {
  return ROLES.map((role) => (
    <option key={role} value={role}>
      {role}
    </option>
  ))
}

interface MembersPanelProps {
  project: Project
  currentUser: User
}

export function MembersPanel({ project, currentUser }: MembersPanelProps) {
  const members = useMembers(project.id)
  const { add, changeRole, remove } = useMemberMutations(project.id, currentUser.id)
  const navigate = useNavigate()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const isOwner = project.role === 'owner'
  const actionError = add.error ?? changeRole.error ?? remove.error

  // Each action starts clean, so the alert always belongs to the latest one.
  const clearErrors = () => {
    add.reset()
    changeRole.reset()
    remove.reset()
  }

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = parseForm(addMemberRequestSchema, {
      email: String(form.get('email') ?? '').trim(),
      role: form.get('role'),
    })
    clearErrors()
    if (!parsed.ok) {
      setFieldErrors(parsed.errors)
      focusFirstInvalid(formElement, parsed.errors)
      return
    }
    setFieldErrors({})
    add.mutate(parsed.data, { onSuccess: () => formElement.reset() })
  }

  const handleRemove = (member: ProjectMember) => {
    const leaving = member.userId === currentUser.id
    clearErrors()
    remove.mutate(member.userId, {
      // After leaving, the project is no longer visible to this user.
      onSuccess: () => {
        if (leaving) navigate('/', { replace: true })
      },
    })
  }

  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold">Members</h2>
      {actionError && (
        <div className="mb-4">
          <Alert>{errorMessage(actionError)}</Alert>
        </div>
      )}
      {members.isPending && <Spinner />}
      {members.isError && <Alert>{errorMessage(members.error)}</Alert>}
      {members.isSuccess && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {members.data.map((member) => {
            const isSelf = member.userId === currentUser.id
            return (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name}
                    {isSelf && <span className="ml-1 font-normal text-slate-500">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{member.email}</p>
                </div>
                {isOwner ? (
                  <select
                    aria-label={`Role of ${member.name}`}
                    className={selectClass}
                    value={member.role}
                    disabled={changeRole.isPending}
                    onChange={(event) => {
                      clearErrors()
                      changeRole.mutate({
                        userId: member.userId,
                        role: event.target.value as ProjectRole,
                      })
                    }}
                  >
                    <RoleOptions />
                  </select>
                ) : (
                  <span className="text-sm text-slate-600 capitalize dark:text-slate-400">
                    {member.role}
                  </span>
                )}
                {(isOwner || isSelf) && (
                  <Button
                    variant="secondary"
                    disabled={remove.isPending}
                    onClick={() => handleRemove(member)}
                    aria-label={isSelf ? 'Leave project' : `Remove ${member.name}`}
                  >
                    {isSelf ? 'Leave' : 'Remove'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {isOwner && (
        <form
          onSubmit={handleAdd}
          noValidate
          className="mt-4 flex flex-wrap items-start gap-3 border-t border-slate-200 pt-4 dark:border-slate-800"
        >
          <TextField
            label="Add a member by email"
            name="email"
            type="email"
            placeholder="teammate@example.com"
            required
            hint="They need a ChillaWiki account first"
            error={fieldErrors.email}
            className="min-w-56 flex-1"
          />
          <div>
            <label htmlFor="new-member-role" className="mb-1 block text-sm font-medium">
              Role
            </label>
            <select
              id="new-member-role"
              name="role"
              defaultValue="member"
              className={`${selectClass} py-2`}
            >
              <RoleOptions />
            </select>
          </div>
          <Button type="submit" className="mt-6" disabled={add.isPending}>
            Add
          </Button>
        </form>
      )}
    </Card>
  )
}
