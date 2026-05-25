import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/styles.css'
import { AuthProvider } from './contexts/AuthContext'
import { PersonSelectionProvider } from './contexts/PersonSelectionContext'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <PersonSelectionProvider>
        <App />
      </PersonSelectionProvider>
    </AuthProvider>
  </React.StrictMode>
)
