import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import App from './AppWithBoletas';
import BoletaDraftAutosave from './BoletaDraftAutosave';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BoletaDraftAutosave />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
