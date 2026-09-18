import { query } from '../infra/postgres.js';
import { badRequest } from '../core/errors.js';
import { createProtectedMediaStreamUrl } from '../services/protected-media-stream.service.js';
import { aiConfig } from './agent.config.js';
import { resolveDateRange } from './agent.dates.js';

const CLIENT_ALIASES = Object.freeze({
  bccr: 'Banco Central',
  bcr: 'Banco de Costa Rica',
  ccss: 'Caja Costarricense',
  aya: 'Acueductos',
  ins: 'Instituto Nacional de Seguros',
  ice: 'Instituto Costarricense de Electricidad',
  asamblea: 'Asamblea Legislativa',
  rn: 'Registro Nacional',
  registro: 'Registro Nacional',
});

export function clean(value, maxLength = 4000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function active(alias) {
  return `${alias}."__valid"=TRUE AND LOWER(COALESCE(${alias}."Activo",'true')) <> 'false'`;
}

export function pageLimit(value, fallback = 20) {
  return Math.min(aiConfig.maxToolResultRows, Math.max(1, Number(value || fallback)));
}

export function pageOffset(value) {
  return Math.max(0, Number(value || 0));
}

export function aliasQuery(value) {
  const input = clean(value, 300);
  return CLIENT_ALIASES[input.toLowerCase()] || input;
}

export function like(value) {
  return '%' + clean(value, 300).replace(/[\\%_]/g, '\\export function like(value) {
  return '%' + clean(value, 300).replace(/[\\%_]/g, '\\$&') + '%';
}
') + '%';
}

const SEARCH_STOPWORDS=new Set([
  'a','al','algo','como','con','cual','cuál','de','del','dice','diga','documento','documentos',
  'el','en','esa','ese','esta','este','guia','guía','la','las','lo','los','manual','manuales',
  'me','mi','nuestra','nuestro','para','pdf','por','que','qué','se','segun','según','sobre','un','una','y',
]);

export function searchTerms(value,{limit=8}={}){
  const raw=clean(value,500).normalize('NFKC');
  const tokens=raw.match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu)||[];
  const normalized=[];
  for(const token of tokens){
    const lower=token.toLowerCase();
    if(lower.length<2||SEARCH_STOPWORDS.has(lower))continue;
    if(!normalized.includes(lower))normalized.push(lower);
    if(normalized.length>=Math.max(1,Number(limit)||8))break;
  }
  return normalized;
}

export function addRange(clauses, params, column, input = {}) {
  const range = resolveDateRange(input);
  if (range.from) {
    params.push(range.from);
    clauses.push(`NULLIF(SUBSTRING(COALESCE(${column},'') FROM 1 FOR 10),'') >= $${params.length}`);
  }
  if (range.to) {
    params.push(range.to);
    clauses.push(`NULLIF(SUBSTRING(COALESCE(${column},'') FROM 1 FOR 10),'') <= $${params.length}`);
  }
  return range;
}

export function source(type, id, label, url = '') {
  return { type, id: clean(id, 250), label: clean(label, 300), url: clean(url, 1000) };
}

export function entity(type, id, label, route, meta = {}) {
  return { type, id: clean(id, 250), label: clean(label, 300), route: clean(route, 1000), ...meta };
}

export function mediaType(mimeType) {
  const mime = clean(mimeType, 150).toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

export function protectedAttachment(ctx, {
  fileId, mimeType, scopeId, evidenceId, kind, title, subtitle, entityType, entityId,
}) {
  if (!clean(fileId)) return null;
  const url = createProtectedMediaStreamUrl({
    fileId,
    mimeType,
    boletaUid: scopeId,
    evidenceId,
    kind,
    userId: ctx.user?.UsuarioID || '',
    sessionToken: ctx.sessionToken || '',
  });
  return {
    type: mediaType(mimeType),
    title: clean(title, 300),
    subtitle: clean(subtitle, 500),
    url,
    mimeType: clean(mimeType, 150) || 'application/octet-stream',
    entityType: clean(entityType, 80),
    entityId: clean(entityId, 250),
  };
}

export async function one(sql, params, label) {
  const result = await query(sql, params, { label });
  return result.rows[0] || null;
}

export async function many(sql, params, label) {
  const result = await query(sql, params, { label });
  return result.rows;
}

export function ticketDateColumn(alias = 'b') {
  return `COALESCE(NULLIF(${alias}."FinalizadaEn",''), NULLIF(${alias}."Fecha",''), ${alias}."FechaCreacion")`;
}

export function normalizeTicketStatus(status) {
  const value = clean(status, 40).toUpperCase();
  if (!value) return '';
  if (value.includes('PEND')) return 'PENDIENTE';
  if (value.includes('FINAL')) return 'FINALIZADA';
  if (value.includes('ANUL')) return 'ANULADA';
  return value;
}

export function requireId(value, label) {
  const id = clean(value, 250);
  if (!id) throw badRequest(`Falta ${label}.`);
  return id;
}
