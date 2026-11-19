import { describe, expect, it } from 'vitest'
import { guestRoute } from './guest-jurors'

const RUN = '0b6c2d4e-1f2a-4b3c-8d4e-5f6a7b8c9d0e'
const CASE = '11111111-2222-4333-8444-555555555555'

describe('guestRoute (D-41, spec 04 D-89)', () => {
  it('allows only its review routes and, since spec 04, a GET of one question document', () => {
    expect(guestRoute('GET', `/api/v1/runs/${RUN}`)).toBe(RUN)
    expect(guestRoute('PUT', `/api/v1/runs/${RUN}/review`)).toBe(RUN)
    expect(guestRoute('GET', `/api/v1/runs/${RUN}/documents/${CASE}`)).toBe(RUN)
    expect(guestRoute('PUT', `/api/v1/runs/${RUN}/documents/${CASE}`)).toBeNull()
    expect(guestRoute('DELETE', `/api/v1/runs/${RUN}/documents/${CASE}`)).toBeNull()
    expect(guestRoute('GET', `/api/v1/runs/${RUN}/documents/not-a-uuid`)).toBeNull()
    expect(guestRoute('GET', `/api/v1/runs/${RUN}/documents/${CASE}/extra`)).toBeNull()
    expect(guestRoute('GET', `/api/v1/evaluations/${RUN}/documents/${CASE}`)).toBeNull()
    expect(guestRoute('GET', `/api/v1/runs/${RUN}/export`)).toBeNull()
  })
})
