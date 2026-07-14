import { forbidden } from './errors.js';
import { asBool } from './utils.js';
import { login, authenticate, logout, changePassword } from '../services/auth.service.js';
import { safeUser } from '../services/permissions.service.js';
import { rewriteTechnicalReport } from '../services/gemini.service.js';
import { usersHandlers } from '../modules/users.module.js';
import { crudHandlers } from '../modules/crud.module.js';
import { ticketHandlers } from '../modules/tickets.module.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';
import { knowledgeHandlers } from '../modules/knowledge.module.js';
import { getConfig } from '../modules/config.module.js';

const c = Object.fromEntries(Object.keys({clients:1,clientLocations:1,equipmentLocations:1,contacts:1,categories:1,deviceTypes:1,manufacturers:1,models:1,failureTypes:1,deviceManufacturers:1,knowledgeCategories:1}).map((key)=>[key,crudHandlers(key)]));
const routes = new Map();
function add(names, handler, permission = null, publicRoute = false) { for (const name of Array.isArray(names)?names:[names]) routes.set(name,{handler,permission,publicRoute}); }

add('auth.login', async (ctx)=>login(ctx.payload.username||ctx.payload.nombreUsuario||ctx.payload.email,ctx.payload.password,{ip:ctx.ip,userAgent:ctx.userAgent}),null,true);
add('auth.me', async (ctx)=>({user:safeUser(ctx.user),permissions:ctx.permissions,mustChangePassword:asBool(ctx.user.CambioPasswordObligatorio,false)}));
add('auth.logout', async (ctx)=>logout(ctx.sessionToken));
add(['auth.changePassword','auth.change-password'], async (ctx)=>changePassword(ctx.user,ctx.payload.currentPassword||ctx.payload.passwordActual,ctx.payload.newPassword||ctx.payload.nuevaPassword));
add('users.list',usersHandlers.list,'USUARIOS_VER');
add('users.assignment.list',usersHandlers.assignable,['BOLETAS_CREAR','BOLETAS_EDITAR','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','MANTENIMIENTOS_VER']);
add('users.get',usersHandlers.get,'USUARIOS_VER'); add('users.create',usersHandlers.create,'USUARIOS_GESTIONAR'); add('users.update',usersHandlers.update,'USUARIOS_GESTIONAR'); add('roles.list',usersHandlers.roles,'USUARIOS_VER');
add(['config.get','app.config.get'],getConfig);
add(['ai.technicalRewrite','gemini.technicalRewrite','boletas.ai.rewrite'], async (ctx)=>rewriteTechnicalReport(ctx.payload), ['BOLETAS_CREAR','BOLETAS_EDITAR','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR']);

const operationalCatalogPermissions = ['BOLETAS_CREAR','BOLETAS_EDITAR','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR'];
const operationalClientDataPermissions = [
  'CLIENTES_DATOS_OPERATIVOS_CREAR',
  'CLIENTES_EDITAR',
  'BOLETAS_CREAR',
  'BOLETAS_EDITAR',
  'MANTENIMIENTOS_CREAR',
  'MANTENIMIENTOS_EDITAR',
  'MANTENIMIENTOS_GESTIONAR',
];
const clientOperationalKeys = new Set(['clientLocations','equipmentLocations','contacts']);

const crudRouteGroups = [
  ['clients',['clients','clientes']],['clientLocations',['clientLocations','clients.locations','clientes.ubicaciones','ubicacionesCliente']],['equipmentLocations',['equipmentLocations','clients.equipmentLocations','clientes.ubicacionesEquipo','ubicacionesEquipo']],['contacts',['contacts','clients.contacts','clientes.contactos','contactosCliente']],
  ['categories',['catalog.categories','categories','categorias','catalog.operational.categories']],['deviceTypes',['catalog.deviceTypes','deviceTypes','tiposDispositivo','catalog.operational.deviceTypes']],['manufacturers',['catalog.manufacturers','manufacturers','fabricantes','catalog.operational.manufacturers']],['models',['catalog.models','models','modelos','catalog.operational.models']],['failureTypes',['catalog.failureTypes','failureTypes','tiposFalla','catalog.operational.failureTypes']],['deviceManufacturers',['catalog.deviceManufacturers','deviceManufacturers','tipoDispositivoFabricantes','catalog.operational.deviceManufacturers']],['knowledgeCategories',['knowledge.categories','baseConocimientos.categorias','categoriasConocimiento']]
];
for(const [key,prefixes] of crudRouteGroups){for(const prefix of prefixes){
  const operational=prefix.includes('.operational.');
  let createPermission='CATALOGOS_GESTIONAR';
  if(operational) createPermission=operationalCatalogPermissions;
  else if(key==='clients') createPermission='CLIENTES_CREAR';
  else if(clientOperationalKeys.has(key)) createPermission=operationalClientDataPermissions;
  add(`${prefix}.list`,c[key].list);add(`${prefix}.get`,c[key].get);add(`${prefix}.create`,c[key].create,createPermission);add(`${prefix}.update`,c[key].update,createPermission);
}}

const ticketAliases={list:['boletas.list','tickets.list'],get:['boletas.get','tickets.get'],create:['boletas.create','tickets.create'],update:['boletas.update','tickets.update'],autosave:['boletas.autosave'],finalize:['boletas.finalize','tickets.finalize'],testFinalize:['boletas.testFinalize','tickets.testFinalize'],generatePdf:['boletas.generatePdf','tickets.generatePdf'],returnPending:['boletas.returnPending'],annul:['boletas.annul'],evidenceUpload:['boletas.evidence.upload','tickets.evidence.upload'],evidenceUpdate:['boletas.evidence.update','tickets.evidence.update'],evidenceDelete:['boletas.evidence.delete','tickets.evidence.delete'],mediaGet:['boletas.media.get','tickets.media.get'],signatureUpload:['boletas.signature.upload']};
for(const [key,names] of Object.entries(ticketAliases)) {
  let permission='BOLETAS_EDITAR';
  if(['list','get','mediaGet'].includes(key)) permission='BOLETAS_VER';
  else if(key==='create') permission='BOLETAS_CREAR';
  else if(key==='finalize') permission='BOLETAS_FINALIZAR';
  else if(['evidenceUpload','evidenceUpdate','evidenceDelete'].includes(key)) permission=['BOLETAS_EVIDENCIAS','BOLETAS_EDITAR'];
  add(names,ticketHandlers[key],permission);
}

const maintenanceAliases={list:['maintenance.list','mantenimientos.list'],get:['maintenance.get','mantenimientos.get'],create:['maintenance.create','mantenimientos.create'],update:['maintenance.update','mantenimientos.update'],delete:['maintenance.delete','mantenimientos.delete'],finalize:['maintenance.finalize','mantenimientos.finalize'],reopen:['maintenance.reopen','mantenimientos.reopen'],deviceCreate:['maintenance.devices.create','mantenimientos.dispositivos.create'],deviceUpdate:['maintenance.devices.update','mantenimientos.dispositivos.update'],deviceDelete:['maintenance.devices.delete','mantenimientos.dispositivos.delete'],imageUpload:['maintenance.images.upload','mantenimientos.imagenes.upload'],imageUpdate:['maintenance.images.update','mantenimientos.imagenes.update'],imageDelete:['maintenance.images.delete','mantenimientos.imagenes.delete'],mediaGet:['maintenance.media.get','mantenimientos.media.get'],spreadsheetReport:['maintenance.report.spreadsheet','mantenimientos.reporte.excel'],slidesReport:['maintenance.report.slides','mantenimientos.reporte.presentacion'],config:['maintenance.config','mantenimientos.config']};
const maintenanceReadPermissions=['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER'];
const maintenanceCreatePermissions=['MANTENIMIENTOS_CREAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_CREAR'];
const maintenanceEditPermissions=['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR'];
const maintenanceFinalizePermissions=['MANTENIMIENTOS_FINALIZAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_FINALIZAR','BOLETAS_EDITAR'];
for(const [key,names] of Object.entries(maintenanceAliases)) {
  let permission=maintenanceEditPermissions;
  if(['list','get','mediaGet','config'].includes(key)) permission=maintenanceReadPermissions;
  else if(key==='create') permission=maintenanceCreatePermissions;
  else if(key==='finalize') permission=maintenanceFinalizePermissions;
  add(names,maintenanceHandlers[key],permission);
}

const knowledgeAliases={list:['knowledge.list','baseConocimientos.list','conocimiento.list','tutorials.list'],get:['knowledge.get','baseConocimientos.get','conocimiento.get','tutorials.get'],create:['knowledge.create','baseConocimientos.create','conocimiento.create','tutorials.create'],update:['knowledge.update','baseConocimientos.update','conocimiento.update','tutorials.update'],delete:['knowledge.delete','baseConocimientos.delete','conocimiento.delete','tutorials.delete'],attachmentUpload:['knowledge.attachments.upload','baseConocimientos.adjuntos.upload','conocimiento.adjuntos.upload'],attachmentDelete:['knowledge.attachments.delete','baseConocimientos.adjuntos.delete','conocimiento.adjuntos.delete'],mediaGet:['knowledge.media.get','baseConocimientos.media.get','conocimiento.media.get']};
for(const [key,names] of Object.entries(knowledgeAliases)) add(names,knowledgeHandlers[key]);

export async function dispatchAction({ route, payload={}, sessionToken='', ip='', userAgent='' }) {
  const entry=routes.get(route);
  if(!entry) { const error=new Error(`Ruta no encontrada: ${route}`); error.code='ROUTE_NOT_FOUND'; error.status=404; throw error; }
  let auth={user:null,permissions:[]}; if(!entry.publicRoute) auth=await authenticate(sessionToken);
  if(entry.permission){const required=Array.isArray(entry.permission)?entry.permission:[entry.permission];const allowed=required.some((code)=>auth.permissions.includes(code))||auth.permissions.includes('USUARIOS_GESTIONAR');if(!allowed)throw forbidden();}
  return entry.handler({route,payload,sessionToken,ip,userAgent,...auth});
}
