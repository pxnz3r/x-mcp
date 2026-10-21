import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { paths } from './config.js';

export function viewerFile() {
  return path.join(paths.dataDir, 'view.html');
}

export function localUrlFor(id, viewerPath = viewerFile()) {
  return `${pathToFileURL(viewerPath).href}#post=${id}`;
}
