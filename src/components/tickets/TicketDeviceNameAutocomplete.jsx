import { useCallback, useEffect, useRef, useState } from 'react';
import DependentSelect from '../forms/DependentSelect';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

/**
 * El campo de boletas conserva su cadena original (Descripcion) y sus reglas.
 * Se limita a proponer nombres de la instantánea de Inventario del cliente.
 * Nunca crea ni vincula un dispositivo, ni modifica tipo/modelo/fabricante.
 *
 * Reutiliza el selector searchable compartido y la lectura de inventario
 * existente. Tres superficies: alta/edición completa, edición rápida y seguimiento.
 */
export default function TicketDeviceNameAutocomplete({
  clientId, sessionToken, name = 'nombreDispositivo',
  value = '', onChange, disabled = false, required = false,
}) {
  const [options, setOptions] = useState([]);
  const [hasInventory, setHasInventory] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    // Invalidar peticiones pendientes cuando se cambia de cliente o sesión.
    generation.current += 1;
    setOptions([]);
    setHasInventory(false);
  }, [clientId, sessionToken]);

  const search = useCallback(async (term) => {
    if (!clientId || !sessionToken) return;
    const requestGeneration = ++generation.current;
    try {
      const result = await requestAvailable(MODULE_ROUTES.inventory.devices, {
        clienteId: clientId,
        search: String(term || '').trim(),
        namesOnly: true,
        pageSize: 25,
      }, sessionToken, { cache: 'no-store' });
      if (requestGeneration !== generation.current) return;
      setHasInventory(Boolean(result?.generated));
      const seen = new Set();
      const suggested = (result?.generated ? result.items || [] : [])
        .map((row) => String(row.name || '').trim())
        .filter(Boolean)
        .filter((item) => {
          const key = item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((item) => ({ value: item, label: item }));
      setOptions(suggested);
    } catch {
      // Conexión, permisos o inventario no disponible: el texto manual sigue
      // funcionando. El autocompletado nunca bloquea el guardado de boletas.
      if (requestGeneration === generation.current) {
        setHasInventory(false);
        setOptions([]);
      }
    }
  }, [clientId, sessionToken]);

  return (
    <DependentSelect
      label="Nombre del dispositivo"
      name={name}
      value={value}
      onChange={onChange}
      options={options}
      searchable
      allowCustomValue
      required={required}
      disabled={disabled}
      onSearch={search}
      searchDelay={280}
      searchPlaceholder="Escriba el nombre o busque en el inventario..."
      hint={hasInventory
        ? 'Seleccione un equipo existente o conserve el nombre que escriba.'
        : 'Puede escribir libremente el nombre; si hay un inventario generado, aparecerán sugerencias.'}
    />
  );
}
