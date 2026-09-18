function clean(value,max=500){return String(value??'').trim().slice(0,max);}

const SECTIONS=Object.freeze([
  {match:/^\/$/,name:'Inicio',description:'Resumen operativo de DMS Boletas con información útil según el usuario y sus permisos.'},
  {match:/^\/boletas\/pendientes/,name:'Boletas pendientes',description:'Listado de boletas pendientes que el usuario tiene permiso de consultar. Permite buscar, filtrar y abrir el detalle.'},
  {match:/^\/boletas\/finalizadas/,name:'Boletas finalizadas',description:'Historial de boletas finalizadas visibles para el usuario, con búsqueda, filtros y acceso al detalle.'},
  {match:/^\/boletas\/[^/]+/,name:'Detalle de boleta',description:'Detalle operativo de una boleta: cliente, fechas, trabajo, técnicos, evidencias, firma, relaciones y demás información registrada.'},
  {match:/^\/mantenimientos\/[^/]+/,name:'Detalle de mantenimiento',description:'Detalle de un mantenimiento con cliente, responsables, dispositivos, estados, observaciones, evidencias y resultados asociados.'},
  {match:/^\/mantenimientos/,name:'Mantenimientos',description:'Consulta y gestión de mantenimientos según los permisos del usuario.'},
  {match:/^\/clientes/,name:'Clientes',description:'Información de clientes, ubicaciones y contactos autorizados.'},
  {match:/^\/agenda/,name:'Agenda',description:'Agenda de visitas y trabajos. Técnicos visualizan sus asignaciones y los administradores gestionan el alcance permitido.'},
  {match:/^\/conocimiento/,name:'Base de conocimiento',description:'Tutoriales y procedimientos internos de DMS. Los artículos publicados son la primera fuente para resolver problemas técnicos internos.'},
  {match:/^\/casos/,name:'Casos de clientes',description:'Gestión administrativa de solicitudes y casos de clientes, sus evidencias, técnicos y boletas relacionadas.'},
  {match:/^\/metricas/,name:'Métricas',description:'Panel administrativo de métricas operativas de boletas y mantenimientos.'},
  {match:/^\/usuarios/,name:'Usuarios',description:'Administración de usuarios y permisos para perfiles autorizados.'},
  {match:/^\/credenciales/,name:'Credenciales',description:'Gestor protegido de credenciales de clientes. El agente IA no revela ni consulta contraseñas o secretos de esta sección.'},
  {match:/^\/asistente/,name:'Asistente DMS',description:'Interfaz conversacional de solo lectura que usa Gemini y tools del backend para consultar datos autorizados de DMS.'},
  {match:/^\/mas/,name:'Más',description:'Accesos secundarios y funciones adicionales de la aplicación según permisos.'},
]);

export async function getAppHelp(_ctx,args={}){
  const route=clean(args.route||'',500);
  const section=clean(args.section||'',200).toLowerCase();
  const found=SECTIONS.find(item=>route&&item.match.test(route))
    || SECTIONS.find(item=>section&&item.name.toLowerCase().includes(section));
  if(!found) return {modelData:{found:false,route,message:'No hay una descripción específica registrada para esa sección.'}};
  return {modelData:{found:true,route,name:found.name,description:found.description}};
}

export const helpRepositoryTools=Object.freeze({get_app_help:getAppHelp});
