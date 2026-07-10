import React from 'react';
import { useLocation } from 'react-router-dom';
import AppShell from '../../app/layout/AppShell';
import BoletasApp from '../../Boletas';
import './boletas-stitch.css';

export default function BoletasModule(){
  const path=useLocation().pathname;
  const isForm=path.includes('/nueva')||path.includes('/editar');
  const isDetail=/^\/boletas\/[^/]+$/.test(path);
  const isFinished=path.includes('/finalizadas');
  const title=path.includes('/nueva')?'Crear Boleta':isFinished?'Boletas Finalizadas':path.includes('/editar')?'Editar Boleta':isDetail?'Detalle de Boleta':'Boletas Pendientes';
  const viewClass=isForm?'boletas-form-view':isDetail?'boletas-detail-view':isFinished?'boletas-list-view boletas-finished-view':'boletas-list-view boletas-pending-view';
  return <AppShell title={title}><div className={`legacy-module boletas-module ${viewClass}`}><BoletasApp/></div></AppShell>;
}
