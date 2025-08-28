import { createCipheriv, createDecipheriv, createHash } from 'crypto'
import type { SetOption } from 'cookies'
import { authHeaderCtx, AuthStore, AuthParser } from './auth'
import { Response, useRequestInfo, RequestInfo } from 'farrow-http'
import { ulid } from 'ulid'
import { oneMinute } from './utils'
import { createContext } from 'farrow-pipeline'
export type CookieOptions = Omit<SetOption, 'expires' | 'secureProxy' | 'signed' | 'secure'>

// 默认cookie选项
const defaultCookieOptions = {
  maxAge: 30 * oneMinute * 1000,
  httpOnly: true,
  overwrite: true,
} satisfies CookieOptions

// cookieSessionParser配置选项
export type CookieSessionParserOptions = {
  sessionIdKey?: string
  customCodec?: {
    encode: (plainSessionId: string) => string
    decode: (encodedSessionId: string) => string
  }
  cookieOptions?: CookieOptions
}

// Context for session metadata communication between parser and store
export const sessionMetaDataCtx = createContext<{
  sessionId: string
  expiresTime: number
} | undefined>(undefined)

export const cookieSessionParser = (
  cookieSessionOptions?: CookieSessionParserOptions,
): AuthParser<string> => {
  const options = {
    sessionIdKey: 'sess:k',
    cookieOptions: defaultCookieOptions,
    ...cookieSessionOptions,
  }
  
  return {
    async get(requestInfo) {
      const encodedSessionId = requestInfo.cookies?.[options.sessionIdKey]
      if (!encodedSessionId) {
        return null
      }
      
      // Decode using custom codec or base64 by default
      const decodedSessionId = options.customCodec
        ? options.customCodec.decode(encodedSessionId)
        : Buffer.from(encodedSessionId, 'base64').toString('utf8')
      
      return decodedSessionId
    },
    
    async set() {
      // Get session metadata from context (set by store.create or store.get)
      const sessionMeta = sessionMetaDataCtx.get()
      // If not exist sessionMeta, return Response without any modification
      if (!sessionMeta) {
        return Response
      }
      
      // If exist sessionMeta, encode using custom codec or base64 
      const encodedSessionId = options.customCodec
        ? options.customCodec.encode(sessionMeta.sessionId)
        : Buffer.from(sessionMeta.sessionId).toString('base64')
      
      // Set cookie with proper expiration time
      const cookieOptions = {
        ...options.cookieOptions,
        expires: new Date(sessionMeta.expiresTime),
      } satisfies SetOption
      
      return Response.cookie(options.sessionIdKey, encodedSessionId, cookieOptions)
    },
    
    async remove() {
      // Use expires instead of maxAge for better compatibility
      return Response.cookie(options.sessionIdKey, '', { 
        ...options.cookieOptions, 
        expires: new Date(0), // Expire immediately
        maxAge: 0 
      })
    },
  }
}


export type CookieSessionStoreOptions<UserData> = {
  /**
   * 用于加密的密钥，必须提供
   * 建议使用环境变量存储
   * 例如：process.env.SESSION_SECRET
   */
  secret: string
  sessionStoreKey?: string
  dataCreator?: (request: RequestInfo, sessionData?: UserData) => UserData
  /**
   * rolling: 每次请求都重置过期时间
   * 适合需要"保持活跃"的场景，如在线编辑器、管理后台
   */
  rolling?: boolean
  /**
   * renew: 只在临近过期时才更新过期时间
   * 需要配合 renewBefore 使用，性能更好
   * 适合平衡安全性和用户体验的场景，如银行系统、企业应用
   */
  renew?: boolean
  /**
   * renewBefore: 提前多久开始续期（毫秒）
   * 例如：设置为 10分钟，则在过期前10分钟内的请求会触发续期
   * 仅在 renew 为 true 时生效
   */
  renewBefore?: number
  cookieOptions?: CookieOptions
}

// 将sessionId转换为iv
export function idToIv(sessionId: string) {
  return createHash('sha256').update(sessionId).digest().slice(0, 16)
}
// cookieSessionStore
export const cookieSessionStore = <UserData>(
  cookieSessionStoreOptions: CookieSessionStoreOptions<UserData>,
): AuthStore<UserData, string> => {
  // secret 是必需的
  if (!cookieSessionStoreOptions.secret) {
    throw new Error('Secret is required for cookieSessionStore. Please provide a secret key for encryption.')
  }
  
  const options = {
    sessionStoreKey: 'sess:data',
    cookieOptions: defaultCookieOptions,
    rolling: false,
    renew: false,
    renewBefore: 10 * oneMinute * 1000, // 默认10分钟
    ...cookieSessionStoreOptions,
  }
  
  // 验证配置：rolling 和 renew 不能同时为 true
  if (options.rolling && options.renew) {
    throw new Error('Cannot use both rolling and renew modes at the same time')
  }
  
  // 使用 secret 生成加密密钥
  const key = createHash('sha256').update(options.secret).digest()
  
  //创建加密器
  const createCipher = (sessionId: string) => {
    try {
      //使用aes-256-cbc加密，key为sessionStoreKey的sha256，iv为sessionId的sha256的前16位
      const cipher = createCipheriv('aes-256-cbc', key, idToIv(sessionId))
      return cipher
    } catch (err) {
      const error = err as Error
      throw new Error(`Failed to create cipher: ${error.message}`)
    }
  }
  
  const createDecipher = (sessionId: string) => {
    const decipher = createDecipheriv('aes-256-cbc', key, idToIv(sessionId))
    return decipher
  }
  
  const maxAge = options.cookieOptions.maxAge || (30 * oneMinute * 1000)
  return {
    autoCreateOnMissing: true,
    async create(userData?: UserData) {
      // Generate new sessionId
      const sessionId = ulid()
      
      const expiresTime = Date.now() + maxAge
      
      // Set session metadata in context for parser to use
      const sessionMeta = {
        sessionId,
        expiresTime
      }
      sessionMetaDataCtx.set(sessionMeta)
      
      // Store initial data with the sessionId
      const initialData = options.dataCreator 
        ? options.dataCreator(useRequestInfo(), userData)
        : (userData || ({} as UserData))
      
      // Encrypt and store the initial data
      const cipher = createCipher(sessionId)
      const dataToStore = { _data: initialData, _expires: expiresTime }
      
      let encrypted = cipher.update(
        JSON.stringify(dataToStore),
        'utf8',
        'base64',
      )
      encrypted += cipher.final('base64')
      
      const cookieOptions = {
        ...options.cookieOptions,
        maxAge: maxAge,
      }

      authHeaderCtx.set([
        ...authHeaderCtx.get(),
        Response.cookie(options.sessionStoreKey, encrypted, cookieOptions),
      ])
      
      return initialData
    },
    async get(sessionId: string) {
      const requestInfo = useRequestInfo()
      const sessionData = requestInfo.cookies?.[options.sessionStoreKey]
      
      if (sessionData === undefined) {
        return null
      }
      
      let decryptedData: any
      
      // 1. 尝试解密
      try {
        const decipher = createDecipher(sessionId)
        let decrypted = decipher.update(sessionData, 'base64', 'utf8')
        decrypted += decipher.final('utf8')
        decryptedData = JSON.parse(decrypted)
      } catch (error) {
        // 解密失败：可能是 sessionId 不匹配或数据损坏
        // 清除无效的 cookie
        authHeaderCtx.set([
          ...authHeaderCtx.get(),
          Response.cookie(options.sessionStoreKey, '', { 
            ...options.cookieOptions, 
            expires: new Date(0),
            maxAge: 0 
          }),
        ])
        return null  // 返回 null 表示 session 不存在
      }
      
      // 2. 处理解密后的数据
      try {
        const now = Date.now()
        if (decryptedData._expires && decryptedData._expires < now) {
          return null
        }

        let newExpiresTime = decryptedData._expires
        
        // Rolling 模式：每次请求都更新过期时间
        if (options.rolling) {
          newExpiresTime = now + maxAge
        } 
        // Renew 模式：只在临近过期时更新
        else if (options.renew) {
          const timeLeft = decryptedData._expires - now
          // 如果剩余时间小于 renewBefore 阈值，则更新
          if (timeLeft < options.renewBefore) {
            newExpiresTime = now + maxAge
          }
        }

        // Store session metadata in context for parser to use
        const sessionMeta = {
          sessionId,
          expiresTime: newExpiresTime
        }
        sessionMetaDataCtx.set(sessionMeta)
        
        // Return the stored user data
        return decryptedData._data as UserData
      } catch (error) {
        return undefined
      }
    },
    async set(sessionData: UserData) {
      try {
        // Get session metadata from context (should be set by auth flow)
        const sessionMeta = sessionMetaDataCtx.get()
        if (!sessionMeta) {
          return false
        }
        
        const cipher = createCipher(sessionMeta.sessionId)
        
        // Calculate new expiration time based on mode
        let expiresTime = sessionMeta.expiresTime
        
        // Rolling 模式：总是更新
        if (options.rolling) {
          expiresTime = Date.now() + maxAge
        } 
        // Renew 模式：检查是否需要更新
        else if (options.renew) {
          const now = Date.now()
          const timeLeft = sessionMeta.expiresTime - now
          if (timeLeft < options.renewBefore) {
            expiresTime = now + maxAge
          }
        }
        // 默认模式：保持原有过期时间
        
        // Update session metadata context with new expiration time
        const updatedSessionMeta = {
          ...sessionMeta,
          expiresTime
        }
        sessionMetaDataCtx.set(updatedSessionMeta)
        
        // 统一存储格式：始终使用 _data 字段
        const dataToStore = { _data: sessionData, _expires: expiresTime }
        
        let encrypted = cipher.update(
          JSON.stringify(dataToStore),
          'utf8',
          'base64',
        )
        encrypted += cipher.final('base64')
        
        const cookieOptions = {
          ...options.cookieOptions,
          maxAge: maxAge,
        }

        authHeaderCtx.set([
          ...authHeaderCtx.get(),
          Response.cookie(options.sessionStoreKey, encrypted, cookieOptions),
        ])
        return true
      } catch (error) {
        return undefined
      }
    },
    async destroy() {
      try {
        authHeaderCtx.set([
          ...authHeaderCtx.get(),
          Response.cookie(options.sessionStoreKey, '', { 
            ...options.cookieOptions, 
            expires: new Date(0),
            maxAge: 0 
          }),
        ])
        sessionMetaDataCtx.set(undefined)
        return true
      } catch (error) {
        return undefined
      }
    },
  }
}
