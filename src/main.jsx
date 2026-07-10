import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import AppRouter from './app/AppRouter';
import BoletaDraftAutosave from './BoletaDraftAutosave';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BoletaDraftAutosave />
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);