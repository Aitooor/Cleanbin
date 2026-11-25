import path from 'node:path';
import { resetDbForTests } from '../src/server/db/index.js';
import { runBackup } from '../src/server/services/backup.js';

export { runBackup };

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'backup.ts'));

if (isDirectExecution) {
  runBackup()
    .then(async (outPath) => {
      console.log(`Backup written to ${outPath}`);
      await resetDbForTests();
    })
    .catch(async (err) => {
      console.error('Backup failed:', err);
      await resetDbForTests();
      process.exit(1);
    });
}
