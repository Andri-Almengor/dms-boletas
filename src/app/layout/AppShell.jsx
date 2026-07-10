import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/ui/Icon';
import './app-shell.css';

const item = (to, icon, label, end=false) => ({to,icon,label,end});

export default function AppShell({ children, title='DMS Boletas', backTo='' }) {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = [item('/','home','Inicio',true), item('/boletas/pendientes','pending_actions','Pendientes'), item('/boletas/nueva','add_circle','Crear'), item('/boletas/finalizadas','task_alt','Finalizadas'), item('/mas','more_horiz','Más')];
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar__left">
        {backTo ? <button className="icon-btn" onClick={()=>navigate(backTo)} aria-label="Volver"><Icon>arrow_back</Icon></button> : <span className="brand-icon"><Icon>description</Icon></span>}
        <h1>{title}</h1>
      </div>
      <div className="avatar" title={user?.NombreCompleto}>{(user?.NombreCompleto || 'D').slice(0,1).toUpperCase()}</div>
    </header>
    <div className="shell-content">{children}</div>
    {user && <nav className="bottom-nav">
      {nav.map((n)=> {
        if (n.to==='/boletas/nueva' && !hasPermission('BOLETAS_CREAR')) return null;
        return <NavLink key={n.to} to={n.to} end={n.end} className={({isActive})=>`bottom-nav__item ${isActive?'is-active':''} ${n.to==='/boletas/nueva'?'is-create':''}`}>
          <Icon filled={location.pathname===n.to}>{n.icon}</Icon><span>{n.label}</span>
        </NavLink>;
      })}
    </nav>}
  </div>;
}