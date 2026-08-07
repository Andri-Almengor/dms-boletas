import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/pages/assistant/AssistantPageSecure.jsx';
let source = readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`No se encontró el ancla para ${label}.`);
  source = source.replace(before, after);
}

replaceOnce(
  "import Icon from '../../components/common/Icon';\n",
  "import Icon from '../../components/common/Icon';\nimport GatewaySnapshotCard from '../../components/assistant/GatewaySnapshotCard';\n",
  'importar GatewaySnapshotCard',
);

replaceOnce(
  "{message.sensitive && <div className=\"assistant-sensitive-notice\"><Icon name=\"shield_lock\" /><span>Esta respuesta contiene credenciales. No se guardará en el historial local del navegador. Oculte la pantalla antes de compartir o proyectar el dispositivo.</span></div>}",
  "{message.sensitive && <div className=\"assistant-sensitive-notice\"><Icon name=\"shield_lock\" /><span>Esta respuesta contiene información sensible. No se guardará en el historial local del navegador. Oculte la pantalla antes de compartir o proyectar el dispositivo.</span></div>}",
  'generalizar aviso sensible',
);

replaceOnce(
  "        <AssistantStats stats={message.stats} />\n        {message.tables?.map((table) => <AssistantDataTable key={table.id} table={table} />)}\n",
  "        <AssistantStats stats={message.stats} />\n        {message.tables?.map((table) => <AssistantDataTable key={table.id} table={table} />)}\n        {message.snapshot && <GatewaySnapshotCard snapshot={message.snapshot} />}\n",
  'renderizar captura',
);

replaceOnce(
  "        stats: presentation.stats,\n        sensitive: Boolean(response.sensitive),\n",
  "        stats: presentation.stats,\n        snapshot: response.facts?.gatewaySnapshot || null,\n        sensitive: Boolean(response.sensitive),\n",
  'conservar captura en el mensaje',
);

writeFileSync(file, source);
console.log('AssistantPageSecure.jsx actualizado para renderizar capturas Gateway.');
