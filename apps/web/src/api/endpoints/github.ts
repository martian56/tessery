import { baseApi } from '../base'
import type { components } from '../schema'

type S = components['schemas']
export type GithubSettings = S['GithubSettings']
export type GithubRepo = S['GithubRepoDto']

export const githubApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    githubSettings: b.query<GithubSettings, string | void>({ query: (org) => ({ url: '/admin/github', params: org ? { org } : {} }), providesTags: ['GitHub'] }),
    forgetGithub: b.mutation<void, void>({ query: () => ({ url: '/admin/github', method: 'DELETE' }), invalidatesTags: ['GitHub'] }),
    githubRepos: b.query<GithubRepo[], string>({ query: (pid) => `/projects/${pid}/github/repos` }),
    linkGithub: b.mutation<void, { pid: string; repo: string }>({ query: ({ pid, repo }) => ({ url: `/projects/${pid}/github`, method: 'PUT', body: { repo } }), invalidatesTags: ['Remote'] }),
  }),
})

export const { useGithubSettingsQuery, useForgetGithubMutation, useGithubReposQuery, useLinkGithubMutation } = githubApi
