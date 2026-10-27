import {readFile,stat,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildAiCatalogSnapshot} from './export.mjs';

// Optional offline conversion. Prefer the Cabinet button: it includes the latest
// saved edits and links. This command never opens credentials or calls an API.
const args=process.argv.slice(2);
try {
  if(args.length!==4 || args[0]!=='--input' || args[2]!=='--output') throw new Error('Использование: node catalog-bridge/convert-backup.mjs --input "backup.json" --output "catalog.json"');
  const input=resolve(args[1]),output=resolve(args[3]);
  if(input===output) throw new Error('Выберите отдельный файл для каталога; резервная копия должна сохраниться.');
  if((await stat(input)).size>256*1024*1024) throw new Error('Резервная копия больше 256 МБ. Используйте кнопку экспорта в кабинете.');
  let state;
  try {state=JSON.parse(await readFile(input,'utf8'));} catch {throw new Error('Не удалось прочитать JSON резервной копии.');}
  if(state?.format!=='michael-cabinet' || state.version!==1) throw new Error('Нужна резервная копия кабинета Michael версии1.');
  const snapshot=buildAiCatalogSnapshot(state);
  await writeFile(output,JSON.stringify(snapshot),{encoding:'utf8',flag:'wx'});
  console.log(`Подготовлено предложений: ${snapshot.offers.length}. Среда: ${snapshot.environment}.`);
} catch(error) {
  console.error(error.code==='EEXIST' ? 'Выходной файл уже существует. Выберите новое имя.' : error.code ? 'Не удалось прочитать входной файл или записать результат.' : error.message);
  process.exitCode=1;
}
