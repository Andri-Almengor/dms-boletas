import React from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {useAuth} from '../../AuthContext';
import AppShell from '../../app/layout/AppShell';
import Icon from '../../components/ui/Icon';
import './more.css';

export default function MorePage(){const {user,logout,hasPermission}=useAuth();const navigate=useNavigate();const role=hasPermission('USUARIOS_GESTIONAR')?'Administrador':'Técnico de Campo';async function exit(){await logout();navigate('/login',{replace:true})}
 const links=[hasPermission('CLIENTES_VER')&&['/clientes','groups','Clientes'],hasPermission('USUARIOS_VER')&&['/usuarios','person_search','Usuarios'],hasPermission('CATALOGOS_GESTIONAR')&&['/catalogos','inventory_2','Catálogos'],['/cambiar-contrasena','lock_reset','Cambiar contraseña']].filter(Boolean);
 return <AppShell><main className="page page--narrow more-page"><section className="profile-card"><div className="profile-avatar">{(user?.NombreCompleto||'D')[0]}</div><div><h2>{user?.NombreCompleto}</h2><p>{role}</p><span>{user?.NombreUsuario}</span></div></section><span className="eyebrow">Administración</span><nav className="more-menu">{links.map(([to,icon,label])=><Link key={to} to={to}><span className="menu-icon"><Icon>{icon}</Icon></span><span>{label}</span><Icon>chevron_right</Icon></Link>)}</nav><span className="eyebrow">Sesión</span><button className="logout-card" onClick={exit}><span className="menu-icon"><Icon>logout</Icon></span><span>Cerrar sesión</span></button><footer>DMS Boletas v2.1</footer></main></AppShell>}
