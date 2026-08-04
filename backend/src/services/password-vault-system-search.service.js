const GENERIC_SYSTEM_WORDS = new Set([
  'admin', 'administrador', 'aplicacion', 'aplicaciones', 'camara', 'camaras',
  'cliente', 'clientes', 'credencial', 'credenciales', 'equipo', 'equipos',
  'plataforma', 'plataformas', 'servicio', 'servicios', 'sistema', 'sistemas',
  'servidor', 'servidores', 'software', 'usuario', 'usuarios',
]);

export const PASSWORD_VAULT_SYSTEM_ALIASES = Object.freeze([
  Object.freeze({
    key: 'lenel-onguard',
    label: 'Lenel OnGuard',
    aliases: Object.freeze([
      'lenel s2 onguard', 'lenel onguard', 'lenels2 onguard', 'lenel s2',
      'lenels2', 'on guard', 'onguard', 'lenel',
    ]),
  }),
  Object.freeze({
    key: 'milestone-xprotect',
    label: 'Milestone XProtect',
    aliases: Object.freeze(['milestone xprotect', 'xprotect', 'milestone']),
  }),
  Object.freeze({
    key: 'axis',
    label: 'Cámaras Axis',
    aliases: Object.freeze(['axis camera station', 'axis communications', 'camaras axis', 'camara axis', 'axis']),
  }),
  Object.freeze({
    key: 'ipro',
    label: 'Cámaras i-PRO',
    aliases: Object.freeze(['camaras i pro', 'camara i pro', 'i pro', 'ipro']),
  }),
  Object.freeze({
    key: 'barco',
    label: 'Barco',
    aliases: Object.freeze(['barco ctrl', 'barco control room', 'barco']),
  }),
]);

export function normalizeVaultSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(text, phrase) {
  const source = ` ${normalizeVaultSearch(text)} `;
  const target = normalizeVaultSearch(phrase);
  return Boolean(target) && source.includes(` ${target} `);
}

export function detectCredentialSystemReference(question) {
  const query = normalizeVaultSearch(question);
  const matches = PASSWORD_VAULT_SYSTEM_ALIASES
    .flatMap((group) => group.aliases
      .filter((alias) => containsPhrase(query, alias))
      .map((alias) => ({ group, alias, length: normalizeVaultSearch(alias).length })))
    .sort((left, right) => right.length - left.length);
  return matches[0] ? { ...matches[0].group, matchedAlias: matches[0].alias } : null;
}

function meaningfulNameTokens(value) {
  return normalizeVaultSearch(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !GENERIC_SYSTEM_WORDS.has(token));
}

export function credentialSystemMatchScore(question, row = {}, categoryName = '', reference = null) {
  const query = normalizeVaultSearch(question);
  const systemName = normalizeVaultSearch(row.Nombre || row.name);
  const searchable = normalizeVaultSearch([
    row.Nombre || row.name,
    categoryName,
    row.URL || row.url,
    row.Notas || row.notes,
  ].join(' '));

  if (!query || !systemName) return 0;

  if (reference) {
    const aliasHits = reference.aliases.filter((alias) => containsPhrase(searchable, alias));
    if (aliasHits.length) {
      const exactQuestionAlias = aliasHits.some((alias) => containsPhrase(query, alias));
      return exactQuestionAlias ? 1 : 0.96;
    }
  }

  if (containsPhrase(query, systemName)) return 0.99;

  const nameTokens = meaningfulNameTokens(systemName);
  if (!nameTokens.length) return 0;
  const hits = nameTokens.filter((token) => containsPhrase(query, token));
  if (!hits.length) return 0;
  if (hits.length === nameTokens.length) return 0.95;
  if (hits.length >= 2) return 0.9;
  if (nameTokens.length === 1 && hits[0].length >= 4) return 0.87;
  return 0;
}

export function matchCredentialSystemRows(question, rows = [], categoriesById = new Map()) {
  const reference = detectCredentialSystemReference(question);
  return rows
    .map((row) => {
      const categoryId = String(row.CategoriaCredencialID || row.categoryId || '').trim();
      const category = categoriesById.get(categoryId) || {};
      const categoryName = category.Nombre || category.name || '';
      return {
        row,
        score: credentialSystemMatchScore(question, row, categoryName, reference),
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score
      || String(left.row.Nombre || '').localeCompare(String(right.row.Nombre || ''), 'es'));
}

export function credentialSystemRequestIntent(question, rows = [], categoriesById = new Map()) {
  const query = normalizeVaultSearch(question);
  const asksForCredential = /\b(contrasena|contrasenas|password|passwords|clave|claves|credencial|credenciales|usuario|usuarios|login|cuenta|acceso)\b/.test(query);
  if (!asksForCredential) return false;
  if (detectCredentialSystemReference(question)) return true;
  return matchCredentialSystemRows(question, rows, categoriesById).length > 0;
}
