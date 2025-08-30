import { MaybeAsyncResponse, RequestInfo, Response } from 'farrow-http'
import { Context, Middleware, createContext } from 'farrow-pipeline'

// SessionStore 和SessionParser之间应通过共同约定的SessionMetaDataCtx进行通信，SessionMetaDataCtx中存储如Cookie有效时间等，SessionParser根据SessionMetaDataCtx中的信息进行设置


export type SessionStore<UserData, Credit> = {
  /**
   * 传入userCredentials,如果该userCredentials存在且有效,则返回UserData
   * 如果不存在，返回null
   * 如果发生内部错误，返回undefined
   */
  get(userCredentials: Credit): Promise<UserData| null|undefined>
  /**
   * 设置如果成功，返回true，如果失败(如当前不存在凭证信息)，返回false，如果发生内部错误，返回undefined
   */
  set(userData: UserData): Promise< boolean | undefined>
  /**
   * 传入可选参数userData（用于更换ID），返回生成的authMetadata和userData
   * 如果失败(如用户凭证无效、数据库连接失败等),返回undefined
   */
  create(userData?: UserData): Promise<UserData | undefined >
  /**
   * 传入sessionId，如果成功，返回true，如果失败，返回false，如果发生内部错误，返回undefined
   * Input sessionId, if success, return true, if failed, return false, if internal error, return undefined
   *
   * @param authMetadata
   * @returns boolean | undefined
   */
  destroy(): Promise<boolean | undefined>
  /**
   * 可选方法：仅更新过期时间而不修改数据
   * 主要用于外部存储（Redis/DB）的性能优化
   * Cookie Store 通常不需要实现此方法
   * 使用 sessionMetaDataCtx 中的元数据
   * 
   * @returns true 成功 | false 失败 | undefined 内部错误
   */
  touch?(): Promise<boolean | undefined>
}

/**
 * SessionParser用于从RequestInfo中解析并返回userCredentials，或者根据authMetadata设置更新或删除userCredentials的Response
 * SessionParser is used to parse userCredentials from RequestInfo and return userCredentials, or according to authMetadata to update or delete userCredentials in Response
 */
export type SessionParser<Credit> = {
  /**
   * Get userCredentials from RequestInfo
   * userCredentials may contains sessionId, accessToken, refreshToken, etc.
   * @param request the Farrow RequestInfo
   * @returns userCredentials, if not exist/invalid, return null
   *
   */
  get(request: RequestInfo): Promise<Credit | null>
  set(): Promise<Response>
  remove(): Promise<Response>
}

export type SessionConfig<UserData, Credit> = {
  autoCreateOnMissing: boolean;
  sessionUserDataCtx: SessionUserDataCtx<UserData>
  autoSave: boolean
  sessionParser: SessionParser<Credit>
  sessionStore: SessionStore<UserData, Credit>
}
// 创建一个独立的 Context 来存储修改状态（请求级隔离）
const modifiedStateCtx = createContext<boolean>(false)

export type SessionUserDataCtx<D> = Context<D|undefined> & {
  saveToStore: () => Promise<boolean | undefined>
  regenerate: () => Promise<boolean | undefined>
  destroy: () => Promise<boolean | undefined>
  readonly isModified: boolean  // 只读，用户只能查看不能修改
}

export const createSessionCtx = <D>(defaultData: D): SessionUserDataCtx<D> => {
  const ctx = createContext<D|undefined>(defaultData)
  
  // 创建 Proxy 包装的 context
  const proxyCtx = new Proxy({
    ...ctx,
    isModified: false,
    saveToStore: async () => {
      throw new Error(
        'saveToStore is not implemented yet,You need pass the sessionUserDataCtx to the middleware to create it ',
      )
    },
    regenerate: async () => {
      throw new Error(
        'regenerate is not implemented yet,You need pass the sessionUserDataCtx function to the middleware to create it ',
      )
    },
    destroy: async () => {
      throw new Error(
        'destroy is not implemented yet,You need pass the sessionUserDataCtx function to the middleware to create it ',
      )
    },
  }, {
    get(target, prop) {
      if (prop === 'isModified') {
        // 从 Context 中获取修改状态
        return modifiedStateCtx.get()
      }
      if (prop === 'set') {
        // 拦截 set 方法，在 Context 中标记修改
        return (value: D | undefined) => {
          modifiedStateCtx.set(true)
          return ctx.set(value)
        }
      }
      if (prop === 'get') {
        // 返回原始的 get 方法
        return ctx.get
      }
      return target[prop as keyof typeof target]
    }
  }) as SessionUserDataCtx<D>
  
  return proxyCtx
}

export const sessionHeaderCtx = createContext<Response[]>([])

// 辅助类型：从配置中提取类型
export type InferUserData<T> = T extends SessionConfig<infer U, any> ? U : never
export type InferCredit<T> = T extends SessionConfig<any, infer C> ? C : never

// 改进的类型推导版本
export const createFarrowSession = <
  TUserData = any,
  TCredit = any,
  TConfig extends SessionConfig<TUserData, TCredit> = SessionConfig<TUserData, TCredit>
>(
  config: TConfig
): Middleware<RequestInfo, MaybeAsyncResponse> => {
  const { sessionParser, sessionStore, autoSave, sessionUserDataCtx } = config
  const middleware: Middleware<RequestInfo, MaybeAsyncResponse> = async (request, next) => {
    // 从RequestInfo中解析获取用户凭证,存在两种结果：1，用户凭证不存在/过期/解析失败；2，用户凭证存在
    const unverifiedUserCredentials = await sessionParser.get(request)
    
    const createNewAuth=async()=>{
      const createResult = await sessionStore.create()
      if (!createResult) return Response.json({ error: 'Internal Server Error' }).status(500)
      sessionUserDataCtx.set(createResult)
      const sessionHeader = await sessionParser.set()
      sessionHeaderCtx.set([...sessionHeaderCtx.get(), sessionHeader])
      return null // 成功时返回 null
    }
    
    // 如果userCredentials不存在
    if (!unverifiedUserCredentials) {
      // 根据需求判断是否创建，如Session需要创建，而JWT不需要创建
      // 清除旧userCredentials
      const sessionHeader=await sessionParser.remove()
      sessionHeaderCtx.set([...sessionHeaderCtx.get(), sessionHeader])
      // 如果需要创建，创建新的userCredentials
      if (config.autoCreateOnMissing) {
        const errorResponse = await createNewAuth()
        if (errorResponse) return errorResponse // 如果创建失败，返回错误响应
      }
    } else {
      
      // 如果userCredentials存在,则验证userCredentials
      const getUserDataResult = await sessionStore.get(unverifiedUserCredentials)
      
      // 如果结果为undefined，表示内部错误，返回500错误
      if (getUserDataResult === undefined) return Response.json({ error: 'Internal Server Error' }).status(500)
      
        // 如果结果为null，表示session无效，创建新的session
      if (getUserDataResult === null) {
        const errorResponse = await createNewAuth()
        if (errorResponse) return errorResponse

      } else {
        // 如果结果存在，代表userCredrential有效,存在userData设置sessionUserData
        const sessionUserData = getUserDataResult
        sessionUserDataCtx.set(sessionUserData)
      }
    }
    
    // 初始数据加载完成后，重置修改状态为 false
    modifiedStateCtx.set(false)
    
    const response = await next()
    
    // 如果自动保存
    if (autoSave) {
      const sessionUserData = sessionUserDataCtx.get()
      
      // 只在数据存在且被修改时才保存
      if (sessionUserData !== undefined && sessionUserDataCtx.isModified) {
        const setResult = await sessionStore.set(sessionUserData)
        if (setResult === undefined) return Response.json({ error: 'Internal Server Error' }).status(500)
        if (setResult === false) return Response.json({ error: 'SessionStore Set Failed' }).status(401)
      }
      // 如果数据没被修改但需要更新过期时间（rolling/renew 模式）
      else if (sessionUserData !== undefined && !sessionUserDataCtx.isModified) {
        // 优先使用 touch 方法（如果存在）
        if (sessionStore.touch) {
          const touchResult = await sessionStore.touch()
          if (touchResult === undefined) return Response.json({ error: 'Internal Server Error' }).status(500)
          if (touchResult === false) return Response.json({ error: 'Session Touch Failed' }).status(401)
        } else {
          // 如果没有 touch 方法，退回到使用 set
          const setResult = await sessionStore.set(sessionUserData)
          if (setResult === undefined) return Response.json({ error: 'Internal Server Error' }).status(500)
          if (setResult === false) return Response.json({ error: 'SessionStore Set Failed' }).status(401)
        }
      }
    }
    const sessionHeaders = sessionHeaderCtx.get()
    return Response.merge(...sessionHeaders).merge(response)
  }
    // 定义session相关方法
    //
    sessionUserDataCtx.regenerate = async () => {
      //获取当前的userData
      const userData = sessionUserDataCtx.get()
      //如果userData不存在，返回false
      if (userData === undefined) return false
      //创建新的信息
      const createResult = await sessionStore.create(userData)
      //如果创建失败，返回undefined
      if (createResult===undefined ) return undefined
      // 如果创建成功，设置sessionHeader
      const sessionHeader = await sessionParser.set()
      sessionHeaderCtx.set([...sessionHeaderCtx.get(), sessionHeader])
      return true
    }
    
    sessionUserDataCtx.destroy = async () => {
      const sessionUserData = sessionUserDataCtx.get()
      // 如果sessionUserData不存在，返回false
      if (sessionUserData === undefined) return false
      // 如果sessionUserData存在，调用Store销毁
      const destroyResult = await sessionStore.destroy()
      // 如果销毁失败，返回false或者undefined，直接返回false或者undefined
      if (!destroyResult) return destroyResult
      // 如果销毁成功，设置sessionUserDataCtx为undefined
      sessionUserDataCtx.set(undefined)
      // 如果销毁成功，设置相应header
      const sessionHeader = await sessionParser.remove()
      sessionHeaderCtx.set([...sessionHeaderCtx.get(), sessionHeader])
      return true
    }

    sessionUserDataCtx.saveToStore = async () => {
      const sessionUserData = sessionUserDataCtx.get()
      // 如果sessionUserData不存在，返回false
      if (sessionUserData === undefined) return false
      
      // 根据修改状态决定调用 set 还是 touch
      if (sessionUserDataCtx.isModified) {
        // 数据被修改，需要完整保存
        const setResult = await sessionStore.set(sessionUserData)
        return setResult || false
      } else {
        // 数据未修改，尝试使用 touch 更新过期时间
        if (sessionStore.touch) {
          const touchResult = await sessionStore.touch()
          return touchResult || false
        } else {
          // 没有 touch 方法，退回到 set
          const setResult = await sessionStore.set(sessionUserData)
          return setResult || false
        }
      }
    }
  return middleware
}
export const createSession = createFarrowSession
