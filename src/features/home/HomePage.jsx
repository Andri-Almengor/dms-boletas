import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../../AuthContext';
import {apiRequest} from '../../api';
import AppShell from '../../app/layout/AppShell';
import Icon from '../../components/ui/Icon';
import './home.css';

export default function HomePage(){
 const {user,sessionToken,hasPermission}=useAuth(); const [pending,setPending]=useState([]); const [finished,setFinished]=useState([]);
 const admin=hasPermission('BOLETAS_ELIMINAR');
 useEffect(()=>{if(!hasPermission('BOLETAS_VER'))return; const base={page:1,pageSize:50,sortBy:'Fecha',sortDir:'desc',...(admin?{}:{asignadoUsuarioId:user.UsuarioID})}; Promise.all([apiRequest('boletas.list',{...base,estado:'PENDIENTE'},sessionToken),apiRequest('boletas.list',{...base,estado:'FINALIZADO'},sessionToken)]).then(([p,f])=>{setPending(p.items||[]);setFinished(f.items||[])}).catch(()=>{});},[sessionToken,user?.UsuarioID]);
 const role=hasPermission('USUARIOS_GESTIONAR')?'Administrador':'Técnico de Campo';
 return <AppShell><main className="page home-page"><section className="welcome"><span className="eyebrow">Bienvenido</span><h2 className="title">Hola, {user?.NombreCompleto}</h2><div className="row muted"><Icon>engineering</Icon><span>{role}</span></div></section>
 <section className="home-stats"><Link to="/boletas/pendientes" className="stat-card stat-card--pending"><Icon>pending_actions</Icon><strong>{pending.length}</strong><span>Boletas pendientes</span></Link><Link to="/boletas/finalizadas" className="stat-card stat-card--finished"><Icon>task_alt</Icon><strong>{finished.length}</strong><span>Boletas finalizadas</span></Link></section>
 {hasPermission('BOLETAS_CREAR')&&<Link className="create-cta" to="/boletas/nueva"><Icon>add_circle</Icon><span>Crear Nueva Boleta</span></Link>}
 <section className="stack"><div className="row home-section-head"><h3 className="section-title">Últimas boletas asignadas</h3><Link to="/boletas/pendientes">Ver todas</Link></div>{pending.slice(0,3).map(b=><Link className="recent-card" key={b.BoletaUID} to={`/boletas/${b.BoletaUID}`}><div><h4>{b.Titulo}</h4><p>Cliente: {b.Cliente}</p></div><span className="status status-pending">Pendiente</span><footer><span><Icon>schedule</Icon>{b.Fecha?new Date(b.Fecha).toLocaleDateString():''}</span><span><Icon>location_on</Icon>{b.Ubicacion||'Sin ubicación'}</span></footer></Link>)}{!pending.length&&<div className="card empty">No hay boletas pendientes.</div>}</section>
 </main></AppShell>;
}