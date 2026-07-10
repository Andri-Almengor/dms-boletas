import React from 'react';
import { useLocation } from 'react-router-dom';
import AppShell from '../../app/layout/AppShell';
import BoletasApp from '../../Boletas';

export default function BoletasModule(){
  const path=useLocation().pathname;
  const title=path.includes('/nueva')?'Crear Boleta':path.includes('/finalizadas')?'Boletas Finalizadas':path.includes('/editar')?'Editar Boleta':/^\/boletas\/[^/]+$/.test(path)?'Detalle de Boleta':'Boletas Pendientes';
  return <AppShell title={title}><div className="legacy-module boletas-module"><BoletasApp/></div></AppShell>;
}