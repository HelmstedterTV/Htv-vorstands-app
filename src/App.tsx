import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { UnreadProvider } from './context/UnreadContext'
import LoginPage from './pages/LoginPage'
import AppShell from './components/Layout/AppShell'
import ChatPage from './pages/ChatPage'
import TodosPage from './pages/TodosPage'
import KalenderPage from './pages/KalenderPage'
import AdminPage from './pages/AdminPage'
import ProfilPage from './pages/ProfilPage'
import SitzungPage from './pages/SitzungPage'
import ProtokolePage from './pages/ProtokolePage'
import ZaehlerPage from './pages/ZaehlerPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth()
  if (!currentUser) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth()
  if (currentUser) return <Navigate to="/chat" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/chat" replace />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="todos" element={<TodosPage />} />
        <Route path="kalender" element={<KalenderPage />} />
        <Route path="sitzungen" element={<SitzungPage />} />
        <Route path="protokolle" element={<ProtokolePage />} />
        <Route path="zaehler" element={<ZaehlerPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="profil" element={<ProfilPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <UnreadProvider>
          <AppRoutes />
        </UnreadProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
