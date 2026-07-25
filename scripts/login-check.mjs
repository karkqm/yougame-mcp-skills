// Ручной вход + проверка сессии: node scripts/login-check.mjs [timeoutSec]
import { interactiveLogin } from '../dist/browser.js';
import { authStatus } from '../dist/api.js';

const timeoutSec = Number.parseInt(process.argv[2] || '420', 10);
console.log('Открываю окно браузера со страницей входа yougame.biz...');
const result = await interactiveLogin({ timeoutSec });
console.log(JSON.stringify(result, null, 2));

if (result.loggedIn) {
  console.log('\nПроверка сессии из HTTP-клиента:');
  console.log(JSON.stringify(await authStatus(), null, 2));
}
