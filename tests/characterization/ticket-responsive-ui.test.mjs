import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Home Pendientes y Finalizadas conservan un único TicketCard compartido', () => {
  const home = source('src/pages/HomePage.jsx');
  const list = source('src/pages/tickets/TicketListPage.jsx');

  assert.match(home, /import TicketCard from '..\/components\/tickets\/TicketCard'/);
  assert.match(home, /<TicketCard compact ticket=\{ticket\}/);
  assert.match(list, /import TicketCard from '..\/..\/components\/tickets\/TicketCard'/);
  assert.match(list, /<TicketCard[^>]*ticket=\{ticket\}/);
  assert.doesNotMatch(home, /MobileTicketCard|DesktopTicketCard|PendingTicketCard|FinishedTicketCard/);
  assert.doesNotMatch(list, /MobileTicketCard|DesktopTicketCard|PendingTicketCard|FinishedTicketCard/);
});

test('lista de boletas usa la superficie wide y conserva filtros y paginación existentes', () => {
  const list = source('src/pages/tickets/TicketListPage.jsx');

  assert.match(list, /className="page page--wide ticket-list-page"/);
  assert.match(list, /usePaginatedResource/);
  assert.match(list, /TICKET_PAGE_SIZE = 50/);
  assert.match(list, /<FilterDrawer/);
  assert.match(list, /loadMore/);
  assert.match(list, /requestSynchronizedCollection/);
  assert.match(list, /subscribeSyncResource/);
});

test('búsqueda de boletas es operable con teclado y tiene acción explícita en táctil', () => {
  const list = source('src/pages/tickets/TicketListPage.jsx');
  const styles = source('src/styles/modules.css');

  assert.match(list, /role="search"/);
  assert.match(list, /type="search"/);
  assert.match(list, /enterKeyHint="search"/);
  assert.match(list, /type="submit" className="icon-button ticket-list-search-submit"/);
  assert.match(list, /aria-expanded=\{filterOpen\}/);
  assert.match(styles, /\.ticket-list-search-bar\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) 44px 44px/s);
  assert.match(styles, /@media \(max-width: 440px\)[\s\S]*\.ticket-list-search-bar[\s\S]*40px 40px/);
});

test('TicketCard acomoda múltiples acciones sin asumir una cantidad fija de botones', () => {
  const card = source('src/components/tickets/TicketCard.jsx');
  const styles = source('src/styles/modules.css');

  assert.match(card, /ticket-card__primary-action/);
  assert.match(card, /ticket-card__secondary-actions/);
  assert.match(card, /ticket-card__meta-location/);
  assert.match(styles, /\.ticket-card__actions\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /\.ticket-card__secondary-actions\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(styles, /\.ticket-card__actions\s*\{[^}]*grid-template-columns:\s*1fr 48px/s);
});

test('TicketCard reorganiza estado y acciones en teléfono sin quitar información', () => {
  const styles = source('src/styles/modules.css');

  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.ticket-card__header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.ticket-card__header \.ticket-status\s*\{[^}]*justify-self:\s*start/s);
  assert.match(styles, /@media \(max-width: 440px\)[\s\S]*\.ticket-card__primary-action[\s\S]*flex:\s*1 0 100%/s);
  assert.match(styles, /\.ticket-card__meta-location\s*\{[^}]*flex-basis:\s*100%/s);
});

test('Home escala de una a dos y tres columnas sin duplicar tarjetas', () => {
  const styles = source('src/styles/modules.css');

  assert.match(styles, /@media \(min-width: 760px\)[\s\S]*\.page--home \.ticket-stack\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /@media \(min-width: 1100px\)[\s\S]*\.page--home \.ticket-stack\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.stats-grid--admin\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/s);
});

test('tarjetas completas siguen siendo accesibles por click Enter y Espacio', () => {
  const card = source('src/components/tickets/TicketCard.jsx');

  assert.match(card, /event\.target\.closest\('a, button, input, select, textarea, label'\)/);
  assert.match(card, /!\['Enter', ' '\]\.includes\(event\.key\)/);
  assert.match(card, /role=\{detailUrl \? 'link'/);
  assert.match(card, /tabIndex=\{detailUrl \? 0/);
  assert.match(card, /aria-label=\{detailUrl \? `Abrir detalle de la boleta/);
});


test('Pendientes y Finalizadas persisten búsqueda y filtros en la URL sin cambiar la consulta existente', () => {
  const list = source('src/pages/tickets/TicketListPage.jsx');

  assert.match(list, /FILTER_QUERY_KEYS/);
  assert.match(list, /readListQuery\(routeLocation\.search\)/);
  assert.match(list, /buildListQuery\(nextSearch, nextFilters\)/);
  assert.match(list, /navigate\(\`\$\{routeLocation\.pathname\}\$\{query \? \`\?\$\{query\}\` : ''\}\`, \{ replace: true \}\)/);
  assert.match(list, /requestSynchronizedCollection/);
  assert.match(list, /usePaginatedResource/);
});

test('TicketCard conserva origen y scroll para detalle y edición sin duplicar tarjetas', () => {
  const card = source('src/components/tickets/TicketCard.jsx');
  const list = source('src/pages/tickets/TicketListPage.jsx');

  assert.match(card, /returnTo = ''/);
  assert.match(card, /returnScrollY:/);
  assert.match(card, /window\.scrollY/);
  assert.match(card, /navigate\(detailUrl, \{ state: returnState\(\) \}\)/);
  assert.match(list, /returnTo=\{currentListUrl\}/);
  assert.doesNotMatch(card, /MobileTicketCard|DesktopTicketCard/);
});

test('detalle y ediciones conservan el contexto del listado al regresar', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const wrapper = source('src/pages/tickets/TicketDetailWithQuickEdit.jsx');
  const quick = source('src/pages/tickets/TicketQuickEditPage.jsx');
  const form = source('src/pages/tickets/TicketFormPage.jsx');
  const persistence = source('src/features/tickets/useTicketPersistence.js');

  assert.match(detail, /validReturnTo = \/\^\\\/boletas\\\/\(pendientes\|finalizadas\)/);
  assert.match(detail, /restoreScrollY: returnScrollY/);
  assert.match(detail, /state=\{routeLocation\.state\}/);
  assert.match(wrapper, /navigate\([^\n]*editar-rapido[^\n]*\{ state: location\.state \}/);
  assert.match(quick, /const returnState = location\.state/);
  assert.match(form, /navigationState: returnState/);
  assert.match(persistence, /navigationState \? \{ state: navigationState \} : undefined/);
});

test('Home compacto conserva equipo y responsable dentro del TicketCard compartido', () => {
  const card = source('src/components/tickets/TicketCard.jsx');
  const styles = source('src/styles/modules.css');

  assert.match(card, /ticket-card__compact-data/);
  assert.match(card, /<Icon name="devices_other"/);
  assert.match(card, /<Icon name="engineering"/);
  assert.match(styles, /\.ticket-card__compact-data\s*\{/);
});

test('acciones móviles de búsqueda y consulta respetan el target táctil compartido', () => {
  const styles = source('src/styles/modules.css');

  assert.match(styles, /ticket-list-search-bar[\s\S]*var\(--touch-target-min\) var\(--touch-target-min\)/);
  assert.match(styles, /\.ticket-list-search-bar \.icon-button \{ width: var\(--touch-target-min\); height: var\(--touch-target-min\); \}/);
  assert.match(styles, /\.ticket-list-query-state > button \{ min-height: var\(--touch-target-min\)/);
  assert.match(styles, /\.page--home \.stat-card \{ min-height: 112px/);
});
