import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ArchivisteApp from './ArchivisteApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/archiviste" replace />} />
        <Route path="/chat" element={<App />} />
        <Route path="/archiviste" element={<ArchivisteApp />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
