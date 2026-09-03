import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ArchivisteApp from './ArchivisteApp.jsx'
import { ConversationsLayout } from './state/ConversationsProvider.jsx'

// /lab is loaded on demand: it drags in recharts and the whole
// src/components/lab folder, which no student page renders. A static import
// would put that chain in the graph the dev server (the server production
// actually serves) hands to every visitor of /archiviste and /chat.
//
// The lint exception: main.jsx is the entry point, it exports nothing and is
// never hot-reloaded as a component module — the rule only fires because
// `LabApp` reads as a component name here.
// eslint-disable-next-line react-refresh/only-export-components
const LabApp = lazy(() => import('./LabApp.jsx'))

// `#root` is in index.html — asserted rather than guarded, no runtime branch added.
createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* /lab stands alone — outside ConversationsProvider and any shell */}
        <Route
          path="/lab"
          element={
            // No spinner on purpose: /lab is a maintainer's page behind a login
            // popup, a flash between the click and the module would be noise.
            <Suspense fallback={null}>
              <LabApp />
            </Suspense>
          }
        />
        <Route element={<ConversationsLayout />}>
          <Route path="/" element={<Navigate to="/archiviste" replace />} />
          <Route path="/chat" element={<App />} />
          <Route path="/archiviste" element={<ArchivisteApp />} />
        </Route>
        {/* Anything else — a typo'd path, a dead link, /Chat with a capital —
            lands on the landing page instead of rendering nothing at all.
            Deliberately outside ConversationsLayout: an unmatched URL must not
            mount the conversation provider. */}
        <Route path="*" element={<Navigate to="/archiviste" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
