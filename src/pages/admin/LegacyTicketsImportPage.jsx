import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { requestAvailable } from '../../services/moduleApi';
import { parseLegacyTicketsWorkbook } from '../../services/legacyXlsxParser';

const PREVIEW_ROUTES = ['legacy.tickets.preview', 'migracion.boletas.previsualizar'];
const COMMIT_ROUTES = ['legacy.tickets.commit', 'migracion.boletas.importar'];

function plural(value, singular, pluralText = `${singular}s`) {
  return `${value} ${Number(value) === 1 ? singular : pluralText}`;
}

function SummaryCard({ icon, label, value, note, tone = '' }) {
  return <article className={`legacy-import-kpi${tone ? ` legacy-import-kpi--${tone}` : ''}`}>
    <span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong>{note && <p>{note}</p>}</div>
  </article>;
}

export default function LegacyTicketsImportPage() {
  const { sessionToken } = useAuth();
  const fileInput = useRef(null);
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rollbackPreview, setRollbackPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [rollbackAccepted, setRollbackAccepted] = useState(false);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState('');

  const busy = ['parsing', 'previewing', 'importing', 'rollingBack'].includes(stage);

  async function selectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    setPreview(null);
    setRollbackPreview(null);
    setParsed(null);
    setAccepted(false);
    setRollbackAccepted(false);
    setStage('parsing');
    try {
      const workbook = await parseLegacyTicketsWorkbook(file);
      setParsed(workbook);
      setStage('previewing');
      const [importResponse, rollbackResponse] = await Promise.all([
        requestAvailable(PREVIEW_ROUTES, {
          importId: workbook.importId,
          tickets: workbook.tickets,
          clients: workbook.clients,
        }, sessionToken),
        requestAvailable(PREVIEW_ROUTES, {
          operation: 'rollback',
          importId: workbook.importId,
        }, sessionToken),
      ]);
      setPreview(importResponse);
      setRollbackPreview(rollbackResponse);
      setStage('ready');
    } catch (fileError) {
      setError(fileError.message || 'No fue posible revisar el archivo seleccionado.');
      setStage('error');
    }
  }

  async function importTickets() {
    if (!parsed || !preview?.canImport || !accepted || busy) return;
    setStage('importing');
    setError('');
    try {
      const response = await requestAvailable(COMMIT_ROUTES, {
        importId: parsed.importId,
        tickets: parsed.tickets,
        clients: parsed.clients,
      }, sessionToken);
      setResult({ ...response, operation: 'import' });
      setStage('complete');
    } catch (requestError) {
      setError(requestError.message || 'No fue posible importar las boletas anteriores.');
      setStage('ready');
    }
  }

  async function rollbackImport() {
    if (!parsed || !rollbackPreview?.canRollback || !rollbackAccepted || busy) return;
    setStage('rollingBack');
    setError('');
    try {
      const response = await requestAvailable(COMMIT_ROUTES, {
        operation: 'rollback',
        importId: parsed.importId,
      }, sessionToken);
      setResult({ ...response, operation: 'rollback' });
      setStage('complete');
    } catch (requestError) {
      setError(requestError.message || 'No fue posible deshacer la importación anterior.');
      setStage('ready');
    }
  }

  function reset() {
    setParsed(null);
    setPreview(null);
    setRollbackPreview(null);
    setResult(null);
    setAccepted(false);
    setRollbackAccepted(false);
    setError('');
    setStage('idle');
    if (fileInput.current) fileInput.current.value = '';
  }

  const resultIsRollback = result?.operation === 'rollback';

  return <div className="page legacy-import-page">
    <header className="legacy-import-hero">
      <div><span className="eyebrow">Administración</span><h1>Importar boletas anteriores</h1><p>Cargue una exportación original o una base depurada para revisar, deshacer o incorporar el historial de AppSheet.</p></div>
      <span className="legacy-import-hero__icon"><Icon name="upload_file" /></span>
    </header>

    <section className="legacy-import-panel legacy-import-upload">
      <div className="legacy-import-panel__heading"><div><h2>1. Seleccione la exportación</h2><p>El archivo debe contener la hoja <strong>Boletas</strong>. La hoja <strong>Clientes</strong> es opcional, pero recomendada.</p></div>{parsed && <button type="button" className="button button--ghost" onClick={reset} disabled={busy}><Icon name="restart_alt" />Cambiar archivo</button>}</div>
      <input ref={fileInput} id="legacyTicketsFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={busy} hidden />
      {!parsed && <label htmlFor="legacyTicketsFile" className={`legacy-import-drop${busy ? ' is-busy' : ''}`}>
        <Icon name={busy ? 'progress_activity' : 'table_view'} />
        <strong>{stage === 'parsing' ? 'Leyendo el archivo...' : stage === 'previewing' ? 'Comparando con la base actual...' : 'Seleccionar archivo XLSX'}</strong>
        <span>No se escribe información hasta que usted confirme una acción.</span>
      </label>}
      {parsed && <div className="legacy-import-file"><span><Icon name="description" /></span><div><strong>{parsed.fileName}</strong><small>{parsed.summary.format} · Identificador: {parsed.importId.slice(0, 16)}…</small></div><Icon name="verified" /></div>}
      {error && <div className="legacy-import-alert legacy-import-alert--error"><Icon name="error" /><span>{error}</span></div>}
    </section>

    {parsed && !result && <section className="legacy-import-panel">
      <div className="legacy-import-panel__heading"><div><h2>2. Revisión del archivo</h2><p>Resumen detectado antes de realizar cambios en Google Sheets.</p></div></div>
      <div className="legacy-import-kpis">
        <SummaryCard icon="receipt_long" label="Boletas encontradas" value={parsed.summary.tickets} note={`${parsed.summary.firstNumber} a ${parsed.summary.lastNumber}`} />
        <SummaryCard icon="task_alt" label="Finalizadas" value={parsed.summary.statuses.Finalizado || parsed.summary.statuses.Finalizada || 0} tone="success" />
        <SummaryCard icon="pending_actions" label="Pendientes" value={parsed.summary.statuses.Pendiente || 0} tone="warning" />
        <SummaryCard icon="groups" label="Clientes relacionados" value={parsed.summary.clients} />
      </div>

      {stage === 'previewing' && <div className="legacy-import-processing"><Icon name="progress_activity" /><span>Comparando identificadores, clientes, técnicos e importaciones anteriores...</span></div>}

      {preview && <div className="legacy-import-review-grid">
        <article><span className="legacy-import-review-grid__icon"><Icon name="add_circle" /></span><div><strong>{plural(preview.newTickets, 'boleta nueva')}</strong><p>Se agregarán al historial actual.</p></div></article>
        <article><span className="legacy-import-review-grid__icon"><Icon name="content_copy" /></span><div><strong>{plural(preview.alreadyImported, 'boleta existente')}</strong><p>Se omitirán automáticamente para evitar duplicados.</p></div></article>
        <article><span className="legacy-import-review-grid__icon"><Icon name="pin" /></span><div><strong>{plural(preview.numbersToReassign, 'número reasignado')}</strong><p>Los consecutivos repetidos o utilizados recibirán un número nuevo y conservarán el original.</p></div></article>
        <article><span className="legacy-import-review-grid__icon"><Icon name="domain_add" /></span><div><strong>{plural(preview.clientsToCreate, 'cliente nuevo')}</strong><p>Solo se crearán cuando no exista una coincidencia por nombre.</p></div></article>
      </div>}

      {!!parsed.summary.duplicateNumbers.length && <div className="legacy-import-alert legacy-import-alert--warning"><Icon name="warning" /><div><strong>El archivo contiene consecutivos repetidos.</strong><p>{parsed.summary.duplicateNumbers.map((item) => `#${item.number} (${item.count} veces)`).join(', ')}. La importación conservará el número original en <em>BoletaIDLegacy</em> y asignará consecutivos únicos cuando sea necesario.</p></div></div>}

      {!!preview?.unmatchedTechnicians?.length && <div className="legacy-import-alert"><Icon name="person_alert" /><div><strong>Técnicos sin coincidencia automática</strong><p>{preview.unmatchedTechnicians.join(', ')}. Sus nombres se conservarán como información histórica, pero no se asociarán a una cuenta hasta que exista un usuario equivalente.</p></div></div>}

      <div className="legacy-import-alert"><Icon name="image_not_supported" /><div><strong>Archivos históricos</strong><p>Se conservan los enlaces disponibles en el XLSX. Las fotografías no pueden reconstruirse cuando el archivo no contiene las imágenes originales.</p></div></div>
    </section>}

    {rollbackPreview?.canRollback && !result && <section className="legacy-import-panel legacy-import-confirm">
      <div className="legacy-import-panel__heading"><div><h2>3. Deshacer la importación detectada</h2><p>Este mismo archivo ya fue cargado anteriormente y todavía tiene registros activos.</p></div></div>
      <div className="legacy-import-alert legacy-import-alert--warning"><Icon name="undo" /><div><strong>Se desactivarán {rollbackPreview.activeTickets} boletas y {rollbackPreview.activeAssignments} asignaciones.</strong><p>Los clientes creados se conservarán para no romper referencias y para poder reutilizarlos al importar la versión depurada. La operación queda registrada en auditoría y libera los consecutivos de esas boletas.</p></div></div>
      <label className="legacy-import-check"><input type="checkbox" checked={rollbackAccepted} onChange={(event) => setRollbackAccepted(event.target.checked)} disabled={busy} /><span>Confirmo que este es el archivo incorrecto y deseo deshacer únicamente la importación con identificador <strong>{parsed.importId.slice(0, 16)}…</strong>.</span></label>
      <button type="button" className="button button--primary legacy-import-submit" onClick={rollbackImport} disabled={!rollbackAccepted || busy}><Icon name={stage === 'rollingBack' ? 'progress_activity' : 'undo'} />{stage === 'rollingBack' ? 'Deshaciendo importación...' : `Deshacer ${rollbackPreview.activeTickets} boletas importadas`}</button>
    </section>}

    {preview && !result && !rollbackPreview?.canRollback && <section className="legacy-import-panel legacy-import-confirm">
      <div className="legacy-import-panel__heading"><div><h2>3. Confirmar importación</h2><p>La operación agrega registros históricos, pero no genera PDF nuevos ni envía correos o mensajes.</p></div></div>
      {preview.canImport ? <>
        <label className="legacy-import-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} /><span>Confirmo que revisé el resumen y deseo importar {preview.newTickets} boletas en la base actual.</span></label>
        <button type="button" className="button button--primary legacy-import-submit" onClick={importTickets} disabled={!accepted || busy}><Icon name={stage === 'importing' ? 'progress_activity' : 'database_upload'} />{stage === 'importing' ? 'Importando boletas...' : `Importar ${preview.newTickets} boletas`}</button>
      </> : <div className="legacy-import-alert legacy-import-alert--success"><Icon name="check_circle" /><span>Todas las boletas de este archivo ya fueron importadas. No se realizarán cambios.</span></div>}
    </section>}

    {result && <section className="legacy-import-panel legacy-import-result">
      <div className="legacy-import-result__icon"><Icon name={resultIsRollback ? 'undo' : 'task_alt'} /></div><div><span className="eyebrow">{resultIsRollback ? 'Importación deshecha' : 'Migración completada'}</span><h2>{result.message}</h2>{resultIsRollback
        ? <p>Se desactivaron {result.revertedAssignments} asignaciones. Los clientes importados permanecen disponibles para la nueva base depurada.</p>
        : <p>Se agregaron {result.importedClients} clientes y {result.importedAssignments} asignaciones de técnicos. {result.renumberedTickets} boletas recibieron un consecutivo nuevo para evitar duplicados.</p>}
        <div className="legacy-import-result__actions">{resultIsRollback
          ? <button type="button" className="button button--primary" onClick={reset}><Icon name="upload_file" />Cargar versión depurada</button>
          : <><Link className="button button--primary" to="/boletas/finalizadas"><Icon name="task_alt" />Ver finalizadas</Link><Link className="button button--secondary" to="/metricas"><Icon name="monitoring" />Ver métricas</Link><button type="button" className="button button--ghost" onClick={reset}><Icon name="upload_file" />Importar otro archivo</button></>}
        </div></div>
    </section>}
  </div>;
}
