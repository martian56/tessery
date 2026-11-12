import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import '@xyflow/react/dist/style.css'
import '@/styles/global.css'
import { store } from '@/store'
import { DialogProvider, Toaster, TooltipProvider } from '@/ui'
import { App } from '@/app/App'

function boot() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Provider store={store}>
        <TooltipProvider>
          <DialogProvider>
            <App />
            <Toaster />
          </DialogProvider>
        </TooltipProvider>
      </Provider>
    </StrictMode>,
  )
}
boot()
