import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { Http, Response } from 'farrow-http'
import { createAuthCtx, createFarrowAuth, type AuthStore, type AuthParser } from '../src/auth'

describe('Auth Module', () => {
  describe('createAuthCtx', () => {
    it('should create an auth context with default value', async () => {
      const defaultData = { id: '1', name: 'Test User' }
      const authCtx = createAuthCtx(defaultData)
      
      const app = Http()
      app.use(() => {
        expect(authCtx.get()).toEqual(defaultData)
        expect(authCtx.isModified).toBe(false)
        return Response.json({ success: true })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      expect(res.body).toEqual({ success: true })
    })

    it('should track modification when set is called', async () => {
      const authCtx = createAuthCtx<{ id: string }>({ id: '1' })
      
      const app = Http()
      app.use(() => {
        authCtx.set({ id: '2' })
        expect(authCtx.get()).toEqual({ id: '2' })
        expect(authCtx.isModified).toBe(true)
        return Response.json({ modified: authCtx.isModified })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      expect(res.body).toEqual({ modified: true })
    })

    it('should throw error when methods are called without middleware', async () => {
      const authCtx = createAuthCtx({})
      
      await expect(authCtx.saveToStore()).rejects.toThrow('saveToStore is not implemented yet')
      await expect(authCtx.regenerate()).rejects.toThrow('regenerate is not implemented yet')
      await expect(authCtx.destroy()).rejects.toThrow('destroy is not implemented yet')
    })
  })

  describe('createFarrowAuth', () => {
    let mockParser: AuthParser<string>
    let mockStore: AuthStore<any, string>
    let authCtx: ReturnType<typeof createAuthCtx<{ id: string; name?: string } | undefined>>

    beforeEach(() => {
      authCtx = createAuthCtx<{ id: string; name?: string } | undefined>(undefined)
      
      mockParser = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(Response),
        remove: vi.fn().mockResolvedValue(Response),
      }
      
      mockStore = {
        autoCreateOnMissing: false,
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(true),
        create: vi.fn().mockResolvedValue({ id: '123' }),
        destroy: vi.fn().mockResolvedValue(true),
      }
    })

    it('should handle request without credentials', async () => {
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: false,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        return Response.json({ userData: authCtx.get() })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      
      expect(mockParser.get).toHaveBeenCalled()
      expect(mockParser.remove).toHaveBeenCalled()
      // Since we didn't set any data, userData should be undefined
      expect(res.body.userData).toBeUndefined()
    })

    it('should auto-create session when autoCreateOnMissing is true', async () => {
      mockStore.autoCreateOnMissing = true
      mockStore.create = vi.fn().mockResolvedValue({ id: 'new-session' })
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: false,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        return Response.json({ userData: authCtx.get() })
      })
      
      const res = await request(app.server()).get('/').expect(200)
      
      expect(mockStore.create).toHaveBeenCalled()
      expect(res.body).toEqual({ userData: { id: 'new-session' } })
    })

    it('should handle valid credentials', async () => {
      mockParser.get = vi.fn().mockResolvedValue('valid-session-id')
      mockStore.get = vi.fn().mockResolvedValue({ id: '123', name: 'John' })
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: false,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        return Response.json({ userData: authCtx.get() })
      })
      
      const res = await request(app.server())
        .get('/')
        .set('Cookie', 'sessionId=valid-session-id')
        .expect(200)
      
      expect(mockStore.get).toHaveBeenCalledWith('valid-session-id')
      expect(res.body).toEqual({ userData: { id: '123', name: 'John' } })
    })

    it('should handle invalid credentials and create new session', async () => {
      mockParser.get = vi.fn().mockResolvedValue('invalid-session-id')
      mockStore.get = vi.fn().mockResolvedValue(null) // Invalid session
      mockStore.create = vi.fn().mockResolvedValue({ id: 'new-session' })
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: false,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        return Response.json({ userData: authCtx.get() })
      })
      
      const res = await request(app.server())
        .get('/')
        .set('Cookie', 'sessionId=invalid-session-id')
        .expect(200)
      
      expect(mockStore.get).toHaveBeenCalledWith('invalid-session-id')
      expect(mockStore.create).toHaveBeenCalled()
      expect(res.body).toEqual({ userData: { id: 'new-session' } })
    })

    it('should auto-save modified data when autoSave is true', async () => {
      mockParser.get = vi.fn().mockResolvedValue('session-id')
      mockStore.get = vi.fn().mockResolvedValue({ id: '123', count: 1 })
      mockStore.set = vi.fn().mockResolvedValue(true)
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        const userData = authCtx.get()
        authCtx.set({ ...userData, count: 2 })
        return Response.json({ success: true })
      })
      
      await request(app.server()).get('/').expect(200)
      
      expect(mockStore.set).toHaveBeenCalledWith({ id: '123', count: 2 })
    })

    it('should use touch method when data not modified', async () => {
      // Reset authCtx with proper initial value
      authCtx = createAuthCtx<{ id: string; name?: string } | undefined>(undefined)
      
      mockParser.get = vi.fn().mockResolvedValue('session-id')
      mockStore.get = vi.fn().mockResolvedValue({ id: '123' })
      mockStore.touch = vi.fn().mockResolvedValue(true)
      mockStore.set = vi.fn().mockResolvedValue(true)
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        // Don't modify the data
        return Response.json({ userData: authCtx.get() })
      })
      
      await request(app.server()).get('/').expect(200)
      
      expect(mockStore.touch).toHaveBeenCalled()
      expect(mockStore.set).not.toHaveBeenCalled()
    })

    it('should fall back to set when touch is not available', async () => {
      mockParser.get = vi.fn().mockResolvedValue('session-id')
      mockStore.get = vi.fn().mockResolvedValue({ id: '123' })
      mockStore.set = vi.fn().mockResolvedValue(true)
      // No touch method
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        return Response.json({ userData: authCtx.get() })
      })
      
      await request(app.server()).get('/').expect(200)
      
      expect(mockStore.set).toHaveBeenCalledWith({ id: '123' })
    })

    it('should return error on store internal error', async () => {
      mockParser.get = vi.fn().mockResolvedValue('session-id')
      mockStore.get = vi.fn().mockResolvedValue(undefined) // Internal error
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: false,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        return Response.json({ unreachable: true })
      })
      
      const res = await request(app.server()).get('/').expect(500)
      expect(res.body).toEqual({ error: 'Internal Server Error' })
    })

    it('should return error when create fails', async () => {
      mockStore.autoCreateOnMissing = true
      mockStore.create = vi.fn().mockResolvedValue(undefined) // Create fails
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: false,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        return Response.json({ unreachable: true })
      })
      
      const res = await request(app.server()).get('/').expect(500)
      expect(res.body).toEqual({ error: 'Internal Server Error' })
    })

    it('should return error when autoSave fails', async () => {
      mockParser.get = vi.fn().mockResolvedValue('session-id')
      mockStore.get = vi.fn().mockResolvedValue({ id: '123' })
      mockStore.set = vi.fn().mockResolvedValue(false) // Set fails
      
      const app = Http()
      const middleware = createFarrowAuth({
        authUserDataCtx: authCtx,
        autoSave: true,
        authParser: mockParser,
        authStore: mockStore,
      })
      
      app.use(middleware)
      app.use(() => {
        authCtx.set({ id: '123', modified: true })
        return Response.json({ success: true })
      })
      
      const res = await request(app.server()).get('/').expect(401)
      expect(res.body).toEqual({ error: 'AuthStore Set Failed' })
    })

    describe('auth methods', () => {
      it('should implement regenerate method', async () => {
        mockParser.get = vi.fn().mockResolvedValue('old-session')
        mockStore.get = vi.fn().mockResolvedValue({ id: '123', name: 'John' })
        mockStore.create = vi.fn().mockResolvedValue({ id: '123', name: 'John' })
        mockParser.set = vi.fn().mockResolvedValue(Response.cookie('sessionId', 'new-session'))
        
        const app = Http()
        const middleware = createFarrowAuth({
          authUserDataCtx: authCtx,
          autoSave: false,
          authParser: mockParser,
          authStore: mockStore,
        })
        
        app.use(middleware)
        app.use(async () => {
          const result = await authCtx.regenerate()
          return Response.json({ regenerated: result })
        })
        
        const res = await request(app.server()).get('/').expect(200)
        
        expect(mockStore.create).toHaveBeenCalledWith({ id: '123', name: 'John' })
        expect(res.body).toEqual({ regenerated: true })
      })

      it('should implement destroy method', async () => {
        mockParser.get = vi.fn().mockResolvedValue('session-id')
        mockStore.get = vi.fn().mockResolvedValue({ id: '123' })
        mockStore.destroy = vi.fn().mockResolvedValue(true)
        mockParser.remove = vi.fn().mockResolvedValue(Response.cookie('sessionId', '', { maxAge: -1 }))
        
        const app = Http()
        const middleware = createFarrowAuth({
          authUserDataCtx: authCtx,
          autoSave: false,
          authParser: mockParser,
          authStore: mockStore,
        })
        
        app.use(middleware)
        app.use(async () => {
          const result = await authCtx.destroy()
          return Response.json({ 
            destroyed: result,
            userData: authCtx.get()
          })
        })
        
        const res = await request(app.server()).get('/').expect(200)
        
        expect(mockStore.destroy).toHaveBeenCalled()
        expect(res.body).toEqual({ 
          destroyed: true,
          userData: undefined
        })
      })

      it('should implement saveToStore method', async () => {
        mockParser.get = vi.fn().mockResolvedValue('session-id')
        mockStore.get = vi.fn().mockResolvedValue({ id: '123' })
        mockStore.set = vi.fn().mockResolvedValue(true)
        
        const app = Http()
        const middleware = createFarrowAuth({
          authUserDataCtx: authCtx,
          autoSave: false,
          authParser: mockParser,
          authStore: mockStore,
        })
        
        app.use(middleware)
        app.use(async () => {
          authCtx.set({ id: '123', updated: true })
          const result = await authCtx.saveToStore()
          return Response.json({ saved: result })
        })
        
        const res = await request(app.server()).get('/').expect(200)
        
        expect(mockStore.set).toHaveBeenCalledWith({ id: '123', updated: true })
        expect(res.body).toEqual({ saved: true })
      })

      it('should use touch in saveToStore when data not modified', async () => {
        // Reset authCtx with proper initial value
        authCtx = createAuthCtx<{ id: string; name?: string } | undefined>(undefined)
        
        mockParser.get = vi.fn().mockResolvedValue('session-id')
        mockStore.get = vi.fn().mockResolvedValue({ id: '123' })
        mockStore.touch = vi.fn().mockResolvedValue(true)
        mockStore.set = vi.fn().mockResolvedValue(true)
        
        const app = Http()
        const middleware = createFarrowAuth({
          authUserDataCtx: authCtx,
          autoSave: false,
          authParser: mockParser,
          authStore: mockStore,
        })
        
        app.use(middleware)
        app.use(async () => {
          // Don't modify data
          const result = await authCtx.saveToStore()
          return Response.json({ saved: result })
        })
        
        const res = await request(app.server()).get('/').expect(200)
        
        expect(mockStore.touch).toHaveBeenCalled()
        expect(mockStore.set).not.toHaveBeenCalled()
        expect(res.body).toEqual({ saved: true })
      })
    })
  })
})