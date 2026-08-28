import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ArchivisteApp from './ArchivisteApp.jsx'
import LabApp from './LabApp.jsx'
import { ConversationsLayout } from './state/ConversationsProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* /lab stands alone — outside ConversationsProvider and any shell */}
        <Route path="/lab" element={<LabApp />} />
        <Route element={<ConversationsLayout />}>
          <Route path="/" element={<Navigate to="/archiviste" replace />} />
          <Route path="/chat" element={<App />} />
          <Route path="/archiviste" element={<ArchivisteApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
