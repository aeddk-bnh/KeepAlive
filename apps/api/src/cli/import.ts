import { readFileSync } from 'fs';
import { resolve } from 'path';
import { db } from '@keepalive/database';

const [,, urlsFile, cookiesFile] = process.argv;

if (!urlsFile || !cookiesFile) {
  console.log(`
Usage: npm run import -- <urls-file> <cookies-file>

Example:
  npm run import -- urls.txt cookies.json
  `);
  process.exit(1);
}

const runImport = async () => {
  try {
    const urlsPath = resolve(process.cwd(), urlsFile);
    const cookiesPath = resolve(process.cwd(), cookiesFile);

    console.log(`Reading URLs from: ${urlsPath}`);
    console.log(`Reading Cookies from: ${cookiesPath}`);

    const cookiesJson = readFileSync(cookiesPath, 'utf-8');
    JSON.parse(cookiesJson);

    const urlsContent = readFileSync(urlsPath, 'utf-8');
    const urls = urlsContent.split('\n').map(u => u.trim()).filter(u => u.length > 0);

    if (urls.length === 0) {
      console.error('Error: No valid URLs found in file');
      process.exit(1);
    }

    let count = 0;
    for (const url of urls) {
      // Upsert Target
      const existingTarget = await db.target.findFirst({ where: { url } });

      if (existingTarget) {
        await db.target.update({
          where: { id: existingTarget.id },
          data: { cookies: cookiesJson, status: 'IDLE', isActive: true, lastRun: null }
        });
        console.log(`   ~ Target updated with new cookies: ${url}`);
      } else {
        await db.target.create({
          data: { url, cookies: cookiesJson, refreshInterval: 60, isActive: true }
        });
        console.log(`   + Target created: ${url}`);
      }
      count++;
    }

    console.log(`\n🚀 Done! Processed ${count} target(s).`);
    process.exit(0);

  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
};

runImport();
