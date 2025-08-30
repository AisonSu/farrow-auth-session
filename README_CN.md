# farrow-auth-session

为 Farrow HTTP 框架提供的基于会话的认证中间件，具有灵活的存储和解析层。

## 特性

- 🔐 **灵活的认证架构** - 通过 SessionStore 和 SessionParser 接口支持任意认证方式
- 🔒 **类型安全** - 完整的 TypeScript 支持，自动类型推导
- 🏗️ **模块化设计** - 存储层与解析层完全解耦，易于扩展
- 🎯 **上下文驱动** - 基于 farrow-pipeline 的 Context 系统，请求级隔离
- ⚡ **自动状态管理** - 自动跟踪数据修改，智能决定是否需要保存
- 🚀 **原生集成** - 专为 Farrow 框架原生设计，无缝集成中间件系统

## 安装

```bash
npm install farrow-auth-session
# 或
yarn add farrow-auth-session
# 或
pnpm add farrow-auth-session
```

## 快速开始

以下示例使用库自带的 Cookie Session 组件展示基本用法。您也可以通过实现 SessionStore 和 SessionParser 接口来创建自定义的认证方案。

### 基础 Cookie 会话

```typescript
import { Http } from 'farrow-http'
import { createSession, createSessionCtx, cookieSessionParser, cookieSessionStore } from 'farrow-auth-session'

// 定义用户数据类型
type UserData = {
  userId?: string
  username?: string
  role?: string
}

// 创建认证上下文
const sessionUserDataCtx = createSessionCtx<UserData>({})

// 设置认证中间件
const sessionMiddleware = createSession({
  sessionUserDataCtx,
  sessionParser: cookieSessionParser(),
  sessionStore: cookieSessionStore<UserData>({
    secret: process.env.SESSION_SECRET || 'your-secret-key-min-32-chars-long!!!'
  }),
  autoSave: true,
  autoCreateOnMissing: true
})

// 创建 HTTP 应用
const app = Http()

// 方式 1: 全局应用认证中间件
app.use(sessionMiddleware)

// 方式 2: 在特定路由使用
const protectedRouter = Router()
protectedRouter.use(sessionMiddleware)  // 仅在此路由组中使用认证

protectedRouter.get('/profile').use(() => {
  const userData = sessionUserDataCtx.get()
  return Response.json(userData)
})

protectedRouter.post('/update').use((request) => {
  sessionUserDataCtx.set({ ...sessionUserDataCtx.get(), ...request.body })
  return Response.json({ success: true })
})

app.route('/api/protected').use(protectedRouter)  // 挂载受保护的路由

// 在路由中使用会话
app.post('/login').use(async (request) => {
  // 你的登录逻辑
  const user = await validateUser(request.body)
  
  // 在会话中设置用户数据
  sessionUserDataCtx.set({
    userId: user.id,
    username: user.name,
    role: user.role
  })
  
  return Response.json({ success: true })
})

app.get('/profile').use(() => {
  const userData = sessionUserDataCtx.get()
  
  if (!userData?.userId) {
    return Response.status(401).json({ error: '未认证' })
  }
  
  return Response.json(userData)
})

app.post('/logout').use(async () => {
  await sessionUserDataCtx.destroy()
  return Response.json({ success: true })
})

app.listen(3000)
```

## Cookie 组件介绍

### CookieSessionParser - Cookie 会话解析器

负责从 HTTP 请求的 Cookie 中解析会话 ID，以及在响应中设置/删除 Cookie。

**主要功能：**
- 从请求 Cookie 中提取并解码会话 ID
- 在响应中设置加密后的会话 ID
- 支持自定义编解码器
- 管理 Cookie 生命周期

### CookieSessionStore - Cookie 会话存储

⚠️ **安全警告**：CookieSessionStore 将会话数据直接存储在客户端 Cookie 中，虽然使用 AES-256-CBC 加密，但仍存在以下安全风险：
- 客户端可以看到加密后的数据
- Cookie 大小限制（通常 4KB）
- 不适合存储敏感信息

**推荐用途**：
- 开发和测试环境
- 存储非敏感的用户偏好设置
- 小型应用或原型开发

对于生产环境，建议实现自定义 SessionStore 配合服务器端存储（Redis、数据库等）以获得更好的安全性和可扩展性。

**主要功能：**
- 使用 AES-256-CBC 加密会话数据
- 支持 rolling/renew 过期策略
- 自动管理会话生命周期
- 数据完整性验证

## 配置选项

### Cookie 会话解析器选项

```typescript
cookieSessionParser({
  sessionIdKey: 'sess:k',        // 会话 ID 的 Cookie 键名
  cookieOptions: {
    maxAge: 30 * 60 * 1000,      // 30 分钟
    httpOnly: true,               // 仅 HTTP 访问
    sameSite: 'lax',              // CSRF 防护
    secure: true,                 // 仅 HTTPS（生产环境）
    domain: '.example.com',       // Cookie 域名
    path: '/'                     // Cookie 路径
  },
  customCodec: {                  // 可选的自定义编码
    encode: (id) => customEncode(id),
    decode: (encoded) => customDecode(encoded)
  }
})
```

### Cookie 会话存储选项

```typescript
cookieSessionStore<UserData>({
  secret: process.env.SESSION_SECRET,  // 必需：加密密钥
  sessionStoreKey: 'sess:data',        // 会话数据的 Cookie 键名
  rolling: true,                        // 每次请求重置过期时间
  renew: false,                         // 仅在接近过期时续期
  renewBefore: 10 * 60 * 1000,         // 过期前 10 分钟续期
  cookieOptions: {
    maxAge: 60 * 60 * 1000,             // 1 小时
    httpOnly: true,
    sameSite: 'strict'
  },
  dataCreator: (request, userData) => {
    // 初始化会话数据
    return {
      createdAt: Date.now(),
      ip: request.headers['x-forwarded-for'],
      ...userData
    }
  }
})
```

## 会话过期策略

### 滚动会话（Rolling Sessions）
每次请求都重置过期时间。适合"保持活跃"的场景。

```typescript
cookieSessionStore({
  secret: process.env.SESSION_SECRET,
  rolling: true,
  cookieOptions: { maxAge: 30 * 60 * 1000 } // 30 分钟
})
```

使用场景：
- 在线编辑器
- 管理后台
- 实时协作工具

### 续期会话（Renewing Sessions）
仅在接近过期时更新过期时间。性能更好。

```typescript
cookieSessionStore({
  secret: process.env.SESSION_SECRET,
  renew: true,
  renewBefore: 10 * 60 * 1000, // 过期前 10 分钟续期
  cookieOptions: { maxAge: 60 * 60 * 1000 } // 1 小时
})
```

使用场景：
- 银行系统
- 企业应用
- 电商平台

### 固定会话（Fixed Sessions）
会话在固定时间过期，不受活动影响。

```typescript
cookieSessionStore({
  secret: process.env.SESSION_SECRET,
  rolling: false,
  renew: false,
  cookieOptions: { maxAge: 8 * 60 * 60 * 1000 } // 8 小时
})
```

使用场景：
- 考试系统
- 限时活动
- 临时访问令牌

## 路由级使用

### 灵活的路由配置

您可以根据需要在不同的路由组中使用认证中间件：

```typescript
import { Http, Router } from 'farrow-http'

const app = Http()

// 公开路由（不需要认证）
const publicRouter = Router()
publicRouter.get('/about').use(() => {
  return Response.json({ message: '关于我们' })
})

// 受保护路由（需要认证）
const protectedRouter = Router()
protectedRouter.use(sessionMiddleware)  // 只在这个路由组中使用

protectedRouter.get('/<userId:string>').use((request) => {
  const userData = sessionUserDataCtx.get()
  if (!userData) {
    return Response.status(401).json({ error: '需要登录' })
  }
  
  // 在认证上下文中存储路由参数
  sessionUserDataCtx.set({ ...userData, currentUserId: request.params.userId })
  
  return Response.json({ 
    message: `用户 ${userData.username} 正在查看 ${request.params.userId} 的信息` 
  })
})

protectedRouter.get('/dashboard').use(() => {
  const userData = sessionUserDataCtx.get()
  return Response.json({ 
    dashboard: '用户仪表板数据',
    user: userData 
  })
})

// 管理员路由（需要特殊权限）
const adminRouter = Router()
adminRouter.use(sessionMiddleware)
adminRouter.use((request, next) => {
  const userData = sessionUserDataCtx.get()
  if (!userData?.isAdmin) {
    return Response.status(403).json({ error: '需要管理员权限' })
  }
  return next(request)
})

adminRouter.get('/users').use(() => {
  return Response.json({ users: getAllUsers() })
})

// 挂载路由
app.route('/public').use(publicRouter)
app.route('/user').use(protectedRouter)
app.route('/admin').use(adminRouter)

app.listen(3000)
```

## 高级用法

### SessionUserDataCtx 核心方法

`sessionUserDataCtx` 提供了完整的认证数据管理功能：

#### 1. `get()` - 获取当前用户数据
```typescript
app.get('/profile').use(() => {
  const userData = sessionUserDataCtx.get()
  if (!userData) {
    return Response.status(401).json({ error: '未认证' })
  }
  return Response.json(userData)
})
```

#### 2. `set(data)` - 设置用户数据
```typescript
app.post('/login').use(async (request) => {
  const user = await validateUser(request.body)
  
  // 设置用户数据（自动标记为已修改）
  sessionUserDataCtx.set({
    userId: user.id,
    username: user.name,
    role: user.role
  })
  
  return Response.json({ success: true })
})
```

#### 3. `regenerate()` - 重新生成会话
用于安全敏感操作，如权限提升、重要操作前的会话刷新。

```typescript
app.post('/admin/login').use(async () => {
  // 重新生成会话 ID，保留现有数据
  const success = await sessionUserDataCtx.regenerate()
  
  if (success) {
    // 更新权限
    const current = sessionUserDataCtx.get()
    sessionUserDataCtx.set({ ...current, isAdmin: true })
    return Response.json({ message: '管理员权限已激活' })
  }
  
  return Response.status(500).json({ error: '会话重新生成失败' })
})
```

返回值：
- `true`: 成功重新生成
- `false`: 操作失败（如数据不存在）
- `undefined`: 内部错误

#### 4. `destroy()` - 销毁会话
完全清除用户认证数据和会话。

```typescript
app.post('/logout').use(async () => {
  const result = await sessionUserDataCtx.destroy()
  
  if (result) {
    return Response.json({ message: '已成功登出' })
  }
  
  return Response.status(500).json({ error: '登出失败' })
})
```

返回值：
- `true`: 成功销毁
- `false`: 操作失败（如会话不存在）
- `undefined`: 内部错误

#### 5. `saveToStore()` - 手动保存到存储
当 `autoSave: false` 时，需要手动调用此方法保存数据。

```typescript
const sessionMiddleware = createAuth({
  sessionUserDataCtx,
  authParser: cookieSessionParser(),
  authStore: cookieSessionStore({ secret: 'secret-key' }),
  autoSave: false  // 禁用自动保存
})

app.post('/save-progress').use(async () => {
  sessionUserDataCtx.set({ ...userData, progress: 50 })
  
  // 手动保存
  const saved = await sessionUserDataCtx.saveToStore()
  if (saved) {
    return Response.json({ message: '进度已保存' })
  }
  
  return Response.status(500).json({ error: '保存失败' })
})
```

返回值：
- `true`: 成功保存
- `false`: 保存失败
- `undefined`: 内部错误

#### 6. `isModified` - 检查数据是否被修改
只读属性，用于检查当前请求中数据是否被修改过。

```typescript
app.use((request, next) => {
  const response = next()
  
  // 记录会话修改情况
  if (sessionUserDataCtx.isModified) {
    console.log(`Session modified for ${request.pathname}`)
  }
  
  return response
})
```

## 自定义适配器开发

### 核心概念

farrow-auth-session 通过两个接口实现解耦：
- **SessionStore**：数据存储（Redis、数据库、Cookie等）
- **SessionParser**：凭证解析（从请求提取、向响应设置）

两者通过 `sessionMetaDataCtx` 传递会话元数据（sessionId、过期时间）。

### 实现 SessionStore

```typescript
import { SessionStore, sessionMetaDataCtx } from 'farrow-auth-session'

class RedisStore<T> implements SessionStore<T, string> {
  async get(sessionId: string) {
    const data = await redis.get(sessionId)
    if (!data) return null  // 不存在
    
    // 设置元数据供 Parser 使用
    sessionMetaDataCtx.set({ 
      sessionId, 
      expiresTime: data.expires 
    })
    return data.value
  }
  
  async set(userData: T) {
    const meta = sessionMetaDataCtx.get()
    if (!meta) return false
    
    await redis.set(meta.sessionId, userData)
    return true
  }
  
  async create(userData?: T) {
    const sessionId = generateId()
    const expiresTime = Date.now() + 3600000
    
    await redis.set(sessionId, userData || {})
    sessionMetaDataCtx.set({ sessionId, expiresTime })
    return userData || {} as T
  }
  
  async destroy() {
    const meta = sessionMetaDataCtx.get()
    if (!meta) return false
    
    await redis.del(meta.sessionId)
    return true
  }
  
  // 可选：仅更新过期时间
  async touch() {
    const meta = sessionMetaDataCtx.get()
    if (!meta) return false
    
    await redis.expire(meta.sessionId, 3600)
    return true
  }
}
```

### 实现 SessionParser

```typescript
import { SessionParser, sessionMetaDataCtx, Response } from 'farrow-auth-session'

class HeaderParser implements SessionParser<string> {
  async get(request) {
    // 从请求头提取
    return request.headers?.['x-session-id'] || null
  }
  
  async set() {
    const meta = sessionMetaDataCtx.get()
    if (!meta) return Response
    
    // 设置响应头
    return Response.header('X-Session-Id', meta.sessionId)
  }
  
  async remove() {
    return Response.header('X-Session-Id', '')
  }
}
```

### 返回值约定

- **成功**：返回数据或 `true`
- **失败**：返回 `null` 或 `false`  
- **错误**：返回 `undefined`

### 实际案例

参考 [fa-session-redis](https://github.com/AisonSu/fa-session-redis)（实验性但已测试）

## API 参考

### createSession(config)

创建认证中间件。

- `config.sessionUserDataCtx` - 用户数据存储的上下文
- `config.sessionParser` - 凭证解析器（cookies、headers 等）
- `config.sessionStore` - 会话数据的存储后端
- `config.autoSave` - 自动保存修改的会话
- `config.autoCreateOnMissing` - 缺失时自动创建新会话

### createSessionCtx<T>(defaultData)

创建类型化的认证上下文。

### cookieSessionParser(options?)

创建基于 Cookie 的会话 ID 解析器。

### cookieSessionStore<T>(options?)

创建加密的基于 Cookie 的会话存储。

### SessionStore<UserData, Credit>

自定义存储实现的接口。

### SessionParser<Credit>

自定义凭证解析器的接口。

## 工具函数

```typescript
import { oneMinute, oneHour, oneDay, oneWeek } from 'farrow-auth-session'

// 时间常量（秒）
const sessionDuration = 2 * oneHour * 1000 // 2 小时（毫秒）
```

## TypeScript 支持

本库提供完整的 TypeScript 支持和类型推导：

```typescript
import { InferUserData, InferCredit } from 'farrow-auth-session'

// 从配置推导类型
type MyUserData = InferUserData<typeof authConfig>
type MyCredit = InferCredit<typeof authConfig>
```

## 常见问题

### Q: rolling 和 renew 策略有什么区别？

**A:** 
- `rolling`：每次请求都重置过期时间，适合需要用户保持活跃的场景
- `renew`：只在临近过期时才更新，性能更好，适合平衡安全性和体验的场景

### Q: 如何处理并发请求中的会话更新？

**A:** farrow-auth 基于 farrow-pipeline 的 AsyncLocalStorage，每个请求都有独立的上下文，天然避免了并发问题。

### Q: 可以同时使用多种认证方式吗？

**A:** 可以通过实现自定义的 SessionParser 和 SessionStore 来支持不同的认证方式。

## 许可证

MIT

## 贡献

欢迎贡献！请随时提交 Pull Request。