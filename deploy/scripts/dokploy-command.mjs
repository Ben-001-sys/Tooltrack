import { guardedCommand } from './github-compose-policy.mjs';
const [appName, verifierImage] = process.argv.slice(2);
console.log(guardedCommand(appName, verifierImage));
