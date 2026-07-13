import { appendRow, filterRows, findById, readTable, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { getConfig } from './config.module.js';
import { nowIso, pick, uuid } from '../core/utils.js';

async function enrich(article) {
  const attachments = (await readTable('KnowledgeAttachments')).filter((a) => String(a.ArticuloID || a.ArticuloRef) === String(article.ArticuloID) && a.Activo !== false);
  return { article, articulo: article, attachments, adjuntos: attachments };
}
export const knowledgeHandlers = {
  list: async ({ payload }) => filterRows((await readTable('KnowledgeArticles')).filter((a) => a.Activo !== false), payload, ['Titulo','Resumen','Contenido','CategoriaNombre','Etiquetas']),
  get: async ({ payload }) => enrich(await findById('KnowledgeArticles', pick(payload,['tutorialId','articleId','ArticuloID','id']))),
  create: async (ctx) => { const p=ctx.payload; const row={ArticuloID:uuid(),Titulo:pick(p,['Titulo','titulo']),Resumen:pick(p,['Resumen','resumen']),Contenido:pick(p,['Contenido','contenido']),CategoriaConocimientoID:pick(p,['CategoriaConocimientoID','categoriaId']),CategoriaNombre:pick(p,['CategoriaNombre','categoria']),Etiquetas:pick(p,['Etiquetas','etiquetas']),VideoURL:pick(p,['VideoURL','videoUrl']),Estado:pick(p,['Estado','estado'],'PUBLICADO'),Activo:true,CreadoPor:ctx.user.UsuarioID,FechaCreacion:nowIso(),ActualizadoPor:ctx.user.UsuarioID,FechaActualizacion:nowIso()};await appendRow('KnowledgeArticles',row);return enrich(row);},
  update: async (ctx) => { const id=pick(ctx.payload,['tutorialId','articleId','ArticuloID','id']); const p=ctx.payload; const row=await updateRow('KnowledgeArticles',id,{Titulo:pick(p,['Titulo','titulo']),Resumen:pick(p,['Resumen','resumen']),Contenido:pick(p,['Contenido','contenido']),CategoriaConocimientoID:pick(p,['CategoriaConocimientoID','categoriaId']),CategoriaNombre:pick(p,['CategoriaNombre','categoria']),Etiquetas:pick(p,['Etiquetas','etiquetas']),VideoURL:pick(p,['VideoURL','videoUrl']),Estado:pick(p,['Estado','estado']),ActualizadoPor:ctx.user.UsuarioID,FechaActualizacion:nowIso()});return enrich(row);},
  delete: async (ctx) => softDelete('KnowledgeArticles',pick(ctx.payload,['tutorialId','articleId','ArticuloID','id']),ctx.user.UsuarioID),
  attachmentUpload: async (ctx) => { const cfg=await getConfig();const file=await uploadBase64({base64:ctx.payload.base64,mimeType:ctx.payload.mimeType,fileName:ctx.payload.fileName,folderId:cfg.ROOT_FOLDER_ID});const row={AdjuntoID:uuid(),ArticuloID:pick(ctx.payload,['tutorialId','articleId','ArticuloID']),Nombre:pick(ctx.payload,['nombre','Nombre'],file.name),Descripcion:pick(ctx.payload,['descripcion','Descripcion']),DriveFileID:file.id,DriveURL:file.webViewLink,NombreArchivo:file.name,MimeType:file.mimeType,Size:file.size||'',Activo:true,CreadoPor:ctx.user.UsuarioID,FechaCreacion:nowIso()};await appendRow('KnowledgeAttachments',row);return row;},
  attachmentDelete: async (ctx) => {const row=await findById('KnowledgeAttachments',pick(ctx.payload,['attachmentId','AdjuntoID','id']));await trashFile(row.DriveFileID).catch(()=>{});return softDelete('KnowledgeAttachments',row.AdjuntoID,ctx.user.UsuarioID);},
  mediaGet: async ({payload}) => {const row=await findById('KnowledgeAttachments',pick(payload,['attachmentId','AdjuntoID','id']));return{AdjuntoID:row.AdjuntoID,...await downloadAsDataUrl(row.DriveFileID,row.MimeType)};},
};
