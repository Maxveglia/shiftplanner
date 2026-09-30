import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { WorkspaceProvider } from './auth/WorkspaceContext';
import { AdminAuthProvider } from './backoffice/AdminAuthContext';
import { LanguageProvider } from './lib/i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Outermost of the three: the login screen has to be readable before
            there is a session to read a preference from. */}
        <LanguageProvider>
          {/* Two independent sessions, deliberately side by side: a manager
              signing in must not end the operator's session, or the reverse. */}
          <AuthProvider>
            {/* Which apps the signed-in business has: read by the router
                itself, so it sits above <App />. */}
            <WorkspaceProvider>
              <AdminAuthProvider>
                <App />
              </AdminAuthProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
