import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installDiagnostics } from './utils/diagnostics'

// Before render: even module-evaluation failures land in the console with the
// [CarbonCredit] prefix, and every uncaught error/rejection reaches the
// on-page banner (see components/ErrorBanner.jsx).
installDiagnostics()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)