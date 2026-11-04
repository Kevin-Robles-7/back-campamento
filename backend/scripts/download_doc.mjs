import 'dotenv/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import path from 'node:path';

const client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

async function main() {
  const key = '2026-10/1791939114781-3dfbbb7d9deb.jpg';
  const res = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const out = path.resolve('consentimientos_export', 'documento_consentimiento_7.jpg');
  await fs.writeFile(out, buf);
  console.log('downloaded', out, buf.length);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
