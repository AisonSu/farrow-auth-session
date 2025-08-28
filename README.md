# farrow-auth

Type-safe authentication and session management for Farrow HTTP framework.

## Features

- 🔐 **Flexible Authentication Architecture** - Support any authentication method via AuthStore and AuthParser interfaces
- 🔒 **Type Safety** - Full TypeScript support with automatic type inference
- 🏗️ **Modular Design** - Complete decoupling of storage and parsing layers for easy extension
- 🎯 **Context-Driven** - Based on farrow-pipeline's Context system with request-level isolation
- ⚡ **Automatic State Management** - Tracks data modifications and intelligently determines when to save
- 🚀 **Native Integration** - Designed specifically for Farrow framework with seamless middleware integration

## Installation

```bash
npm install farrow-auth
# or
yarn add farrow-auth
# or
pnpm add farrow-auth
```

## Quick Start

The following example demonstrates basic usage with the built-in Cookie Session components. You can also create custom authentication solutions by implementing the AuthStore and AuthParser interfaces.

### Basic Cookie Session

```typescript
import { Http } from 'farrow-http'
import { createAuth, createAuthCtx, cookieSessionParser, cookieSessionStore } from 'farrow-auth'

// Define your user data type
type UserData = {
  userId?: string
  username?: string
  role?: string
}

// Create auth context
const authUserDataCtx = createAuthCtx<UserData>({})

// Setup authentication middleware
const authMiddleware = createAuth({
  authUserDataCtx,
  authParser: cookieSessionParser(),
  authStore: cookieSessionStore<UserData>({
    secret: process.env.SESSION_SECRET || 'your-secret-key-min-32-chars-long!!!'
  }),
  autoSave: true
})

// Create HTTP app
const app = Http()

// Method 1: Apply auth middleware globally
app.use(authMiddleware)

// Method 2: Apply to specific routes
const protectedRouter = Router()
protectedRouter.use(authMiddleware)  // Only use auth in this router group

protectedRouter.get('/profile').use(() => {
  const userData = authUserDataCtx.get()
  return Response.json(userData)
})

protectedRouter.post('/update').use((request) => {
  authUserDataCtx.set({ ...authUserDataCtx.get(), ...request.body })
  return Response.json({ success: true })
})

app.route('/api/protected').use(protectedRouter)  // Mount protected routes

// Use session in routes
app.post('/login').use(async (request) => {
  // Your login logic here
  const user = await validateUser(request.body)
  
  // Set user data in session
  authUserDataCtx.set({
    userId: user.id,
    username: user.name,
    role: user.role
  })
  
  return Response.json({ success: true })
})

app.get('/profile').use(() => {
  const userData = authUserDataCtx.get()
  
  if (!userData?.userId) {
    return Response.status(401).json({ error: 'Not authenticated' })
  }
  
  return Response.json(userData)
})

app.post('/logout').use(async () => {
  await authUserDataCtx.destroy()
  return Response.json({ success: true })
})

app.listen(3000)
```

## Cookie Components

### CookieSessionParser - Cookie Session Parser

Responsible for parsing session ID from HTTP request cookies and setting/removing cookies in responses.

**Key Features:**
- Extract and decode session ID from request cookies
- Set encrypted session ID in response
- Support custom encoder/decoder
- Manage cookie lifecycle

### CookieSessionStore - Cookie Session Storage

⚠️ **Security Warning**: CookieSessionStore stores session data directly in client-side cookies. Although it uses AES-256-CBC encryption, there are still security risks:
- Client can see the encrypted data
- Cookie size limitation (typically 4KB)
- Not suitable for storing sensitive information

**Recommended Use Cases:**
- Development and testing environments
- Storing non-sensitive user preferences
- Small applications or prototyping

**Production Recommendation**: Use server-side storage solutions like Redis or databases.

**Key Features:**
- AES-256-CBC encryption for session data
- Support rolling/renew expiration strategies
- Automatic session lifecycle management
- Data integrity verification

## Configuration Options

### Cookie Session Parser Options

```typescript
cookieSessionParser({
  sessionIdKey: 'sess:k',        // Cookie key for session ID
  cookieOptions: {
    maxAge: 30 * 60 * 1000,      // 30 minutes
    httpOnly: true,               // HTTP only cookie
    sameSite: 'lax',              // CSRF protection
    secure: true,                 // HTTPS only (production)
    domain: '.example.com',       // Cookie domain
    path: '/'                     // Cookie path
  },
  customCodec: {                  // Optional custom encoding
    encode: (id) => customEncode(id),
    decode: (encoded) => customDecode(encoded)
  }
})
```

### Cookie Session Store Options

```typescript
cookieSessionStore<UserData>({
  secret: process.env.SESSION_SECRET,  // Required: encryption secret key
  sessionStoreKey: 'sess:data',        // Cookie key for session data
  rolling: true,                        // Reset expiry on every request
  renew: false,                         // Renew only when near expiration
  renewBefore: 10 * 60 * 1000,         // Renew 10 minutes before expiry
  cookieOptions: {
    maxAge: 60 * 60 * 1000,             // 1 hour
    httpOnly: true,
    sameSite: 'strict'
  },
  dataCreator: (request, userData) => {
    // Initialize session data
    return {
      createdAt: Date.now(),
      ip: request.headers['x-forwarded-for'],
      ...userData
    }
  }
})
```

## Session Expiration Strategies

### Rolling Sessions
Resets expiration time on every request. Best for "keep alive" scenarios.

```typescript
cookieSessionStore({
  secret: process.env.SESSION_SECRET,
  rolling: true,
  cookieOptions: { maxAge: 30 * 60 * 1000 } // 30 minutes
})
```

### Renewing Sessions
Only updates expiration when close to expiry. Better performance.

```typescript
cookieSessionStore({
  secret: process.env.SESSION_SECRET,
  renew: true,
  renewBefore: 10 * 60 * 1000, // Renew 10 minutes before expiry
  cookieOptions: { maxAge: 60 * 60 * 1000 } // 1 hour
})
```

### Fixed Sessions
Session expires at a fixed time regardless of activity.

```typescript
cookieSessionStore({
  secret: process.env.SESSION_SECRET,
  rolling: false,
  renew: false,
  cookieOptions: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
})
```

## Route-Level Usage

### Flexible Route Configuration

You can use authentication middleware in different route groups as needed:

```typescript
import { Http, Router } from 'farrow-http'

const app = Http()

// Public routes (no auth required)
const publicRouter = Router()
publicRouter.get('/about').use(() => {
  return Response.json({ message: 'About us' })
})

// Protected routes (auth required)
const protectedRouter = Router()
protectedRouter.use(authMiddleware)  // Only use in this router group

protectedRouter.get('/<userId:string>').use((request) => {
  const userData = authUserDataCtx.get()
  if (!userData) {
    return Response.status(401).json({ error: 'Login required' })
  }
  
  // Store route params in auth context
  authUserDataCtx.set({ ...userData, currentUserId: request.params.userId })
  
  return Response.json({ 
    message: `User ${userData.username} is viewing ${request.params.userId}'s info` 
  })
})

protectedRouter.get('/dashboard').use(() => {
  const userData = authUserDataCtx.get()
  return Response.json({ 
    dashboard: 'User dashboard data',
    user: userData 
  })
})

// Admin routes (special permissions required)
const adminRouter = Router()
adminRouter.use(authMiddleware)
adminRouter.use((request, next) => {
  const userData = authUserDataCtx.get()
  if (!userData?.isAdmin) {
    return Response.status(403).json({ error: 'Admin access required' })
  }
  return next(request)
})

adminRouter.get('/users').use(() => {
  return Response.json({ users: getAllUsers() })
})

// Mount routes
app.route('/public').use(publicRouter)
app.route('/user').use(protectedRouter)
app.route('/admin').use(adminRouter)

app.listen(3000)
```

### Conditional Authentication

Decide whether to use authentication based on different conditions:

```typescript
const apiRouter = Router()

// Optional auth: logged-in users get more permissions
apiRouter.use((request, next) => {
  // Check for token or cookie
  const hasAuth = request.headers.authorization || request.cookies?.['sess:k']
  
  if (hasAuth) {
    // Has auth info, apply auth middleware
    return authMiddleware(request, next)
  }
  
  // No auth info, continue without auth
  return next(request)
})

apiRouter.get('/posts').use(() => {
  const userData = authUserDataCtx.get()
  
  if (userData) {
    // Logged-in user: return personalized content
    return Response.json({ 
      posts: getPersonalizedPosts(userData.userId),
      recommended: true 
    })
  } else {
    // Guest user: return public content
    return Response.json({ 
      posts: getPublicPosts(),
      recommended: false 
    })
  }
})
```

## Advanced Usage

### AuthUserDataCtx Core Methods

`authUserDataCtx` provides complete authentication data management functionality:

#### 1. `get()` - Get current user data
```typescript
app.get('/profile').use(() => {
  const userData = authUserDataCtx.get()
  if (!userData) {
    return Response.status(401).json({ error: 'Not authenticated' })
  }
  return Response.json(userData)
})
```

#### 2. `set(data)` - Set user data
```typescript
app.post('/login').use(async (request) => {
  const user = await validateUser(request.body)
  
  // Set user data (automatically marked as modified)
  authUserDataCtx.set({
    userId: user.id,
    username: user.name,
    role: user.role
  })
  
  return Response.json({ success: true })
})
```

#### 3. `regenerate()` - Regenerate session
Used for security-sensitive operations like privilege escalation or session refresh before important operations.

```typescript
app.post('/admin/login').use(async () => {
  // Regenerate session ID while preserving existing data
  const success = await authUserDataCtx.regenerate()
  
  if (success) {
    // Update permissions
    const current = authUserDataCtx.get()
    authUserDataCtx.set({ ...current, isAdmin: true })
    return Response.json({ message: 'Admin privileges activated' })
  }
  
  return Response.status(500).json({ error: 'Failed to regenerate session' })
})
```

Return values:
- `true`: Successfully regenerated
- `false`: Operation failed (e.g., no data exists)
- `undefined`: Internal error

#### 4. `destroy()` - Destroy session
Completely clears user authentication data and session.

```typescript
app.post('/logout').use(async () => {
  const result = await authUserDataCtx.destroy()
  
  if (result) {
    return Response.json({ message: 'Successfully logged out' })
  }
  
  return Response.status(500).json({ error: 'Logout failed' })
})
```

Return values:
- `true`: Successfully destroyed
- `false`: Operation failed (e.g., session doesn't exist)
- `undefined`: Internal error

#### 5. `saveToStore()` - Manually save to storage
When `autoSave: false`, you need to manually call this method to save data.

```typescript
const authMiddleware = createAuth({
  authUserDataCtx,
  authParser: cookieSessionParser(),
  authStore: cookieSessionStore({ secret: 'secret-key' }),
  autoSave: false  // Disable auto-save
})

app.post('/save-progress').use(async () => {
  authUserDataCtx.set({ ...userData, progress: 50 })
  
  // Manual save
  const saved = await authUserDataCtx.saveToStore()
  if (saved) {
    return Response.json({ message: 'Progress saved' })
  }
  
  return Response.status(500).json({ error: 'Save failed' })
})
```

Return values:
- `true`: Successfully saved
- `false`: Save failed
- `undefined`: Internal error

#### 6. `isModified` - Check if data was modified
Read-only property to check if data was modified in the current request.

```typescript
app.use((request, next) => {
  const response = next()
  
  // Log session modification status
  if (authUserDataCtx.isModified) {
    console.log(`Session modified for ${request.pathname}`)
  }
  
  return response
})
```

### Production Recommendation: Custom Authentication Store

For security and performance, production environments should use server-side storage (Redis, Database, etc.):

```typescript
import { AuthStore } from 'farrow-auth'

class RedisSessionStore<UserData> implements AuthStore<UserData, string> {
  autoCreateOnMissing = true
  
  async get(sessionId: string) {
    const data = await redis.get(`session:${sessionId}`)
    return data ? JSON.parse(data) : null
  }
  
  async set(userData: UserData) {
    const sessionId = sessionMetaDataCtx.get()?.sessionId
    if (!sessionId) return false
    
    await redis.setex(
      `session:${sessionId}`,
      3600,
      JSON.stringify(userData)
    )
    return true
  }
  
  async create(userData?: UserData) {
    const sessionId = generateId()
    const data = userData || {}
    
    await redis.setex(
      `session:${sessionId}`,
      3600,
      JSON.stringify(data)
    )
    
    sessionMetaDataCtx.set({
      sessionId,
      expiresTime: Date.now() + 3600000
    })
    
    return data
  }
  
  async destroy() {
    const sessionId = sessionMetaDataCtx.get()?.sessionId
    if (!sessionId) return false
    
    await redis.del(`session:${sessionId}`)
    return true
  }
  
  async touch() {
    const sessionId = sessionMetaDataCtx.get()?.sessionId
    if (!sessionId) return false
    
    await redis.expire(`session:${sessionId}`, 3600)
    return true
  }
}
```

### JWT Authentication Parser

```typescript
import { AuthParser } from 'farrow-auth'

class JWTParser implements AuthParser<string> {
  async get(request: RequestInfo) {
    const auth = request.headers.authorization
    if (!auth?.startsWith('Bearer ')) return null
    
    return auth.substring(7)
  }
  
  async set() {
    const token = generateJWT(authUserDataCtx.get())
    return Response.header('X-Auth-Token', token)
  }
  
  async remove() {
    return Response.header('X-Auth-Token', '')
  }
}
```

## Security Best Practices

1. **Use strong encryption keys** - Set at least 32 characters random secret key, store in environment variables
2. **Always use HTTPS in production** - Set `secure: true` in cookie options
3. **Enable httpOnly** - Prevents XSS attacks from accessing cookies
4. **Use sameSite** - Provides CSRF protection
5. **Regenerate sessions** - After login or privilege changes
6. **Set appropriate expiration** - Balance security and user experience
7. **Store minimal data** - Keep sensitive data server-side

## API Reference

### createAuth(config)

Creates authentication middleware.

- `config.authUserDataCtx` - Context for user data storage
- `config.authParser` - Parser for credentials (cookies, headers, etc.)
- `config.authStore` - Storage backend for session data
- `config.autoSave` - Automatically save modified sessions

### createAuthCtx<T>(defaultData)

Creates a typed authentication context.

### cookieSessionParser(options?)

Creates a cookie-based session ID parser.

### cookieSessionStore<T>(options?)

Creates an encrypted cookie-based session store.

### AuthStore<UserData, Credit>

Interface for custom storage implementations.

### AuthParser<Credit>

Interface for custom credential parsers.

## Utilities

```typescript
import { oneMinute, oneHour, oneDay, oneWeek } from 'farrow-auth'

// Time constants in seconds
const sessionDuration = 2 * oneHour * 1000 // 2 hours in milliseconds
```

## TypeScript Support

The library provides full TypeScript support with type inference:

```typescript
import { InferUserData, InferCredit } from 'farrow-auth'

// Infer types from config
type MyUserData = InferUserData<typeof authConfig>
type MyCredit = InferCredit<typeof authConfig>
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.