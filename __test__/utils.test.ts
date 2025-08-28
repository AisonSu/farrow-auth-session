import { describe, it, expect } from 'vitest'
import { oneMinute, oneHour, oneDay, oneWeek } from '../src/utils'

describe('Time Constants', () => {
  it('should define oneMinute as 60 seconds', () => {
    expect(oneMinute).toBe(60)
  })

  it('should define oneHour as 60 minutes', () => {
    expect(oneHour).toBe(60 * 60)
    expect(oneHour).toBe(3600)
  })

  it('should define oneDay as 24 hours', () => {
    expect(oneDay).toBe(24 * 60 * 60)
    expect(oneDay).toBe(86400)
  })

  it('should define oneWeek as 7 days', () => {
    expect(oneWeek).toBe(7 * 24 * 60 * 60)
    expect(oneWeek).toBe(604800)
  })

  it('should have correct relationships between time units', () => {
    expect(oneHour).toBe(oneMinute * 60)
    expect(oneDay).toBe(oneHour * 24)
    expect(oneWeek).toBe(oneDay * 7)
  })
})