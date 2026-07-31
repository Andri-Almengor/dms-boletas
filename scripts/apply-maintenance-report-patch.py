from pathlib import Path
import re


def replace_once(content, old, new, description):
    if old in content:
        return content.replace(old, new, 1)
    if new in content:
        return content
    raise SystemExit(f'No se pudo aplicar: {description}.')


def patch_generation_service():
    path = Path('backend/src/services/maintenance-ticket-generation.service.js')
    content = path.read_text(encoding='utf-8')

    import_marker = "import { ensureSheetColumns } from './sheet-columns.service.js';"
    report_import = "import {\n  buildMaintenanceTicketDraft,\n  mergeImprovedMaintenanceDraft,\n} from './maintenance-ticket-report.service.js';"
    if report_import not in content:
        if import_marker not in content:
            raise SystemExit('No se encontró el marcador de importación del generador.')
        content = content.replace(import_marker, f'{import_marker}\n{report_import}', 1)

    content, removed = re.subn(
        r"\nfunction parseAnswers\(device = \{\}\) \{.*?\n\}\n\nfunction technicianIdsFor",
        "\nfunction technicianIdsFor",
        content,
        count=1,
        flags=re.S,
    )
    if removed != 1 and 'function parseAnswers(device = {})' in content:
        raise SystemExit('No se pudo retirar la redacción antigua de respuestas.')

    replacement_raw = """function rawDraft(bundle, group) {
  return buildMaintenanceTicketDraft(bundle, group);
}

async function improveDraft"""
    content, replaced_raw = re.subn(
        r"function rawDraft\(bundle, group\) \{.*?\n\}\n\nasync function improveDraft",
        replacement_raw,
        content,
        count=1,
        flags=re.S,
    )
    if replaced_raw != 1 and 'return buildMaintenanceTicketDraft(bundle, group);' not in content:
        raise SystemExit('No se pudo reemplazar rawDraft.')

    old_merge = """    return {
      ...raw,
      ...improved,
      geminiUsed: true,
      geminiModel: improved.model || '',
      geminiWarning: '',
    };"""
    new_merge = """    const improvedDraft = mergeImprovedMaintenanceDraft(raw, improved);
    return {
      ...improvedDraft,
      geminiUsed: true,
      geminiModel: improved.model || '',
      geminiWarning: '',
    };"""
    if old_merge in content:
        content = content.replace(old_merge, new_merge, 1)
    elif 'const improvedDraft = mergeImprovedMaintenanceDraft(raw, improved);' not in content:
        raise SystemExit('No se pudo integrar la validación de Gemini.')

    path.write_text(content, encoding='utf-8')


def patch_report_service():
    path = Path('backend/src/services/maintenance-ticket-report.service.js')
    content = path.read_text(encoding='utf-8')

    old_article = """function articleFor(label) {
  const text = normalized(label);
  if (/^(alimentacion|conexion|condicion|limpieza|visualizacion|grabacion|funcion|cerradura|prueba|revision)/.test(text)) return 'la';
  if (/^(estado|funcionamiento|montaje|lector|respaldo|almacenamiento|servicio)/.test(text)) return 'el';
  return 'la verificación de';
}"""
    new_article = """function articleFor(label) {
  const text = normalized(label);
  if (/^(estado|funcionamiento|montaje|lector|respaldo|almacenamiento|servicio)/.test(text)) return 'el';
  if (/^(alimentacion|conexion|condicion|limpieza|visualizacion|grabacion|funcion|cerradura|prueba|revision)/.test(text)) return 'la';
  return 'la verificación de';
}"""
    content = replace_once(content, old_article, new_article, 'los artículos gramaticales de las pruebas')

    old_reference = """function deviceReference(device, maintenance = {}) {
  const category = deviceCategory(device).toLowerCase();
  const name = deviceName(device);
  const location = deviceLocation(device, maintenance);
  const details = [
    cleanText(device.Fabricante) ? `fabricante ${cleanText(device.Fabricante)}` : '',
    cleanText(device.Modelo) ? `modelo ${cleanText(device.Modelo)}` : '',
    cleanText(device.Serie) ? `serie ${cleanText(device.Serie)}` : '',
  ].filter(Boolean);
  return `la ${category} “${name}”${location ? `, ubicada en ${location}` : ''}${details.length ? ` (${details.join(', ')})` : ''}`;
}"""
    new_reference = """function deviceArticle(category) {
  const text = normalized(category);
  return /^(camara|puerta|impresora|bocina|cerradura|fuente)/.test(text) ? 'la' : 'el';
}

function deviceReference(device, maintenance = {}) {
  const category = deviceCategory(device).toLowerCase();
  const name = deviceName(device);
  const location = deviceLocation(device, maintenance);
  const details = [
    cleanText(device.Fabricante) ? `fabricante ${cleanText(device.Fabricante)}` : '',
    cleanText(device.Modelo) ? `modelo ${cleanText(device.Modelo)}` : '',
    cleanText(device.Serie) ? `serie ${cleanText(device.Serie)}` : '',
  ].filter(Boolean);
  const article = deviceArticle(category);
  const locationPhrase = location ? `, ${article === 'la' ? 'ubicada' : 'ubicado'} en ${location}` : '';
  return `${article} ${category} “${name}”${locationPhrase}${details.length ? ` (${details.join(', ')})` : ''}`;
}"""
    content = replace_once(content, old_reference, new_reference, 'la concordancia de categoría y ubicación')

    old_observation = """      observation,
    ].filter(Boolean);"""
    new_observation = """      observation ? `se registró la observación: ${observation}` : '',
    ].filter(Boolean);"""
    content = replace_once(content, old_observation, new_observation, 'la observación del dispositivo pendiente')

    old_merge = """  for (const field of fields) {
    const candidate = safeReportText(improved?.[field]);
    result[field] = candidate || raw[field];
  }"""
    new_merge = """  for (const field of fields) {
    const improvedValue = improved?.[field];
    const candidate = typeof improvedValue === 'string'
      ? safeReportText(improvedValue)
      : '';
    result[field] = candidate || raw[field];
  }"""
    content = replace_once(content, old_merge, new_merge, 'la validación de los campos mejorados por IA')

    old_reason = """  const reason = `Durante la jornada del ${date}, ${technicianNames} realizó labores de mantenimiento preventivo y revisión técnica sobre ${amount} de ${client}${mainLocation ? ` en ${mainLocation}` : ''}.`;"""
    new_reason = """  const workVerb = technicians.length === 1 ? 'realizó' : 'realizaron';
  const reason = `Durante la jornada del ${date}, ${technicianNames} ${workVerb} labores de mantenimiento preventivo y revisión técnica sobre ${amount} de ${client}${mainLocation ? ` en ${mainLocation}` : ''}.`;"""
    content = replace_once(content, old_reason, new_reason, 'la concordancia del equipo técnico')

    path.write_text(content, encoding='utf-8')


def patch_apps_script():
    path = Path('apps-script/boletas-report/Code.gs')
    content = path.read_text(encoding='utf-8')
    annex_block = r'''function hasAnnexContent_(signatureBlob, signatureInserted, evidences) {
  return Boolean(
    (signatureBlob && !signatureInserted)
    || (Array.isArray(evidences) && evidences.length),
  );
}

function paragraphHasPageBreak_(paragraph) {
  for (let index = 0; index < paragraph.getNumChildren(); index += 1) {
    if (paragraph.getChild(index).getType() === DocumentApp.ElementType.PAGE_BREAK) return true;
  }
  return false;
}

function removeTrailingPageArtifacts_(body) {
  while (body.getNumChildren() > 0) {
    const child = body.getChild(body.getNumChildren() - 1);
    const type = child.getType();

    if (type === DocumentApp.ElementType.PAGE_BREAK) {
      child.removeFromParent();
      continue;
    }

    if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
      const paragraph = type === DocumentApp.ElementType.PARAGRAPH
        ? child.asParagraph()
        : child.asListItem();
      if (paragraphHasPageBreak_(paragraph) || !clean_(paragraph.getText())) {
        child.removeFromParent();
        continue;
      }
    }

    break;
  }
}

function appendAnnexes_(body, signatureBlob, signatureInserted, evidences) {
  const annexEvidences = Array.isArray(evidences) ? evidences : [];
  removeTrailingPageArtifacts_(body);

  if (!hasAnnexContent_(signatureBlob, signatureInserted, annexEvidences)) return;

  body.appendPageBreak();
  body.appendParagraph('ANEXOS').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (signatureBlob && !signatureInserted) {
    body.appendParagraph('Firma del cliente').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    const signatureImage = body.appendParagraph('').appendInlineImage(signatureBlob);
    resizeInlineImage_(signatureImage, 260);
  }

  if (!annexEvidences.length) return;

  body.appendParagraph('Evidencias fotográficas').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  annexEvidences.forEach(function (evidence, index) {
    const name = clean_(evidence.Nombre || evidence.NombreArchivo, `Evidencia ${index + 1}`);
    const note = clean_(evidence.Nota);
    body.appendParagraph(`${index + 1}. ${name}`).setBold(true);
    if (note) body.appendParagraph(note);
    const blob = getDriveBlob_(evidence.ArchivoID || evidence.ArchivoFileID || evidence.DriveFileID || evidence.ArchivoURL);
    if (blob && /^image\//i.test(blob.getContentType())) {
      const image = body.appendParagraph('').appendInlineImage(blob);
      resizeInlineImage_(image, 460);
    } else if (evidence.ArchivoURL) {
      body.appendParagraph(`Archivo: ${evidence.ArchivoURL}`);
    }
  });
}'''

    content, replaced = re.subn(
        r"function appendAnnexes_\(body, signatureBlob, signatureInserted, evidences\) \{.*?\n\}\n\nfunction sendReportEmail_",
        f'{annex_block}\n\nfunction sendReportEmail_',
        content,
        count=1,
        flags=re.S,
    )
    if replaced != 1 and 'function removeTrailingPageArtifacts_(body)' not in content:
        raise SystemExit('No se pudo reemplazar appendAnnexes_.')

    path.write_text(content, encoding='utf-8')


if __name__ == '__main__':
    patch_generation_service()
    patch_report_service()
    patch_apps_script()
