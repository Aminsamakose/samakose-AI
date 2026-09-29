/** Writes docs/openapi.json from the live route registry. Run: npm run openapi */
import { writeFileSync } from 'node:fs';
import '../src/api/routes';
import { routes } from '../src/api/framework';
import { buildOpenApi } from '../src/api/openapi';

const spec = buildOpenApi(routes);
writeFileSync('docs/openapi.json', JSON.stringify(spec, null, 2));
console.log(`docs/openapi.json written: ${Object.keys(spec.paths).length} paths, ${routes.length} operations`);
