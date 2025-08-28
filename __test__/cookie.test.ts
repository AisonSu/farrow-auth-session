import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { Http, Response } from 'farrow-http'
import { 
  cookieSessionParser, 
  cookieSessionStore, 
  sessionMetaDataCtx,
  idToIv 
} from '../src/cookie'
import { createAuthCtx, createFarrowAuth } from '../src/auth'
import { oneMinute } from '../src/utils'

describe('Cookie Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('idToIv', () => {
    it('should generate consistent IV from sessionId', () => {
      const sessionId = 'test-session-id'
      const iv1 = idToIv(sessionId)
      const iv2 = idToIv(sessionId)
      
      expect(iv1).toEqual(iv2)
      expect(iv1).toHaveLength(16)
    })

    it('should generate different IVs for different sessionIds', () => {
      const iv1 = idToIv('session-1')
      const iv2 = idToIv('session-2')
      
      expect(iv1).not.toEqual(iv2)
    })
  })

  describe('cookieSessionParser', () => {
    it('should get sessionId from cookie', async () => {
      const parser = cookieSessionParser()
      const encodedId = Buffer.from('test-session-id').toString('base64')
      
      const app = Http()
      app.use(async (request) => {
        const sessionId = await parser.get(request)
        return Response.json({ sessionId })
      })
      
      const res = await request(app.server())
        .get('/')
        .set('Cookie', `sess:k=${encodedId}`)
        .expect(200)
      
      expect(res.body).toEqual({ sessionId: 'test-session-id' })
    })

    it('should return null when cookie is missing', async () => {
      const parser = cookieSessionParser()
      
      const app = Http()
      app.use(async (request) => {
        const sessionId = await parser.get(request)
        return Response.json({ sessionId })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      expect(res.body).toEqual({ sessionId: null })
    })

    it('should use custom codec if provided', async () => {
      const customCodec = {
        encode: (plain: string) => `encoded-${plain}`,
        decode: (encoded: string) => encoded.replace('encoded-', ''),
      }
      const parser = cookieSessionParser({ customCodec })
      
      const app = Http()
      app.use(async (request) => {
        const sessionId = await parser.get(request)
        return Response.json({ sessionId })
      })
      
      const res = await request(app.server())
        .get('/')
        .set('Cookie', 'sess:k=encoded-my-session')
        .expect(200)
      
      expect(res.body).toEqual({ sessionId: 'my-session' })
    })

    it('should use custom sessionIdKey', async () => {
      const parser = cookieSessionParser({ sessionIdKey: 'custom-key' })
      const encodedId = Buffer.from('test-id').toString('base64')
      
      const app = Http()
      app.use(async (request) => {
        const sessionId = await parser.get(request)
        return Response.json({ sessionId })
      })
      
      const res = await request(app.server())
        .get('/')
        .set('Cookie', `custom-key=${encodedId}`)
        .expect(200)
      
      expect(res.body).toEqual({ sessionId: 'test-id' })
    })

    it('should set cookie with session metadata', async () => {
      const parser = cookieSessionParser()
      
      const app = Http()
      app.use(async () => {
        const sessionMeta = {
          sessionId: 'new-session',
          expiresTime: Date.now() + 30 * oneMinute * 1000,
        }
        sessionMetaDataCtx.set(sessionMeta)
        
        const response = await parser.set()
        return response.json({ success: true })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      
      const setCookie = res.headers['set-cookie']
      expect(setCookie).toBeDefined()
      expect(setCookie[0]).toContain('sess:k=')
      expect(res.body).toEqual({ success: true })
    })

    it('should return empty response when no session metadata', async () => {
      const parser = cookieSessionParser()
      
      const app = Http()
      app.use(async () => {
        const response = await parser.set()
        return response.json({ success: true })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      
      const setCookie = res.headers['set-cookie']
      expect(setCookie).toBeUndefined()
      expect(res.body).toEqual({ success: true })
    })

    it('should remove cookie', async () => {
      const parser = cookieSessionParser()
      
      const app = Http()
      app.use(async () => {
        const response = await parser.remove()
        return response.json({ removed: true })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      
      const setCookie = res.headers['set-cookie']
      expect(setCookie).toBeDefined()
      expect(setCookie[0]).toContain('sess:k=;')
      expect(setCookie[0]).toContain('expires=Thu, 01 Jan 1970')
      expect(res.body).toEqual({ removed: true })
    })
  })

  describe('cookieSessionStore', () => {
    it('should throw error if secret is not provided', () => {
      expect(() => cookieSessionStore({ secret: '' })).toThrow(
        'Secret is required for cookieSessionStore'
      )
    })

    it('should throw error if both rolling and renew are true', () => {
      expect(() => cookieSessionStore({ 
        secret: 'test-secret',
        rolling: true,
        renew: true,
      })).toThrow(
        'Cannot use both rolling and renew modes at the same time'
      )
    })

    it('should create and get session', async () => {
      const authCtx = createAuthCtx<{ id: string; name: string }>({ id: '', name: '' })
      const store = cookieSessionStore<{ id: string; name: string }>({ 
        secret: 'test-secret',
      })
      const parser = cookieSessionParser()
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: parser,
        authStore: store,
      })
      
      app.use(middleware)
      app.use(async () => {
        const userData = authCtx.get()
        if (!userData || !userData.id) {
          authCtx.set({ id: 'user-1', name: 'John' })
        }
        return Response.json({ userData: authCtx.get() })
      })
      
      // First request - create session
      const res1 = await request(app.server()).get('/').expect(200)
      expect(res1.body.userData).toEqual({ id: 'user-1', name: 'John' })
      
      const cookies = res1.headers['set-cookie']
      expect(cookies).toBeDefined()
      expect(cookies.length).toBeGreaterThan(0)
      
      // Second request - retrieve session
      const res2 = await request(app.server())
        .get('/')
        .set('Cookie', cookies)
        .expect(200)
      
      expect(res2.body.userData).toEqual({ id: 'user-1', name: 'John' })
    })

    it('should handle expired session', async () => {
      const authCtx = createAuthCtx<{ id: string }>({ id: '' })
      const store = cookieSessionStore<{ id: string }>({ 
        secret: 'test-secret',
        cookieOptions: { maxAge: 1000 }, // 1 second
      })
      const parser = cookieSessionParser({ 
        cookieOptions: { maxAge: 1000 }
      })
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: parser,
        authStore: store,
      })
      
      app.use(middleware)
      app.use(() => {
        const userData = authCtx.get()
        if (!userData || !userData.id) {
          authCtx.set({ id: 'new-user' })
        }
        return Response.json({ userData: authCtx.get() })
      })
      
      // Create session
      const res1 = await request(app.server()).get('/').expect(200)
      expect(res1.body.userData.id).toBe('new-user')
      
      const cookies = res1.headers['set-cookie']
      
      // Fast forward time past expiration
      vi.advanceTimersByTime(2000)
      
      // Try to use expired session
      const res2 = await request(app.server())
        .get('/')
        .set('Cookie', cookies)
        .expect(200)
      
      // Should create a new session due to expiration
      expect(res2.body.userData.id).toBe('new-user')
    })

    it('should update expiration time in rolling mode', async () => {
      const authCtx = createAuthCtx<{ id: string; counter: number }>({ id: '', counter: 0 })
      const store = cookieSessionStore<{ id: string; counter: number }>({ 
        secret: 'test-secret',
        rolling: true,
        cookieOptions: { maxAge: 30 * oneMinute * 1000 },
      })
      const parser = cookieSessionParser()
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: parser,
        authStore: store,
      })
      
      app.use(middleware)
      app.use(() => {
        let userData = authCtx.get()
        if (!userData || !userData.id) {
          authCtx.set({ id: 'user-1', counter: 1 })
        } else {
          authCtx.set({ ...userData, counter: userData.counter + 1 })
        }
        return Response.json({ userData: authCtx.get() })
      })
      
      // First request
      const res1 = await request(app.server()).get('/').expect(200)
      expect(res1.body.userData).toEqual({ id: 'user-1', counter: 1 })
      
      const cookies1 = res1.headers['set-cookie']
      
      // Advance time by 10 minutes
      vi.advanceTimersByTime(10 * oneMinute * 1000)
      
      // Second request - should update expiration in rolling mode
      const res2 = await request(app.server())
        .get('/')
        .set('Cookie', cookies1)
        .expect(200)
      
      expect(res2.body.userData).toEqual({ id: 'user-1', counter: 2 })
      
      const cookies2 = res2.headers['set-cookie']
      expect(cookies2).toBeDefined() // New cookies set with updated expiration
    })

    it('should only renew when near expiry in renew mode', async () => {
      const authCtx = createAuthCtx<{ id: string }>({ id: '' })
      const store = cookieSessionStore<{ id: string }>({ 
        secret: 'test-secret',
        renew: true,
        renewBefore: 10 * oneMinute * 1000, // Renew if less than 10 minutes left
        cookieOptions: { maxAge: 30 * oneMinute * 1000 },
      })
      const parser = cookieSessionParser()
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: parser,
        authStore: store,
      })
      
      app.use(middleware)
      let requestCount = 0
      app.use(() => {
        requestCount++
        let userData = authCtx.get()
        if (!userData || !userData.id) {
          authCtx.set({ id: 'user-1' })
        }
        return Response.json({ 
          userData: authCtx.get(),
          request: requestCount 
        })
      })
      
      // First request - create session
      const res1 = await request(app.server()).get('/').expect(200)
      expect(res1.body.userData).toEqual({ id: 'user-1' })
      
      const cookies = res1.headers['set-cookie']
      
      // Advance time by 5 minutes (not near expiry)
      vi.advanceTimersByTime(5 * oneMinute * 1000)
      
      // Second request - should NOT renew
      const res2 = await request(app.server())
        .get('/')
        .set('Cookie', cookies)
        .expect(200)
      
      expect(res2.body.userData).toEqual({ id: 'user-1' })
      
      // Advance time to near expiry (22 more minutes = 27 total, 3 minutes left)
      vi.advanceTimersByTime(22 * oneMinute * 1000)
      
      // Third request - should renew
      const res3 = await request(app.server())
        .get('/')
        .set('Cookie', cookies)
        .expect(200)
      
      expect(res3.body.userData).toEqual({ id: 'user-1' })
      const cookies3 = res3.headers['set-cookie']
      expect(cookies3).toBeDefined() // Should have new cookies with renewed expiration
    })

    it('should destroy session', async () => {
      const authCtx = createAuthCtx<{ id: string }>({ id: '' })
      const store = cookieSessionStore<{ id: string }>({ 
        secret: 'test-secret',
      })
      const parser = cookieSessionParser()
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: false,
        authParser: parser,
        authStore: store,
      })
      
      app.use(middleware)
      app.post('/logout').use(async () => {
        const result = await authCtx.destroy()
        return Response.json({ destroyed: result })
      })
      
      app.get('/').use(() => {
        const userData = authCtx.get()
        if (!userData) {
          authCtx.set({ id: 'user-1' })
        }
        return Response.json({ userData: authCtx.get() })
      })
      
      // Create session
      const res1 = await request(app.server()).get('/').expect(200)
      const cookies = res1.headers['set-cookie']
      
      // Destroy session
      const res2 = await request(app.server())
        .post('/logout')
        .set('Cookie', cookies)
        .expect(200)
      
      expect(res2.body).toEqual({ destroyed: true })
      
      // Check cookies are cleared
      const clearCookies = res2.headers['set-cookie']
      expect(clearCookies).toBeDefined()
      expect(clearCookies[0]).toContain('expires=Thu, 01 Jan 1970')
    })

    it('should use dataCreator if provided', async () => {
      const authCtx = createAuthCtx<any>(undefined)
      const dataCreator = vi.fn((req, data) => ({ 
        ...data, 
        id: data?.id || 'generated-id',
        createdAt: Date.now(),
        userAgent: req.headers?.['user-agent'] || 'unknown'
      }))
      
      const store = cookieSessionStore<any>({ 
        secret: 'test-secret',
        dataCreator,
      })
      const parser = cookieSessionParser()
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: parser,
        authStore: store,
      })
      
      app.use(middleware)
      app.use(() => {
        const userData = authCtx.get()
        return Response.json({ userData })
      })
      
      const res = await request(app.server())
        .get('/')
        .set('User-Agent', 'TestAgent/1.0')
        .expect(200)
      
      expect(dataCreator).toHaveBeenCalled()
      expect(res.body.userData).toHaveProperty('id')
      expect(res.body.userData).toHaveProperty('createdAt')
      expect(res.body.userData.userAgent).toBe('TestAgent/1.0')
    })
  })

  describe('Integration Tests', () => {
    it('should handle complete session lifecycle', async () => {
      const authCtx = createAuthCtx<{ 
        id: string; 
        username: string;
        loginCount: number;
      }>({ id: '', username: '', loginCount: 0 })
      
      const store = cookieSessionStore({ 
        secret: 'integration-test-secret',
        rolling: true,
        cookieOptions: { 
          maxAge: 30 * oneMinute * 1000,
          httpOnly: true,
        }
      })
      
      const parser = cookieSessionParser()
      
      const app = Http()
      
      // Apply auth middleware
      app.use(createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: parser,
        authStore: store,
      }))
      
      // Login endpoint
      app.post('/login', {
        body: { username: String, password: String }
      }).use(async (request) => {
        const { username, password } = request.body
        
        if (username === 'admin' && password === 'secret') {
          authCtx.set({
            id: 'user-123',
            username: 'admin',
            loginCount: 1
          })
          return Response.json({ success: true, userData: authCtx.get() })
        }
        
        return Response.status(401).json({ error: 'Invalid credentials' })
      })
      
      // Protected endpoint
      app.get('/profile').use(() => {
        const userData = authCtx.get()
        if (!userData || !userData.id) {
          return Response.status(401).json({ error: 'Not authenticated' })
        }
        return Response.json({ userData })
      })
      
      // Logout endpoint
      app.post('/logout').use(async () => {
        await authCtx.destroy()
        return Response.json({ success: true })
      })
      
      // 1. Try accessing protected route without auth
      const res1 = await request(app.server())
        .get('/profile')
        .expect(401)
      
      expect(res1.body).toEqual({ error: 'Not authenticated' })
      
      // 2. Login
      const res2 = await request(app.server())
        .post('/login')
        .send({ username: 'admin', password: 'secret' })
        .expect(200)
      
      expect(res2.body.success).toBe(true)
      expect(res2.body.userData).toEqual({
        id: 'user-123',
        username: 'admin',
        loginCount: 1
      })
      
      const sessionCookies = res2.headers['set-cookie']
      expect(sessionCookies).toBeDefined()
      
      // 3. Access protected route with session
      const res3 = await request(app.server())
        .get('/profile')
        .set('Cookie', sessionCookies)
        .expect(200)
      
      expect(res3.body.userData).toMatchObject({
        id: 'user-123',
        username: 'admin'
      })
      
      // 4. Logout
      const res4 = await request(app.server())
        .post('/logout')
        .set('Cookie', sessionCookies)
        .expect(200)
      
      expect(res4.body.success).toBe(true)
      
      // 5. Try accessing protected route after logout
      const res5 = await request(app.server())
        .get('/profile')
        .set('Cookie', res4.headers['set-cookie'] || [])
        .expect(401)
      
      expect(res5.body).toEqual({ error: 'Not authenticated' })
    })
  })
})