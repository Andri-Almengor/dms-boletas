from pathlib import Path


def replace_once(path, old, new, label):
    file_path = Path(path)
    text = file_path.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'No se encontró {label} en {path}')
    file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/services/offlineStoreCore.js',
    "    conflict: conflict || existing?.conflict || null,",
    "    conflict: existing?.conflict || conflict || null,",
    'la precedencia de la base original',
)

client_path = Path('src/services/offlineConflictDomain.js')
client = client_path.read_text(encoding='utf-8')
for marker in [
    "      Estado: ['Estado', 'status'],\n",
]:
    client = client.replace(marker, marker + "      Activo: ['Activo', 'activo'],\n")
client_path.write_text(client, encoding='utf-8')

server_path = Path('backend/src/services/offline-conflict.service.js')
server = server_path.read_text(encoding='utf-8')
for old in [
    "fields: ['ClienteID', 'Nombre', 'Direccion', 'Notas', 'Estado']",
    "fields: ['UbicacionID', 'Nombre', 'Descripcion', 'Estado']",
    "fields: ['Nombre', 'Descripcion', 'Estado']",
    "fields: ['Nombre', 'LogoURL', 'Estado']",
    "fields: ['TipoDispositivoID', 'FabricanteID', 'Nombre', 'ImagenReferenciaURL', 'Descripcion', 'Estado']",
    "fields: ['TipoDispositivoID', 'FabricanteID', 'Estado']",
]:
    if old in server:
        server = server.replace(old, old[:-1] + ", 'Activo']", 1)
server_path.write_text(server, encoding='utf-8')
