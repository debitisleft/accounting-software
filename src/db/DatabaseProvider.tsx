import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { createBrowserDatabase } from './browser-connection'
import { seedDefaultAccounts } from './seed'
import type { AppDatabase } from './connection'

interface DatabaseContextValue {
  db: AppDatabase | null
  isLoading: boolean
  error: string | null
  /** Bump this to trigger UI re-renders after mutations */
  version: number
  refresh: () => void
}

const DatabaseContext = createContext<DatabaseContextValue>({
  db: null,
  isLoading: true,
  error: null,
  version: 0,
  refresh: () => {},
})

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<AppDatabase | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    createBrowserDatabase()
      .then(({ db: browserDb }) => {
        seedDefaultAccounts(browserDb as AppDatabase)
        setDb(browserDb as AppDatabase)
        setIsLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setIsLoading(false)
      })
  }, [])

  const refresh = () => setVersion((v) => v + 1)

  return (
    <DatabaseContext.Provider value={{ db, isLoading, error, version, refresh }}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabase(): DatabaseContextValue {
  return useContext(DatabaseContext)
}
