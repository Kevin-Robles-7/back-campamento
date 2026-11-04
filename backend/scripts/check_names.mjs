import 'dotenv/config';
import { query } from '../src/db.js';
async function main() {
  const rows = await query("SELECT nombre_completo FROM personas WHERE id IN (5,43) ORDER BY id");
  for (const r of rows) console.log(JSON.stringify(r.nombre_completo));
  const c = await query("SELECT nombre_representante FROM consentimientos_menores WHERE id=1");
  console.log(JSON.stringify(c[0].nombre_representante));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
