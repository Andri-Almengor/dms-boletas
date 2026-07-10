import React from 'react';
import {Navigate,Route,Routes,useLocation} from 'react-router-dom';
import {useAuth} from '../AuthContext';
import LoginPage from '../features/auth/LoginPage';
import HomePage from '../features/home/HomePage';
import MorePage from '../features/more/MorePage';
import AppShell from './layout/AppShell';
import LegacyApp from '../App2';
import BoletasApp from '../Boletas';
import CatalogosApp from '../Catalogos';
import './legacy-modules.css';

function Protected({children}){const {user,loading}=useAuth();if(loading)return <main className="page"><div className="card">Cargando...</div></main>;return user?children:<Navigate to="/login" replace/>}
function LegacyModule(){return <AppShell><div className="legacy-module"><LegacyApp/></div></AppShell>}
function BoletasModule(){const p=useLocation().pathname;const title=p.includes('nueva')?'Crear Boleta':p.includes('finalizadas')?'Boletas Finalizadas':p.match(/\/boletas\/[^/]+$/)?'Detalle de Boleta':'Boletas Pendientes';return <AppShell title={title}><div className="legacy-module boletas-module"><BoletasApp/></div></AppShell>}
function CatalogosModule(){return <AppShell title="Catálogos"><div className="legacy-module catalogos-module"><CatalogosApp/></div></AppShell>}

export default function AppRouter(){return <Routes>
 <Route path="/login" element={<LoginPage/>}/>
 <Route path="/" element={<Protected><HomePage/></Protected>}/>
 <Route path="/mas" element={<Protected><MorePage/></Protected>}/>
 <Route path="/boletas/*" element={<Protected><BoletasModule/></Protected>}/>
 <Route path="/catalogos/*" element={<Protected><CatalogosModule/></Protected>}/>
 <Route path="/usuarios/*" element={<Protected><LegacyModule/></Protected>}/>
 <Route path="/clientes/*" element={<Protected><LegacyModule/></Protected>}/>
 <Route path="/cambiar-contrasena" element={<Protected><LegacyModule/></Protected>}/>
 <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>}
