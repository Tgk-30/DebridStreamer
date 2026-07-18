import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './theme.config.ts'

// compile theme.config → CSS custom properties before first paint
initTheme()

createRoot(document.getElementById('root')!).render(<App />)
